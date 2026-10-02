import * as THREE from "three";
import { BladeRarity } from "@bladeio/shared";
import { getActiveTheme } from "../themes";
import { FLASH_COLOR } from "../themes/Theme";
import { FxBudget } from "../quality";
import { fxIntensity } from "./flash";

// Traînées des lames (tâche 4.9), en ruban à la couleur de leur rareté :
//  - projectile : ruban large et vif derrière une lame lancée, qui montre
//    d'où vient le tir et où il va (avant : des particules en pointillé) ;
//  - aspiration : ruban fin derrière une lame au sol attirée par un joueur,
//    jusque dans son orbite au ramassage.
// Le ruban suit la position DESSINÉE de la lame (BladeRenderer) sur ses
// dernières millisecondes, échantillonnée dans le temps comme la traînée
// du joueur : sa longueur ne dépend pas du FPS. Toutes les traînées dans un
// seul maillage, un seul appel de rendu.

export const TRAIL_PROJECTILE = 1;
export const TRAIL_SUCTION = 2;
export type TrailStyle = typeof TRAIL_PROJECTILE | typeof TRAIL_SUCTION;

interface StyleSpec {
  ms: number;        // durée couverte par le ruban
  halfWidth: number; // demi-largeur à la tête (u)
  alpha: number;
  white: number;     // part de blanc à la tête (cœur chaud)
}

const STYLES: Record<TrailStyle, StyleSpec> = {
  [TRAIL_PROJECTILE]: { ms: 200, halfWidth: 0.24, alpha: 0.9, white: 0.35 },
  [TRAIL_SUCTION]: { ms: 120, halfWidth: 0.09, alpha: 0.6, white: 0.15 },
};

// Le plus long ruban (projectile) : l'intervalle entre deux échantillons
// en découle, pour qu'il tienne en entier dans le budget de points.
const LONGEST_MS = 200;
// Saut d'une frame à l'autre au-delà duquel la traînée repart de zéro
// (lame réutilisée, recalage).
const JUMP = 12;

interface Trail {
  id: string;
  style: TrailStyle;
  rarity: BladeRarity;
  color: THREE.Color;
  // Échantillons, du plus récent au plus ancien.
  xs: Float64Array;
  ys: Float64Array;
  zs: Float64Array;
  ts: Float64Array;
  count: number;
  // Tête : dernière position dessinée et son instant (ms).
  hx: number;
  hy: number;
  hz: number;
  ht: number;
  seen: boolean;
}

export class BladeTrails {
  readonly object: THREE.Mesh;
  private geometry: THREE.BufferGeometry;
  private material: THREE.MeshBasicMaterial;
  private positions: Float32Array;
  private colors: Float32Array;
  private trails = new Map<string, Trail>();
  private pool: Trail[] = [];
  private readonly max: number;
  private readonly samples: number;
  // Points par ruban : la tête, les échantillons, le bout interpolé.
  private readonly points: number;
  private readonly sampleMs: number;
  private white = new THREE.Color(FLASH_COLOR);
  // Points du ruban en cours (x, y, z, âge).
  private pts: Float64Array;

  constructor(budget: FxBudget) {
    this.max = Math.max(1, budget.trails);
    this.samples = Math.max(3, budget.trailSamples);
    this.points = this.samples + 2;
    this.sampleMs = Math.max(16, Math.ceil(LONGEST_MS / (this.samples - 1)));
    this.pts = new Float64Array(this.points * 4);
    const verts = this.max * this.points * 2;
    this.positions = new Float32Array(verts * 3);
    this.colors = new Float32Array(verts * 4);
    const index: number[] = [];
    for (let k = 0; k < this.max; k++) {
      for (let i = 0; i < this.points - 1; i++) {
        const a = (k * this.points + i) * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setIndex(index);
    geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("color", new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.geometry = geo;
    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      forceSinglePass: true,
    });
    this.object = new THREE.Mesh(geo, this.material);
    this.object.frustumCulled = false;
    this.object.matrixAutoUpdate = false;
    this.object.visible = false;
  }

  // Position dessinée d'une lame à suivre à cette frame (now :
  // performance.now()). Appelé par BladeRenderer pendant son update.
  sample(id: string, x: number, y: number, z: number, rarity: BladeRarity, style: TrailStyle, now: number): void {
    let t = this.trails.get(id);
    if (!t) {
      if (this.trails.size >= this.max && !this.evictFor(style)) return;
      t = this.pool.pop() ?? {
        id, style, rarity, color: new THREE.Color(),
        xs: new Float64Array(this.samples), ys: new Float64Array(this.samples),
        zs: new Float64Array(this.samples), ts: new Float64Array(this.samples),
        count: 0, hx: 0, hy: 0, hz: 0, ht: 0, seen: false,
      };
      t.id = id;
      t.count = 0;
      t.rarity = -1 as BladeRarity;
      this.trails.set(id, t);
    }
    if (t.rarity !== rarity) {
      t.rarity = rarity;
      t.color.setHex(getActiveTheme().palette.rarityColor[rarity]);
    }
    if (t.count > 0 && Math.hypot(x - t.hx, z - t.hz) > JUMP) t.count = 0;
    t.style = style;
    t.hx = x; t.hy = y; t.hz = z; t.ht = now;
    t.seen = true;
    if (t.count === 0 || now - t.ts[0] >= this.sampleMs) {
      const n = Math.min(t.count, this.samples - 1);
      t.xs.copyWithin(1, 0, n);
      t.ys.copyWithin(1, 0, n);
      t.zs.copyWithin(1, 0, n);
      t.ts.copyWithin(1, 0, n);
      t.xs[0] = x; t.ys[0] = y; t.zs[0] = z; t.ts[0] = now;
      t.count = n + 1;
    }
  }

  // Plein : une traînée qui ne suit plus rien laisse sa place ; un
  // projectile passe avant une aspiration.
  private evictFor(style: TrailStyle): boolean {
    let victim: Trail | null = null;
    for (const t of this.trails.values()) {
      if (t.seen) continue;
      if (!victim || t.ht < victim.ht) victim = t;
    }
    if (!victim && style === TRAIL_PROJECTILE) {
      for (const t of this.trails.values()) {
        if (t.style === TRAIL_SUCTION && (!victim || t.ht < victim.ht)) victim = t;
      }
    }
    if (!victim) return false;
    this.trails.delete(victim.id);
    this.pool.push(victim);
    return true;
  }

  // Préchauffage (CombatFx) : un ruban de deux points, sous le sol.
  prime(now: number): void {
    this.sample("", 0, -10, 0, BladeRarity.Common, TRAIL_SUCTION, now - 20);
    this.sample("", 1, -10, 0, BladeRarity.Common, TRAIL_SUCTION, now);
  }

  setFlashIntensity(k: number): void {
    this.material.opacity = fxIntensity(k);
  }

  // Après l'update des lames : construit les rubans de la frame.
  finish(now: number): void {
    let slot = 0;
    for (const t of this.trails.values()) {
      const spec = STYLES[t.style];
      if (!t.seen && now - t.ht >= spec.ms) {
        // Plus suivie et entièrement éteinte.
        this.trails.delete(t.id);
        this.pool.push(t);
        continue;
      }
      t.seen = false;
      if (this.build(t, spec, now, slot)) slot++;
    }
    this.object.visible = slot > 0;
    this.geometry.setDrawRange(0, slot * (this.points - 1) * 6);
    if (slot === 0) return;
    // Seulement les rubans de la frame (le tampon est dimensionné pour le
    // plafond).
    const verts = slot * this.points * 2;
    const pos = this.geometry.getAttribute("position") as THREE.BufferAttribute;
    const col = this.geometry.getAttribute("color") as THREE.BufferAttribute;
    pos.addUpdateRange(0, verts * 3);
    col.addUpdateRange(0, verts * 4);
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  // Ruban d'une traînée dans l'emplacement slot : la tête, les échantillons
  // plus récents que spec.ms, puis un bout interpolé à exactement spec.ms.
  private build(t: Trail, spec: StyleSpec, now: number, slot: number): boolean {
    const pts = this.pts;
    const cut = now - spec.ms;
    let n = 0;
    let lastX = t.hx;
    let lastY = t.hy;
    let lastZ = t.hz;
    let lastT = t.ht;
    pts[0] = lastX; pts[1] = lastY; pts[2] = lastZ; pts[3] = now - lastT;
    n = 1;
    for (let i = 0; i < t.count && n < this.points; i++) {
      const st = t.ts[i];
      const sx = t.xs[i];
      const sy = t.ys[i];
      const sz = t.zs[i];
      if (st >= cut) {
        if (st < lastT || sx !== lastX || sz !== lastZ) {
          pts[n * 4] = sx; pts[n * 4 + 1] = sy; pts[n * 4 + 2] = sz; pts[n * 4 + 3] = now - st;
          n++;
          lastX = sx; lastY = sy; lastZ = sz; lastT = st;
        }
        continue;
      }
      // Premier échantillon trop vieux : bout interpolé à `cut`, puis fin.
      const span = lastT - st;
      const k = span > 0 ? (lastT - cut) / span : 0;
      pts[n * 4] = lastX + (sx - lastX) * k;
      pts[n * 4 + 1] = lastY + (sy - lastY) * k;
      pts[n * 4 + 2] = lastZ + (sz - lastZ) * k;
      pts[n * 4 + 3] = spec.ms;
      n++;
      break;
    }
    if (n < 2) return false;
    const pos = this.positions;
    const col = this.colors;
    const base = slot * this.points * 2;
    let perpX = 0;
    let perpZ = 0;
    for (let i = 0; i < this.points; i++) {
      // Au-delà du dernier point : répété, triangles vides.
      const j = Math.min(i, n - 1);
      const x = pts[j * 4];
      const y = pts[j * 4 + 1];
      const z = pts[j * 4 + 2];
      if (i < n) {
        // Direction locale : vers le point suivant (le précédent pour le
        // bout) ; un segment nul garde la normale d'avant.
        const o = i < n - 1 ? i + 1 : i - 1;
        const sgn = i < n - 1 ? 1 : -1;
        const dx = (pts[o * 4] - x) * sgn;
        const dz = (pts[o * 4 + 2] - z) * sgn;
        const len = Math.hypot(dx, dz);
        if (len > 1e-4) {
          perpX = -dz / len;
          perpZ = dx / len;
        }
      }
      const f = i < n ? Math.min(1, pts[j * 4 + 3] / spec.ms) : 1;
      const w = spec.halfWidth * (1 - f);
      const a = i < n ? spec.alpha * (1 - f) * (1 - f) : 0;
      const hot = spec.white * (1 - f);
      const v = (base + i * 2) * 3;
      pos[v] = x + perpX * w; pos[v + 1] = y; pos[v + 2] = z + perpZ * w;
      pos[v + 3] = x - perpX * w; pos[v + 4] = y; pos[v + 5] = z - perpZ * w;
      const c = (base + i * 2) * 4;
      const r = t.color.r + (this.white.r - t.color.r) * hot;
      const g = t.color.g + (this.white.g - t.color.g) * hot;
      const b = t.color.b + (this.white.b - t.color.b) * hot;
      col[c] = col[c + 4] = r;
      col[c + 1] = col[c + 5] = g;
      col[c + 2] = col[c + 6] = b;
      col[c + 3] = col[c + 7] = a;
    }
    return true;
  }

  clear(): void {
    for (const t of this.trails.values()) this.pool.push(t);
    this.trails.clear();
    this.geometry.setDrawRange(0, 0);
    this.object.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
