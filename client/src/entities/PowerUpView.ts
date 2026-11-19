import * as THREE from "three";
import {
  BladeRarity,
  POWERUP_SCALE,
  PowerUpType,
} from "@bladeio/shared";
import { QualityConfig } from "../quality";
import { kitFor } from "../scene/v2/kit";
import { getActiveTheme } from "../themes";
import { powerUpGeometry } from "./powerUpShapes";

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
    // Rendu v2 : les mêmes formes, retravaillées dans Blender (chanfreins,
    // anneau), tirées du kit ; partagées avec lui, jamais libérées ici.
    const kit = kitFor(simpleMaterials);
    for (const t of TYPES) {
      if (kit) {
        this.geos.set(t, kit.geometry(`PowerUp${t}`));
        continue;
      }
      const geo = powerUpGeometry(t, curveSegments);
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
