import { PLAYER_BODY_RADIUS, mapBlocked, mapSegmentHit, type GameMap } from "@bladeio/shared";

// Navigation des bots sur une carte à murs (mode « district »). Dans
// l'arène ronde, un bot marche droit sur sa cible : les obstacles y sont des
// piliers qu'on contourne en glissant. Entre des immeubles, il resterait
// collé à la première façade. Ici : une grille de cases libres ou prises,
// tirée une fois de la carte, et un plus court chemin (A*) du bot à sa
// cible, recalculé au plus toutes les REPATH_MS. Le bot vise le point le
// plus lointain de ce chemin qu'il peut rejoindre en ligne droite.

const CELL = 2;
// Une case est libre si un corps y tient avec un peu d'aisance : le chemin
// ne rase pas les murs.
const CLEARANCE = PLAYER_BODY_RADIUS + 0.4;
const REPATH_MS = 350;
// Au-delà, la cible a assez bougé pour refaire le chemin sans attendre.
const RETARGET_DIST = 6;

interface NavGrid {
  n: number; // cases par côté
  half: number;
  free: Uint8Array;
  // Tampons d'une recherche, réutilisés (une recherche à la fois).
  g: Float32Array;
  from: Int32Array;
  mark: Uint32Array;
  stamp: number;
  heap: number[];
  f: Float32Array;
}

const grids = new WeakMap<GameMap, NavGrid>();

function gridOf(map: GameMap): NavGrid {
  let grid = grids.get(map);
  if (grid) return grid;
  const n = Math.ceil((map.half * 2) / CELL);
  const free = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -map.half + (i + 0.5) * CELL;
      const y = -map.half + (j + 0.5) * CELL;
      free[j * n + i] = mapBlocked(map, x, y, CLEARANCE) ? 0 : 1;
    }
  }
  grid = {
    n,
    half: map.half,
    free,
    g: new Float32Array(n * n),
    from: new Int32Array(n * n),
    mark: new Uint32Array(n * n),
    stamp: 0,
    heap: [],
    f: new Float32Array(n * n),
  };
  grids.set(map, grid);
  return grid;
}

function cellOf(grid: NavGrid, v: number): number {
  return Math.max(0, Math.min(grid.n - 1, Math.floor((v + grid.half) / CELL)));
}

// Case libre la plus proche de (i, j), par anneaux : une cible peut être
// posée contre un mur ou tirée dans un immeuble (errance d'un bot).
function nearestFree(grid: NavGrid, i: number, j: number): number {
  const n = grid.n;
  if (grid.free[j * n + i]) return j * n + i;
  for (let r = 1; r < 12; r++) {
    let best = -1;
    let bestD = Infinity;
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const a = i + di;
        const b = j + dj;
        if (a < 0 || b < 0 || a >= n || b >= n || !grid.free[b * n + a]) continue;
        const d = di * di + dj * dj;
        if (d < bestD) {
          bestD = d;
          best = b * n + a;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

function heapPush(grid: NavGrid, node: number): void {
  const h = grid.heap;
  const f = grid.f;
  let i = h.length;
  h.push(node);
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (f[h[parent]] <= f[node]) break;
    h[i] = h[parent];
    i = parent;
  }
  h[i] = node;
}

function heapPop(grid: NavGrid): number {
  const h = grid.heap;
  const f = grid.f;
  const top = h[0];
  const last = h.pop()!;
  const len = h.length;
  if (len > 0) {
    let i = 0;
    for (;;) {
      let child = i * 2 + 1;
      if (child >= len) break;
      if (child + 1 < len && f[h[child + 1]] < f[h[child]]) child++;
      if (f[h[child]] >= f[last]) break;
      h[i] = h[child];
      i = child;
    }
    h[i] = last;
  }
  return top;
}

const DI = [1, -1, 0, 0, 1, 1, -1, -1];
const DJ = [0, 0, 1, -1, 1, -1, 1, -1];

// Plus court chemin de la case `start` à la case `goal` (8 voisins, pas de
// diagonale qui coupe un coin). Rend les cases du départ à l'arrivée, ou
// null s'il n'y en a pas.
function findPath(grid: NavGrid, start: number, goal: number): number[] | null {
  const n = grid.n;
  const stamp = ++grid.stamp;
  const gx = goal % n;
  const gy = (goal - gx) / n;
  grid.heap.length = 0;
  grid.g[start] = 0;
  grid.f[start] = 0;
  grid.from[start] = -1;
  grid.mark[start] = stamp;
  heapPush(grid, start);
  while (grid.heap.length > 0) {
    const cur = heapPop(grid);
    if (cur === goal) {
      const path: number[] = [];
      for (let c = cur; c !== -1; c = grid.from[c]) path.push(c);
      return path.reverse();
    }
    const ci = cur % n;
    const cj = (cur - ci) / n;
    for (let k = 0; k < 8; k++) {
      const ni = ci + DI[k];
      const nj = cj + DJ[k];
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      const next = nj * n + ni;
      if (!grid.free[next]) continue;
      if (k >= 4 && (!grid.free[cj * n + ni] || !grid.free[nj * n + ci])) continue;
      const cost = grid.g[cur] + (k >= 4 ? 1.4142 : 1);
      if (grid.mark[next] === stamp && cost >= grid.g[next]) continue;
      grid.mark[next] = stamp;
      grid.g[next] = cost;
      grid.from[next] = cur;
      // Heuristique octile : jamais plus que le vrai coût restant.
      const dx = Math.abs(ni - gx);
      const dy = Math.abs(nj - gy);
      grid.f[next] = cost + Math.max(dx, dy) + 0.4142 * Math.min(dx, dy);
      heapPush(grid, next);
    }
  }
  return null;
}

// La voie est-elle libre en ligne droite, pour un corps ?
export function clearWay(map: GameMap, x0: number, y0: number, x1: number, y1: number): boolean {
  return mapSegmentHit(map, x0, y0, x1, y1, 0, CLEARANCE) >= 1;
}

interface NavState {
  path: number[] | null;
  at: number;
  tx: number;
  ty: number;
}
export type NavMemory = Partial<NavState>;

const out = { x: 0, y: 0 };

// Point à viser tout de suite pour aller de (x, y) vers (tx, ty) : la cible
// si la voie est libre, sinon le point le plus avancé du chemin qu'on
// rejoint en ligne droite. `mem` garde le chemin d'un bot d'un appel à
// l'autre (un objet vide au départ). L'objet rendu est réutilisé.
export function navToward(
  map: GameMap,
  mem: NavMemory,
  x: number,
  y: number,
  tx: number,
  ty: number,
  nowMs: number,
): { x: number; y: number } {
  if (clearWay(map, x, y, tx, ty)) {
    mem.path = null;
    out.x = tx;
    out.y = ty;
    return out;
  }
  const grid = gridOf(map);
  const n = grid.n;
  const moved = mem.tx === undefined || Math.hypot(tx - mem.tx, ty - (mem.ty ?? 0)) > RETARGET_DIST;
  if (!mem.path || moved || nowMs - (mem.at ?? 0) > REPATH_MS) {
    const start = nearestFree(grid, cellOf(grid, x), cellOf(grid, y));
    const goal = nearestFree(grid, cellOf(grid, tx), cellOf(grid, ty));
    mem.path = start >= 0 && goal >= 0 ? findPath(grid, start, goal) : null;
    mem.at = nowMs;
    mem.tx = tx;
    mem.ty = ty;
  }
  const path = mem.path;
  if (!path || path.length === 0) {
    out.x = tx;
    out.y = ty;
    return out;
  }
  // Du bout du chemin vers le bot : le premier point visible en ligne
  // droite. Bornée, la recherche regarde d'abord au plus loin utile.
  let pick = path[Math.min(1, path.length - 1)];
  for (let k = Math.min(path.length - 1, 14); k >= 1; k--) {
    const c = path[k];
    const cx = -grid.half + ((c % n) + 0.5) * CELL;
    const cy = -grid.half + (Math.floor(c / n) + 0.5) * CELL;
    if (clearWay(map, x, y, cx, cy)) {
      pick = c;
      break;
    }
  }
  out.x = -grid.half + ((pick % n) + 0.5) * CELL;
  out.y = -grid.half + (Math.floor(pick / n) + 0.5) * CELL;
  return out;
}

// Toutes les cases libres se rejoignent-elles ? Pour les tests d'une
// carte : pas de cour fermée où du butin ou un joueur resterait enfermé.
export function navIslands(map: GameMap): number {
  const grid = gridOf(map);
  const n = grid.n;
  const seen = new Uint8Array(n * n);
  let islands = 0;
  for (let s = 0; s < n * n; s++) {
    if (!grid.free[s] || seen[s]) continue;
    islands++;
    const stack = [s];
    seen[s] = 1;
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const ci = cur % n;
      const cj = (cur - ci) / n;
      for (let k = 0; k < 4; k++) {
        const ni = ci + DI[k];
        const nj = cj + DJ[k];
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const next = nj * n + ni;
        if (!grid.free[next] || seen[next]) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
  }
  return islands;
}
