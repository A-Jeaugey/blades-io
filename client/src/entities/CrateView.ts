import * as THREE from "three";
import { BladeRarity, CRATE_SCALE } from "@bladeio/shared";
import { QualityConfig } from "../quality";
import { getActiveTheme } from "../themes";

const LEGENDARY_SCALE = 1.35;

interface CrateEntry {
  id: string;
  mesh: THREE.Group;
  // Hauteur du centre : la caisse légendaire, plus grosse, flotte plus haut.
  baseY: number;
  hp: number;
  maxHp: number;
  bobPhase: number;
  shake: number;
}

export class CrateRenderer {
  public root = new THREE.Group();
  private entries = new Map<string, CrateEntry>();
  private boxGeo: THREE.BoxGeometry;
  private wireGeo: THREE.EdgesGeometry | null = null;
  private materials: THREE.Material[] = [];
  private innerMat: THREE.Material;
  private wireMat: THREE.LineBasicMaterial | null = null;
  // Caisse légendaire (évènement de carte, tâche 4.4) : couleur de la
  // rareté légendaire, plus grosse.
  private legendaryMat: THREE.Material;
  private legendaryWireMat: THREE.LineBasicMaterial | null = null;
  private wireframeEnabled: boolean;

  constructor(q: QualityConfig) {
    const simpleMaterials = q.simpleMaterials;
    this.wireframeEnabled = q.crateWireframe;
    const s = CRATE_SCALE;
    this.boxGeo = new THREE.BoxGeometry(s * 1.6, s * 1.6, s * 1.6);
    // Couleurs de la caisse tirées du thème actif (primary/emissive/edge).
    const t = getActiveTheme();
    this.innerMat = simpleMaterials
      ? new THREE.MeshBasicMaterial({ color: t.palette.crate.primary, transparent: true, opacity: 0.4 })
      : new THREE.MeshPhongMaterial({
          color: t.palette.crate.primary,
          emissive: t.palette.crate.emissive,
          emissiveIntensity: 0.85,
          shininess: 60,
          transparent: true,
          opacity: 0.5,
        });
    this.materials.push(this.innerMat);
    const gold = t.palette.rarityColor[BladeRarity.Legendary];
    this.legendaryMat = simpleMaterials
      ? new THREE.MeshBasicMaterial({ color: gold, transparent: true, opacity: 0.55 })
      : new THREE.MeshPhongMaterial({
          color: gold,
          emissive: gold,
          emissiveIntensity: 0.7,
          shininess: 80,
          transparent: true,
          opacity: 0.6,
        });
    this.materials.push(this.legendaryMat);
    if (this.wireframeEnabled) {
      this.wireGeo = new THREE.EdgesGeometry(this.boxGeo);
      this.wireMat = new THREE.LineBasicMaterial({
        color: t.palette.crate.edge,
        transparent: true,
        opacity: 0.9,
      });
      this.legendaryWireMat = new THREE.LineBasicMaterial({ color: gold, transparent: true, opacity: 0.95 });
      this.materials.push(this.wireMat, this.legendaryWireMat);
    }
  }

  add(id: string, x: number, y: number, hp: number, maxHp: number, legendary = false): void {
    if (this.entries.has(id)) return;
    const group = new THREE.Group();
    const inner = new THREE.Mesh(this.boxGeo, legendary ? this.legendaryMat : this.innerMat);
    group.add(inner);
    const wireMat = legendary ? this.legendaryWireMat : this.wireMat;
    if (this.wireframeEnabled && this.wireGeo && wireMat) {
      const wire = new THREE.LineSegments(this.wireGeo, wireMat);
      group.add(wire);
    }
    if (legendary) group.scale.setScalar(LEGENDARY_SCALE);
    const baseY = CRATE_SCALE * (legendary ? LEGENDARY_SCALE : 1);
    group.position.set(x, baseY, y);
    this.root.add(group);
    this.entries.set(id, {
      id, mesh: group, baseY, hp, maxHp,
      bobPhase: Math.random() * Math.PI * 2,
      shake: 0,
    });
  }

  hit(id: string, hp: number): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.hp = hp;
    e.shake = 1;
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
      const bob = Math.sin(elapsedSec * 1.6 + e.bobPhase) * 0.15;
      e.mesh.position.y = e.baseY + bob;
      e.mesh.rotation.y += dt * 0.6;
      if (e.shake > 0) {
        e.shake *= Math.exp(-dt / 0.12);
        if (e.shake < 0.01) e.shake = 0;
        const j = e.shake * 0.15;
        e.mesh.rotation.x = (Math.random() - 0.5) * j;
        e.mesh.rotation.z = (Math.random() - 0.5) * j;
      } else if (e.mesh.rotation.x !== 0 || e.mesh.rotation.z !== 0) {
        e.mesh.rotation.x = 0;
        e.mesh.rotation.z = 0;
      }
    });
  }

  dispose(): void {
    this.entries.forEach((e) => this.root.remove(e.mesh));
    this.entries.clear();
    this.boxGeo.dispose();
    this.wireGeo?.dispose();
    for (const m of this.materials) m.dispose();
  }
}
