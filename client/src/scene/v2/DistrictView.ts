import * as THREE from "three";
import {
  FACADE_MODULE,
  FLOOR_HEIGHT,
  type DressingKind,
  type GameMap,
  type MapBuilding,
  type PropKind,
} from "@bladeio/shared";
import type { QualityConfig } from "../../quality";
import { getActiveTheme } from "../../themes";
import type { Kit, KitPart } from "./kit";
import { roleMaterials, type Cyber } from "./DecorV2";

// Le quartier (mode « district », shared/src/maps.ts) : une carte à murs,
// vue à la troisième personne. Les immeubles naissent de leurs colliders :
// des panneaux de façade du kit (art/kit/district_pieces.py) posés le long
// de chaque côté, un par module de 4 u et par étage, un toit, son acrotère
// et ce qui traîne dessus. Ce qu'on voit est donc toujours ce qui bloque.
// Le mobilier urbain vient du kit aux dimensions de ses colliders.
//
// Tout ce qui ne bouge pas est fondu en quelques maillages par matériau et
// par quart de carte (seize cases, écartées du rendu quand la caméra ne les
// voit pas) : quelques dizaines d'appels de rendu pour ~5000 panneaux.
// La géométrie n'est construite qu'à l'entrée dans une partie du mode
// (setActive) ; les matériaux, eux, existent dès le lobby avec un triangle
// témoin, pour que leurs shaders se compilent au préchauffage.
//
// Sans le kit (rendu d'origine, qualité basse, thème sans pièces) : des
// blocs aux dimensions des colliders. Jouable, sans plus.

export interface DistrictHandle {
  group: THREE.Group;
  // Sol du quartier en service (kit) : le sol de l'arène se cache alors.
  readonly ownsGround: boolean;
  setActive(on: boolean): void;
}

const CHUNK = 58;
const CHUNKS = 4;

// Tirage déterministe (le même quartier sur tous les écrans) : entier haché
// → [0, 1[.
function hash(a: number, b: number, c = 0, d = 0): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647) + Math.imul(d | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

interface Placement {
  part: KitPart;
  x: number;
  y: number;
  z: number;
  yaw: number;
  sx: number;
  sy: number;
  sz: number;
  // Couleur par sommet (rôles tint et window) : une par colonne de vitres.
  colors: THREE.Color[] | null;
}

// Fond les pièces posées en un maillage par (matériau, case de carte).
class Merger {
  private buckets = new Map<string, Placement[]>();

  add(role: string, p: Placement): void {
    const cx = Math.max(0, Math.min(CHUNKS - 1, Math.floor((p.x + (CHUNK * CHUNKS) / 2) / CHUNK)));
    const cz = Math.max(0, Math.min(CHUNKS - 1, Math.floor((p.z + (CHUNK * CHUNKS) / 2) / CHUNK)));
    const key = `${role}|${cx}|${cz}`;
    let list = this.buckets.get(key);
    if (!list) this.buckets.set(key, (list = []));
    list.push(p);
  }

  build(group: THREE.Group, mats: Record<string, THREE.Material>): void {
    for (const [key, list] of this.buckets) {
      const role = key.slice(0, key.indexOf("|"));
      const mat = mats[role];
      if (!mat) throw new Error(`quartier : rôle « ${role} » sans matériau`);
      let verts = 0;
      let indices = 0;
      for (const p of list) {
        const g = p.part.geometry;
        verts += g.getAttribute("position").count;
        indices += g.getIndex() ? g.getIndex()!.count : g.getAttribute("position").count;
      }
      const pos = new Float32Array(verts * 3);
      const nor = new Float32Array(verts * 3);
      const colored = (mat as THREE.MeshStandardMaterial).vertexColors === true;
      const col = colored ? new Float32Array(verts * 3) : null;
      const idx = new Uint32Array(indices);
      let v = 0;
      let k = 0;
      for (const p of list) {
        const g = p.part.geometry;
        const gp = g.getAttribute("position");
        const gn = g.getAttribute("normal");
        const gi = g.getIndex();
        const cos = Math.cos(p.yaw);
        const sin = Math.sin(p.yaw);
        const cols = p.colors;
        for (let i = 0; i < gp.count; i++) {
          const lx = gp.getX(i);
          const x = lx * p.sx;
          const z = gp.getZ(i) * p.sz;
          const o = (v + i) * 3;
          pos[o] = x * cos + z * sin + p.x;
          pos[o + 1] = gp.getY(i) * p.sy + p.y;
          pos[o + 2] = -x * sin + z * cos + p.z;
          const nx = gn.getX(i);
          const nz = gn.getZ(i);
          nor[o] = nx * cos + nz * sin;
          nor[o + 1] = gn.getY(i);
          nor[o + 2] = -nx * sin + nz * cos;
          if (col) {
            // Colonne de vitres d'après la place du sommet sur le panneau.
            const c = cols
              ? cols[cols.length === 1 ? 0 : Math.max(0, Math.min(cols.length - 1, Math.floor(((lx + FACADE_MODULE / 2) / FACADE_MODULE) * cols.length)))]
              : WHITE;
            col[o] = c.r;
            col[o + 1] = c.g;
            col[o + 2] = c.b;
          }
        }
        if (gi) for (let i = 0; i < gi.count; i++) idx[k++] = gi.getX(i) + v;
        else for (let i = 0; i < gp.count; i++) idx[k++] = v + i;
        v += gp.count;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      if (col) geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      const lit = mat instanceof THREE.MeshStandardMaterial;
      mesh.castShadow = lit;
      mesh.receiveShadow = lit;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    this.buckets.clear();
  }
}

const WHITE = new THREE.Color(1, 1, 1);

const PROP_PIECE: Record<PropKind, string> = {
  container: "Container",
  car: "Car",
  barrier: "Barrier",
  dumpster: "Dumpster",
  vending: "Vending",
  bench: "Bench",
  planter: "Planter",
  pallets: "Pallets",
  terminal: "Terminal",
  lamp: "Lamp",
  bollard: "Bollard",
  pillar: "CentralPillar",
};

// Hauteur de pose de l'habillage : au-dessus de la caméra (6 à 7 u).
const DRESSING: Record<DressingKind, { piece: string; y: number }> = {
  hangSign: { piece: "HangSign", y: 8.6 },
  skyBridge: { piece: "SkyBridge", y: 9 },
  containerTop: { piece: "Container", y: 2.6 },
  trash: { piece: "Trash", y: 0 },
  cone: { piece: "Cone", y: 0 },
};

// Rez-de-chaussée et étages par style d'immeuble (habitation, bureaux,
// industriel) : [pièce, part des tirages].
const GROUND_FLOOR: Array<Array<[string, number]>> = [
  [["FacadeShop", 0.4], ["FacadeDoor", 0.2], ["FacadePlain", 0.28], ["FacadeShutter", 0.12]],
  [["FacadeDoor", 0.22], ["FacadeShop", 0.3], ["FacadePlain", 0.48]],
  [["FacadeShutter", 0.45], ["FacadePlain", 0.4], ["FacadeDoor", 0.15]],
];
const FIRST_FLOOR = ["FacadeWin", "FacadeStrip", "FacadeBlank"];
const UPPER_FLOOR = ["FacadeLite", "FacadeStrip", "FacadeLite"];
const WINDOW_COLUMNS: Record<string, number> = { FacadeLite: 2, FacadeWin: 2, FacadeStrip: 3 };

function pick(table: Array<[string, number]>, r: number): string {
  for (const [name, share] of table) {
    if (r < share) return name;
    r -= share;
  }
  return table[table.length - 1][0];
}

// Un point à cette hauteur est-il dans un autre immeuble ? Une façade collée
// à un voisin au moins aussi haut ne se voit pas : on ne la pose pas.
function buried(map: GameMap, self: MapBuilding, x: number, z: number, top: number): boolean {
  if (Math.abs(x) > map.half + 12 || Math.abs(z) > map.half + 12) return true;
  for (const b of map.buildings) {
    if (b === self) continue;
    if (x > b.x0 && x < b.x1 && z > b.y0 && z < b.y1 && b.floors * FLOOR_HEIGHT >= top) return true;
  }
  return false;
}

interface Palette {
  wall(b: MapBuilding, i: number): THREE.Color;
  windowLit(r: number): THREE.Color;
  windowDark: THREE.Color;
  paint(kind: PropKind | "containerTop", i: number): THREE.Color;
}

function palette(v: Cyber): Palette {
  const dark = new THREE.Color(v.baseDark);
  const accents = [v.structureNeon, v.structureScreen, v.structureLed, v.cubeColor, v.obeliskOuter, v.shrineHalo].map((c) => new THREE.Color(c));
  const lights = [v.structureScreen, v.shrineHalo, v.structureNeon, v.structureLed].map((c) => new THREE.Color(c));
  return {
    // Murs : le sombre du thème, plus ou moins éclairci selon l'immeuble,
    // à peine teinté d'un accent.
    wall(b, i) {
      const lift = [0.2, 0.14, 0.1][b.style] + hash(i, 7) * 0.12;
      return dark.clone().lerp(WHITE, lift).lerp(accents[Math.floor(hash(i, 11) * accents.length)], 0.07);
    },
    // Vitres allumées : au-dessus de 1 pour quelques-unes, la scène est en
    // HDR, c'est ce qui les fait rayonner.
    windowLit(r) {
      return lights[Math.floor(r * lights.length)].clone().lerp(WHITE, 0.3).multiplyScalar(0.4 + r * 0.5);
    },
    windowDark: dark.clone().lerp(accents[1], 0.1).multiplyScalar(0.4),
    paint(kind, i) {
      const accent = accents[Math.floor(hash(i, 23) * accents.length)];
      if (kind === "car") return dark.clone().lerp(WHITE, 0.16).lerp(accent, 0.35);
      if (kind === "container" || kind === "containerTop") return dark.clone().lerp(accent, 0.42).lerp(WHITE, 0.06);
      return dark.clone().lerp(WHITE, 0.22).lerp(accent, 0.12);
    },
  };
}

// Lueurs au sol : une tache par source, peinte une fois (cf. GroundV2).
interface Glow {
  x: number;
  z: number;
  radius: number;
  color: THREE.Color;
  strength: number;
}

function unitBox(): KitPart {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  return { geometry: g, role: "body", emissiveMap: null };
}

function populate(map: GameMap, kit: Kit, pal: Palette, v: Cyber, merger: Merger, glows: Glow[]): void {
  const box = unitBox();
  const place = (piece: string, x: number, y: number, z: number, yaw: number, tint: THREE.Color | null, windows: THREE.Color[] | null, sy = 1) => {
    for (const part of kit.parts(piece)) {
      merger.add(part.role, {
        part,
        x, y, z, yaw,
        sx: 1, sy, sz: 1,
        colors: part.role === "tint" ? (tint ? [tint] : null) : part.role === "window" ? windows : null,
      });
    }
  };
  const neon = new THREE.Color(v.structureNeon);
  const screen = new THREE.Color(v.structureScreen);
  const halo = new THREE.Color(v.shrineHalo);
  const pad = new THREE.Color(v.groundPad);

  map.buildings.forEach((b, bi) => {
    const wall = pal.wall(b, bi);
    const height = b.floors * FLOOR_HEIGHT;
    // Quatre côtés : origine, direction le long du mur, normale sortante.
    const sides: Array<[number, number, number, number, number, number, number]> = [
      [b.x0, b.y1, 1, 0, 0, 1, b.x1 - b.x0], // sud (+z)
      [b.x1, b.y1, 0, -1, 1, 0, b.y1 - b.y0], // est
      [b.x1, b.y0, -1, 0, 0, -1, b.x1 - b.x0], // nord
      [b.x0, b.y0, 0, 1, -1, 0, b.y1 - b.y0], // ouest
    ];
    sides.forEach(([ox, oz, dx, dz, nx, nz, len], si) => {
      const yaw = Math.atan2(nx, nz);
      const n = Math.round(len / FACADE_MODULE);
      for (let m = 0; m < n; m++) {
        const cx = ox + dx * (m + 0.5) * FACADE_MODULE;
        const cz = oz + dz * (m + 0.5) * FACADE_MODULE;
        for (let f = 0; f < b.floors; f++) {
          if (buried(map, b, cx + nx * 0.5, cz + nz * 0.5, (f + 1) * FLOOR_HEIGHT)) continue;
          const r = hash(bi, si, m, f);
          const piece = f === 0
            ? pick(GROUND_FLOOR[b.style], r)
            : f === 1 || (b.style === 0 && f <= 3 && r < 0.14)
              ? FIRST_FLOOR[b.style]
              : UPPER_FLOOR[b.style];
          const columns = WINDOW_COLUMNS[piece] ?? 1;
          const windows: THREE.Color[] = [];
          for (let c = 0; c < columns; c++) {
            const w = hash(bi * 31 + si, m, f, c + 1);
            // Vitrines et portes : toujours allumées. Étages : une sur trois.
            windows.push(f === 0 ? pal.windowLit(0.5 + w * 0.5) : w < 0.36 ? pal.windowLit(w / 0.36) : pal.windowDark);
          }
          place(piece, cx, f * FLOOR_HEIGHT, cz, yaw, wall, windows);
          if (f === 0 && piece === "FacadeShop") glows.push({ x: cx + nx * 2.2, z: cz + nz * 2.2, radius: 5.5, color: neon, strength: 0.55 });
          if (f === 0 && piece === "FacadeDoor") glows.push({ x: cx + nx * 1.6, z: cz + nz * 1.6, radius: 4, color: halo, strength: 0.5 });
        }
        if (!buried(map, b, cx + nx * 0.5, cz + nz * 0.5, height + 0.6)) place("RoofEdge", cx, height, cz, yaw, null, null);
      }
      // Angle au départ de chaque côté, sur toute la hauteur.
      place("FacadeCorner", ox, 0, oz, 0, null, null, b.floors);
    });
    // Toit : une dalle, et ce qui traîne dessus (jamais le même d'un
    // immeuble à l'autre, toujours le même d'un écran à l'autre).
    const w = b.x1 - b.x0;
    const d = b.y1 - b.y0;
    merger.add("body", { part: box, x: (b.x0 + b.x1) / 2, y: height - 0.3, z: (b.y0 + b.y1) / 2, yaw: 0, sx: w, sy: 0.3, sz: d, colors: null });
    const count = Math.max(1, Math.min(4, Math.floor((w * d) / 110)));
    for (let k = 0; k < count; k++) {
      const r = hash(bi, 91, k);
      const px = b.x0 + 2.5 + hash(bi, 92, k) * Math.max(0, w - 5);
      const pz = b.y0 + 2.5 + hash(bi, 93, k) * Math.max(0, d - 5);
      const piece = r < 0.4 ? "RoofAC" : r < 0.7 ? "RoofTank" : "RoofAntenna";
      place(piece, px, height, pz, Math.floor(hash(bi, 94, k) * 4) * (Math.PI / 2), null, null);
    }
    // Grand panneau lumineux sur les immeubles hauts, tourné vers le
    // centre de la carte, au bord du toit.
    if (b.floors >= 5 && hash(bi, 95) < 0.7) {
      const cx = (b.x0 + b.x1) / 2;
      const cz = (b.y0 + b.y1) / 2;
      if (Math.abs(cx) > Math.abs(cz) && d >= 8) place("RoofSign", cx > 0 ? b.x0 + 0.6 : b.x1 - 0.6, height, cz, cx > 0 ? -Math.PI / 2 : Math.PI / 2, null, null);
      else if (w >= 8) place("RoofSign", cx, height, cz > 0 ? b.y0 + 0.6 : b.y1 - 0.6, cz > 0 ? Math.PI : 0, null, null);
    }
  });

  map.props.forEach((p, i) => {
    const yaw = p.rot * (Math.PI / 2);
    place(PROP_PIECE[p.kind], p.x, 0, p.y, yaw, pal.paint(p.kind, i), [pal.windowLit(0.9)]);
    switch (p.kind) {
      case "lamp": glows.push({ x: p.x, z: p.y, radius: 10, color: halo, strength: 0.95 }); break;
      case "pillar": glows.push({ x: p.x, z: p.y, radius: 15, color: new THREE.Color(v.shrineCore), strength: 0.9 }); break;
      case "bollard": glows.push({ x: p.x, z: p.y, radius: 2.4, color: screen, strength: 0.5 }); break;
      case "car": glows.push({ x: p.x, z: p.y, radius: 3.2, color: pad, strength: 0.5 }); break;
      case "planter": glows.push({ x: p.x, z: p.y, radius: 3, color: pad, strength: 0.4 }); break;
      case "terminal":
      case "vending": glows.push({ x: p.x + Math.sin(yaw) * 1.4, z: p.y + Math.cos(yaw) * 1.4, radius: 3.6, color: screen, strength: 0.6 }); break;
      default: break;
    }
  });
  map.dressing.forEach((d, i) => {
    const spec = DRESSING[d.kind];
    place(spec.piece, d.x, spec.y, d.y, d.rot * (Math.PI / 2), pal.paint(d.kind === "containerTop" ? "containerTop" : "pallets", i + 500), [pal.windowLit(0.7)]);
    if (d.kind === "hangSign") glows.push({ x: d.x, z: d.y, radius: 7, color: neon, strength: 0.45 });
  });
}

// --- Sol : chaussées, trottoirs, marquages et lueurs, peints une fois ------
function css(c: THREE.Color, alpha = 1): string {
  const s = c.clone().convertLinearToSRGB();
  return `rgba(${Math.round(s.r * 255)}, ${Math.round(s.g * 255)}, ${Math.round(s.b * 255)}, ${alpha})`;
}

function paintGround(map: GameMap, size: number, glows: Glow[]): { color: HTMLCanvasElement; light: HTMLCanvasElement } {
  const theme = getActiveTheme();
  const extent = map.half + 12;
  const k = size / (extent * 2);
  const X = (x: number) => (x + extent) * k;
  // Sombre et calme (contrat de lisibilité) : l'asphalte est la couleur de
  // base du sol du thème, trottoirs et marquages à peine plus clairs.
  const base = new THREE.Color(theme.ground.colors.base);
  const fog = new THREE.Color(theme.palette.fogColor);
  const asphalt = base.clone().lerp(fog, 0.25);
  const walk = asphalt.clone().lerp(WHITE, 0.035);
  const curb = asphalt.clone().lerp(WHITE, 0.075);
  const mark = asphalt.clone().lerp(WHITE, 0.1);
  const seam = asphalt.clone().multiplyScalar(0.6);

  const color = document.createElement("canvas");
  color.width = color.height = size;
  const c = color.getContext("2d")!;
  c.fillStyle = css(asphalt);
  c.fillRect(0, 0, size, size);
  // Usure de la chaussée : taches et rapiéçages.
  for (let i = 0; i < 520; i++) {
    const x = (hash(i, 1) * 2 - 1) * map.half;
    const z = (hash(i, 2) * 2 - 1) * map.half;
    const w = 2 + hash(i, 3) * 7;
    const h = 1.5 + hash(i, 4) * 5;
    c.fillStyle = css(hash(i, 5) < 0.5 ? seam : walk, 0.25 + hash(i, 6) * 0.3);
    c.fillRect(X(x), X(z), w * k, h * k);
  }
  // Place centrale : dallage.
  c.fillStyle = css(walk);
  c.fillRect(X(-24), X(-24), 48 * k, 48 * k);
  c.strokeStyle = css(seam, 0.8);
  c.lineWidth = Math.max(1, 0.08 * k);
  for (let g = -24; g <= 24; g += 3) {
    c.beginPath();
    c.moveTo(X(g), X(-24));
    c.lineTo(X(g), X(24));
    c.moveTo(X(-24), X(g));
    c.lineTo(X(24), X(g));
    c.stroke();
  }
  c.strokeStyle = css(curb);
  c.lineWidth = Math.max(1, 0.25 * k);
  c.beginPath();
  c.arc(X(0), X(0), 10 * k, 0, Math.PI * 2);
  c.stroke();
  c.beginPath();
  c.arc(X(0), X(0), 16 * k, 0, Math.PI * 2);
  c.stroke();
  // Trottoirs : deux unités autour de chaque immeuble, bordure et joints.
  const SIDEWALK = 2;
  for (const b of map.buildings) {
    c.fillStyle = css(curb);
    c.fillRect(X(b.x0 - SIDEWALK - 0.15), X(b.y0 - SIDEWALK - 0.15), (b.x1 - b.x0 + SIDEWALK * 2 + 0.3) * k, (b.y1 - b.y0 + SIDEWALK * 2 + 0.3) * k);
  }
  for (const b of map.buildings) {
    c.fillStyle = css(walk);
    c.fillRect(X(b.x0 - SIDEWALK), X(b.y0 - SIDEWALK), (b.x1 - b.x0 + SIDEWALK * 2) * k, (b.y1 - b.y0 + SIDEWALK * 2) * k);
  }
  c.strokeStyle = css(seam, 0.55);
  c.lineWidth = Math.max(1, 0.06 * k);
  for (const b of map.buildings) {
    for (let g = b.x0 - SIDEWALK; g <= b.x1 + SIDEWALK; g += 2) {
      c.beginPath();
      c.moveTo(X(g), X(b.y0 - SIDEWALK));
      c.lineTo(X(g), X(b.y0));
      c.moveTo(X(g), X(b.y1));
      c.lineTo(X(g), X(b.y1 + SIDEWALK));
      c.stroke();
    }
    for (let g = b.y0 - SIDEWALK; g <= b.y1 + SIDEWALK; g += 2) {
      c.beginPath();
      c.moveTo(X(b.x0 - SIDEWALK), X(g));
      c.lineTo(X(b.x0), X(g));
      c.moveTo(X(b.x1), X(g));
      c.lineTo(X(b.x1 + SIDEWALK), X(g));
      c.stroke();
    }
  }
  // Marquages : axe en tirets des avenues et de l'anneau, passages piétons
  // aux abords de la place et des carrefours, cases du parking.
  c.fillStyle = css(mark);
  const dashes = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ux = (x1 - x0) / len;
    const uz = (z1 - z0) / len;
    for (let s = 0; s + 2 <= len; s += 5) {
      const ax = x0 + ux * s;
      const az = z0 + uz * s;
      if (Math.abs(ax) < 26 && Math.abs(az) < 26) continue;
      c.fillRect(X(ax - (uz !== 0 ? 0.12 : 0)), X(az - (ux !== 0 ? 0.12 : 0)), (ux !== 0 ? 2 : 0.24) * k, (uz !== 0 ? 2 : 0.24) * k);
    }
  };
  dashes(0, -104, 0, 104);
  dashes(-104, 0, 104, 0);
  for (const s of [-54, 54]) {
    dashes(s, -104, s, 104);
    dashes(-104, s, 104, s);
  }
  const crossing = (x: number, z: number, along: "x" | "z", width: number) => {
    for (let s = -width / 2 + 0.5; s < width / 2; s += 1.4) {
      if (along === "x") c.fillRect(X(x + s), X(z - 1.4), 0.7 * k, 2.8 * k);
      else c.fillRect(X(x - 1.4), X(z + s), 2.8 * k, 0.7 * k);
    }
  };
  for (const s of [-27, 27]) {
    crossing(0, s, "x", 14);
    crossing(s, 0, "z", 14);
  }
  for (const a of [-54, 54]) {
    for (const s of [-10, 10]) {
      crossing(a, s, "x", 10);
      crossing(s, a, "z", 10);
      crossing(a + s * 0.8, 0, "z", 14);
      crossing(0, a + s * 0.8, "x", 14);
    }
  }
  for (const side of [-1, 1]) {
    for (let x = 28; x <= 48; x += 2) {
      c.fillRect(X(side * x - 0.06), X(-69), 0.12 * k, 6 * k);
      c.fillRect(X(side * x - 0.06), X(-78), 0.12 * k, 6 * k);
    }
    // Dépôt de conteneurs : hachures de sécurité le long de son bord.
    for (let s = 60; s < 92; s += 2) {
      c.fillRect(X(side * s), X(60.4), 1 * k, 0.3 * k);
      c.fillRect(X(side * 60.4 - 0.15), X(s), 0.3 * k, 1 * k);
    }
  }
  // Plaques d'égout.
  for (let i = 0; i < 26; i++) {
    const along = hash(i, 41) < 0.5;
    const lane = [-54, 0, 54][Math.floor(hash(i, 42) * 3)] + (hash(i, 43) < 0.5 ? -3 : 3);
    const t = (hash(i, 44) * 2 - 1) * 96;
    c.fillStyle = css(seam);
    c.beginPath();
    c.arc(X(along ? t : lane), X(along ? lane : t), 0.55 * k, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = css(curb);
    c.lineWidth = Math.max(1, 0.07 * k);
    c.stroke();
  }

  const light = document.createElement("canvas");
  light.width = light.height = size;
  const l = light.getContext("2d")!;
  l.fillStyle = css(new THREE.Color(0, 0, 0));
  l.fillRect(0, 0, size, size);
  l.globalCompositeOperation = "lighter";
  for (const g of glows) {
    const px = X(g.x);
    const pz = X(g.z);
    const r = g.radius * k;
    const grad = l.createRadialGradient(px, pz, 0, px, pz, r);
    // Faible : le sol reste sombre même sous un lampadaire (les lames
    // doivent ressortir dessus).
    grad.addColorStop(0, css(g.color, 0.3 * g.strength));
    grad.addColorStop(0.4, css(g.color, 0.13 * g.strength));
    grad.addColorStop(1, css(g.color, 0));
    l.fillStyle = grad;
    l.fillRect(px - r, pz - r, r * 2, r * 2);
  }
  return { color, light };
}

function blankTexture(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

const GROUND_ALBEDO_BOOST = 1.9;

// Dans l'arène, les filets lumineux du kit sont minces et rares : très
// au-dessus de 1, pour que le bloom y morde. Ici ce sont des enseignes, des
// écrans et des vitrines par centaines : à la même intensité, la rue
// baignerait dans un halo qui noie les lames.
const EMISSIVE_SCALE: Record<string, number> = { e_screen: 0.4, e_neon: 0.55, e_core: 0.6, e_halo: 0.7, e_pad: 0.55 };
function dimmed(mats: Record<string, THREE.Material>): Record<string, THREE.Material> {
  for (const [role, k] of Object.entries(EMISSIVE_SCALE)) {
    const m = mats[role];
    if (m instanceof THREE.MeshStandardMaterial) m.emissiveIntensity *= k;
  }
  return mats;
}

// Triangle témoin : un par matériau, dans la scène dès le lobby, pour que
// son shader soit compilé au préchauffage. Sous le sol, hors de vue.
function seed(mat: THREE.Material): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, -50, 0, 0.01, -50, 0, 0, -50, 0.01]), 3));
  g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(9), 3));
  g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(6), 2));
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = mat instanceof THREE.MeshStandardMaterial;
  m.castShadow = m.receiveShadow;
  m.frustumCulled = false;
  return m;
}

function createKitDistrict(q: QualityConfig, kit: Kit, map: GameMap, maxAnisotropy: number): DistrictHandle {
  const v = getActiveTheme().decor as Cyber;
  const group = new THREE.Group();
  group.visible = false;
  const dark = new THREE.Color(v.baseDark);
  const mats: Record<string, THREE.Material> = {
    ...dimmed(roleMaterials(v)),
    tint: new THREE.MeshStandardMaterial({ color: WHITE, vertexColors: true, roughness: 0.72, metalness: 0.15 }),
    // Vitres : sans éclairage, leur couleur par sommet dit allumée ou éteinte.
    window: new THREE.MeshBasicMaterial({ color: WHITE, vertexColors: true }),
    plant: new THREE.MeshStandardMaterial({ color: new THREE.Color(v.bushFoliage).lerp(dark, 0.35), emissive: v.bushAccent, emissiveIntensity: 0.25, roughness: 0.8 }),
  };
  const groundMat = new THREE.MeshStandardMaterial({
    color: WHITE,
    map: blankTexture(),
    emissive: WHITE,
    emissiveMap: blankTexture(),
    emissiveIntensity: 1,
    roughness: 0.44,
    metalness: 0,
  });
  // La peinture du sol est sombre (contrat de lisibilité) : éclairée par la
  // seule lune, elle serait noire. Même correction que le sol de l'arène.
  groundMat.color.setScalar(GROUND_ALBEDO_BOOST);
  const seeds = new THREE.Group();
  const seen = new Set<THREE.Material>();
  for (const m of [...Object.values(mats), groundMat]) {
    if (seen.has(m)) continue;
    seen.add(m);
    seeds.add(seed(m));
  }
  group.add(seeds);

  let built = false;
  const build = () => {
    built = true;
    const merger = new Merger();
    const glows: Glow[] = [];
    populate(map, kit, palette(v), v, merger, glows);
    merger.build(group, mats);
    const extent = map.half + 12;
    const { color, light } = paintGround(map, q.preset === "high" ? 4096 : 2048, glows);
    const mapTex = new THREE.CanvasTexture(color);
    mapTex.colorSpace = THREE.SRGBColorSpace;
    mapTex.anisotropy = maxAnisotropy;
    const lightTex = new THREE.CanvasTexture(light);
    lightTex.colorSpace = THREE.SRGBColorSpace;
    lightTex.anisotropy = maxAnisotropy;
    groundMat.map = mapTex;
    groundMat.emissiveMap = lightTex;
    const plane = new THREE.PlaneGeometry(extent * 2, extent * 2);
    plane.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(plane, groundMat);
    ground.receiveShadow = true;
    ground.matrixAutoUpdate = false;
    group.add(ground);
    seeds.visible = false;
  };

  return {
    group,
    ownsGround: true,
    setActive(on) {
      if (on && !built) build();
      group.visible = on;
    },
  };
}

// Sans le kit : chaque collider en bloc, à ses dimensions. Mêmes couleurs
// de thème que les structures de l'arène.
function createBlockDistrict(q: QualityConfig, map: GameMap): DistrictHandle {
  const v = getActiveTheme().decor;
  const group = new THREE.Group();
  group.visible = false;
  const dark = new THREE.Color(v.baseDark);
  const neon = new THREE.Color(v.structureNeon);
  const mat = q.simpleMaterials
    ? new THREE.MeshBasicMaterial({ color: WHITE })
    : new THREE.MeshLambertMaterial({ color: WHITE });
  const edgeMat = new THREE.MeshBasicMaterial({ color: neon });
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const boxes = new THREE.InstancedMesh(box, mat, map.boxes.length);
  // Liseré lumineux au sommet des immeubles : sans éclairage (qualité
  // basse), c'est lui qui détache un bloc du suivant.
  const edges = new THREE.InstancedMesh(box, edgeMat, map.buildings.length);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  map.boxes.forEach((b, i) => {
    m.makeScale(b.hw * 2, b.h, b.hh * 2).setPosition(b.x, 0, b.y);
    boxes.setMatrixAt(i, m);
    const building = i < map.buildings.length;
    // Sans éclairage, la couleur s'affiche telle quelle : bien plus sombre.
    const lift = q.simpleMaterials ? 0.02 + hash(i, 3) * 0.05 : 0.1 + hash(i, 3) * 0.14;
    boxes.setColorAt(i, c.copy(dark).lerp(WHITE, building ? lift : lift + 0.12).lerp(neon, building ? 0.04 : 0.18));
    if (building) {
      m.makeScale(b.hw * 2 + 0.2, 0.25, b.hh * 2 + 0.2).setPosition(b.x, b.h, b.y);
      edges.setMatrixAt(i, m);
    }
  });
  const post = new THREE.CylinderGeometry(1, 1, 1, 8);
  post.translate(0, 0.5, 0);
  const posts = new THREE.InstancedMesh(post, edgeMat, map.circles.length);
  map.circles.forEach((p, i) => {
    m.makeScale(p.radius, p.radius > 1 ? 9 : 3, p.radius).setPosition(p.x, 0, p.y);
    posts.setMatrixAt(i, m);
  });
  for (const mesh of [boxes, edges, posts]) {
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  return {
    group,
    ownsGround: false,
    setActive(on) {
      group.visible = on;
    },
  };
}

export function createDistrictView(q: QualityConfig, kit: Kit | null, map: GameMap, maxAnisotropy: number): DistrictHandle {
  return kit ? createKitDistrict(q, kit, map, maxAnisotropy) : createBlockDistrict(q, map);
}
