import * as THREE from "three";
import {
  BladeRarity,
  POWERUP_SCALE,
  PowerUpType,
} from "@bladeio/shared";
import { QualityConfig } from "../quality";
import { POWERUP_COLOR, PALETTE } from "../scene/palette";

interface PowerUpEntry {
  id: string;
  type: PowerUpType;
  rarity: BladeRarity;
  mesh: THREE.Group;
  bobPhase: number;
}

// Octaèdre néon flottant. Couleur par type, taille par rareté. Pulse
// léger + rotation continue. Peu d'instances (<= ~8), OK sans instancing.
export class PowerUpRenderer {
  public root = new THREE.Group();
  private entries = new Map<string, PowerUpEntry>();
  private geo: THREE.OctahedronGeometry;
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
  private octaSeg: number;

  constructor(q: QualityConfig) {
    const simpleMaterials = q.simpleMaterials;
    this.pillarEnabled = q.powerupPillar;
    this.octaSeg = simpleMaterials ? 0 : 0; // Octaedre subdivision
    this.geo = new THREE.OctahedronGeometry(1, this.octaSeg);
    this.disposables.push(this.geo);
    for (const t of [PowerUpType.Speed, PowerUpType.Spin, PowerUpType.Magnet, PowerUpType.Shield, PowerUpType.Blades]) {
      const color = POWERUP_COLOR[t];
      const mat = simpleMaterials
        ? new THREE.MeshBasicMaterial({ color })
        : new THREE.MeshPhongMaterial({
            color,
            emissive: color,
            emissiveIntensity: 1.6,
            shininess: 100,
          });
      this.mats.set(t, mat);
      this.disposables.push(mat);
    }

    if (this.pillarEnabled) {
      const pillarSeg = simpleMaterials ? 8 : 12;
      this.pillarGeo = new THREE.CylinderGeometry(0.35, 0.55, 15, pillarSeg, 1, true);
      this.disposables.push(this.pillarGeo);
      // Un material par type (couleur différente).
      for (const t of [PowerUpType.Speed, PowerUpType.Spin, PowerUpType.Magnet, PowerUpType.Shield, PowerUpType.Blades]) {
        const color = POWERUP_COLOR[t];
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

    // Anneaux au sol — toujours présents (visibilité gameplay).
    const ringSeg = simpleMaterials ? 16 : 24;
    this.ringGeoLow = new THREE.RingGeometry(1.2, 1.55, ringSeg);
    this.disposables.push(this.ringGeoLow);
    this.ringMatEpic = new THREE.MeshBasicMaterial({
      color: PALETTE.sacredGold,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    this.disposables.push(this.ringMatEpic);
    for (const t of [PowerUpType.Speed, PowerUpType.Spin, PowerUpType.Magnet, PowerUpType.Shield, PowerUpType.Blades]) {
      const color = POWERUP_COLOR[t];
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
    const core = new THREE.Mesh(this.geo, mat);
    core.scale.setScalar(scale);
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
      e.mesh.rotation.y += dt * 1.6;
      e.mesh.rotation.x += dt * 0.9;
    });
  }

  dispose(): void {
    this.entries.forEach((e) => this.root.remove(e.mesh));
    this.entries.clear();
    for (const d of this.disposables) d.dispose();
  }
}
