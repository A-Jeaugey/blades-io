import * as THREE from "three";
import {
  BladeRarity,
  POWERUP_SCALE,
  PowerUpType,
} from "@bladeio/shared";
import { QualityConfig } from "../quality";
import { getActiveTheme } from "../themes";

interface PowerUpEntry {
  id: string;
  type: PowerUpType;
  rarity: BladeRarity;
  mesh: THREE.Group;
  bobPhase: number;
}

const TYPES = [PowerUpType.Speed, PowerUpType.Spin, PowerUpType.Magnet, PowerUpType.Shield, PowerUpType.Blades];

// Glow des formes (tâche 3.8). À 1,6 pour toutes, les couleurs claires
// (blanc, jaune) partaient en tache de bloom : forme illisible, en niveaux
// de gris surtout. Ramené à une luminance commune, comme les raretés des
// lames, sans dépasser l'ancien glow pour les couleurs sombres.
const GLOW_MAX = 1.6;
const GLOW_LUMINANCE = 0.5;
function glowFor(color: number): number {
  const lum = 0.299 * ((color >> 16) & 255) / 255 + 0.587 * ((color >> 8) & 255) / 255 + 0.114 * (color & 255) / 255;
  return Math.min(GLOW_MAX, GLOW_LUMINANCE / Math.max(0.2, lum));
}

// Une forme par type (tâche 4.3) : la couleur seule, qui change en plus
// avec le thème, ne suffisait pas à les reconnaître. Formes plates posées à
// l'horizontale, lisibles depuis la caméra plongeante, qui tournent dans
// leur plan (jamais vues par la tranche). Elles tiennent dans un rayon ~1,
// comme l'octaèdre d'avant.
function shapesFor(type: PowerUpType): THREE.Shape[] {
  switch (type) {
    case PowerUpType.Speed: {
      // Double chevron « >> ».
      const chevron = (dx: number) => new THREE.Shape([
        new THREE.Vector2(-0.35 + dx, 0.65), new THREE.Vector2(0.05 + dx, 0.65),
        new THREE.Vector2(0.55 + dx, 0), new THREE.Vector2(0.05 + dx, -0.65),
        new THREE.Vector2(-0.35 + dx, -0.65), new THREE.Vector2(0.15 + dx, 0),
      ]);
      return [chevron(0.15), chevron(-0.45)];
    }
    case PowerUpType.Spin: {
      // Flèche circulaire.
      const a0 = 0.5, a1 = Math.PI * 1.75, ro = 0.85, ri = 0.55;
      const s = new THREE.Shape();
      s.moveTo(Math.cos(a0) * ro, Math.sin(a0) * ro);
      s.absarc(0, 0, ro, a0, a1, false);
      s.lineTo(Math.cos(a1) * ri, Math.sin(a1) * ri);
      s.absarc(0, 0, ri, a1, a0, true);
      const head = new THREE.Shape([
        new THREE.Vector2(Math.cos(a0) * 0.35, Math.sin(a0) * 0.35),
        new THREE.Vector2(Math.cos(a0) * 1.05, Math.sin(a0) * 1.05),
        new THREE.Vector2(Math.cos(a0 - 0.55) * 0.7, Math.sin(a0 - 0.55) * 0.7),
      ]);
      return [s, head];
    }
    case PowerUpType.Magnet: {
      // Fer à cheval.
      const s = new THREE.Shape();
      s.moveTo(-0.8, 0.65);
      s.lineTo(-0.8, 0);
      s.absarc(0, 0, 0.8, Math.PI, Math.PI * 2, false);
      s.lineTo(0.8, 0.65);
      s.lineTo(0.42, 0.65);
      s.lineTo(0.42, 0);
      s.absarc(0, 0, 0.42, 0, Math.PI, true);
      s.lineTo(-0.42, 0.65);
      return [s];
    }
    case PowerUpType.Shield: {
      // Écu.
      const s = new THREE.Shape();
      s.moveTo(-0.7, 0.75);
      s.lineTo(0.7, 0.75);
      s.quadraticCurveTo(0.78, -0.2, 0, -0.95);
      s.quadraticCurveTo(-0.78, -0.2, -0.7, 0.75);
      return [s];
    }
    case PowerUpType.Blades: {
      // Shuriken à quatre pointes.
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r = i % 2 === 0 ? 1.0 : 0.3;
        pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
      }
      const s = new THREE.Shape(pts);
      const hole = new THREE.Path();
      hole.absarc(0, 0, 0.14, 0, Math.PI * 2, true);
      s.holes.push(hole);
      return [s];
    }
  }
}

// Forme néon flottante. Couleur par type, taille par rareté. Rotation
// continue dans son plan. Peu d'instances (<= ~12), OK sans instancing.
export class PowerUpRenderer {
  public root = new THREE.Group();
  private entries = new Map<string, PowerUpEntry>();
  private geos = new Map<PowerUpType, THREE.BufferGeometry>();
  // Géométrie partagée pour les piliers/anneaux : créées à la demande
  // quand le preset l'autorise.
  private pillarGeo: THREE.CylinderGeometry | null = null;
  private ringGeoEpic: THREE.RingGeometry | null = null;
  private ringGeoLow: THREE.RingGeometry | null = null;
  private mats: Map<PowerUpType, THREE.Material> = new Map();
  private pillarMats: Map<PowerUpType, THREE.MeshBasicMaterial> = new Map();
  private ringMatEpic: THREE.MeshBasicMaterial | null = null;
  private ringMats: Map<PowerUpType, THREE.MeshBasicMaterial> = new Map();
  private disposables: Array<THREE.Material | THREE.BufferGeometry> = [];
  private pillarEnabled: boolean;

  constructor(q: QualityConfig) {
    const simpleMaterials = q.simpleMaterials;
    this.pillarEnabled = q.powerupPillar;
    // Courbes moins découpées en qualité réduite (quelques dizaines de
    // triangles de moins par forme).
    const curveSegments = simpleMaterials ? 6 : 12;
    for (const t of TYPES) {
      const geo = new THREE.ExtrudeGeometry(shapesFor(t), { depth: 0.24, bevelEnabled: false, curveSegments });
      geo.center();
      this.geos.set(t, geo);
      this.disposables.push(geo);
    }
    // Couleurs des power-ups + couleur de l'anneau "epic" tirées du thème
    // actif (palette par type + tier-up high pour la rareté max).
    const theme = getActiveTheme();
    const powerUpColor = theme.palette.powerUpColor;
    const epicRingColor = theme.palette.fx.tierUpHi;
    for (const t of TYPES) {
      const color = powerUpColor[t];
      const mat = simpleMaterials
        ? new THREE.MeshBasicMaterial({ color })
        : new THREE.MeshPhongMaterial({
            color,
            emissive: color,
            emissiveIntensity: glowFor(color),
            shininess: 100,
          });
      this.mats.set(t, mat);
      this.disposables.push(mat);
    }

    if (this.pillarEnabled) {
      const pillarSeg = simpleMaterials ? 8 : 12;
      this.pillarGeo = new THREE.CylinderGeometry(0.35, 0.55, 15, pillarSeg, 1, true);
      this.disposables.push(this.pillarGeo);
      for (const t of TYPES) {
        const color = powerUpColor[t];
        const m = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.28,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        this.pillarMats.set(t, m);
        this.disposables.push(m);
      }
    }

    const ringSeg = simpleMaterials ? 16 : 24;
    this.ringGeoLow = new THREE.RingGeometry(1.2, 1.55, ringSeg);
    this.disposables.push(this.ringGeoLow);
    this.ringMatEpic = new THREE.MeshBasicMaterial({
      color: epicRingColor,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    this.disposables.push(this.ringMatEpic);
    for (const t of TYPES) {
      const color = powerUpColor[t];
      const m = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
      });
      this.ringMats.set(t, m);
      this.disposables.push(m);
    }
  }

  add(id: string, type: PowerUpType, rarity: BladeRarity, x: number, y: number): void {
    if (this.entries.has(id)) return;
    const group = new THREE.Group();
    const mat = this.mats.get(type)!;
    const scale = POWERUP_SCALE * (1 + rarity * 0.15);
    const core = new THREE.Mesh(this.geos.get(type)!, mat);
    core.scale.setScalar(scale);
    // À plat : la forme est dessinée dans le plan XY, extrudée selon Z.
    core.rotation.x = -Math.PI / 2;
    group.add(core);

    // Pilier vertical : seulement si activé par le preset.
    if (this.pillarEnabled && this.pillarGeo) {
      const pillarMat = this.pillarMats.get(type)!;
      const pillar = new THREE.Mesh(this.pillarGeo, pillarMat);
      pillar.position.y = 7.5;
      pillar.scale.set(scale, 1, scale);
      group.add(pillar);
    }

    // Anneau au sol : géométrie partagée, scale par rareté.
    const ringMat = rarity >= BladeRarity.Epic ? this.ringMatEpic! : this.ringMats.get(type)!;
    const ring = new THREE.Mesh(this.ringGeoLow!, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -scale * 0.9;
    ring.scale.set(scale, scale, 1);
    group.add(ring);

    group.position.set(x, scale + 0.3, y);
    this.root.add(group);
    this.entries.set(id, { id, type, rarity, mesh: group, bobPhase: Math.random() * Math.PI * 2 });
  }

  remove(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    this.root.remove(e.mesh);
    this.entries.delete(id);
  }

  clear(): void {
    this.entries.forEach((e) => this.root.remove(e.mesh));
    this.entries.clear();
  }

  update(dt: number, elapsedSec: number): void {
    this.entries.forEach((e) => {
      e.bobPhase += dt;
      const bob = Math.sin(elapsedSec * 2 + e.bobPhase) * 0.2;
      const scale = POWERUP_SCALE * (1 + e.rarity * 0.15);
      e.mesh.position.y = scale + 0.3 + bob;
      // Rotation dans le plan de la forme : la culbute sur deux axes de
      // l'octaèdre rendrait une forme plate illisible.
      e.mesh.rotation.y += dt * 1.6;
    });
  }

  dispose(): void {
    this.entries.forEach((e) => this.root.remove(e.mesh));
    this.entries.clear();
    for (const d of this.disposables) d.dispose();
  }
}
