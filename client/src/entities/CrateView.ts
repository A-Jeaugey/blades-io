import * as THREE from "three";
import { CRATE_SCALE } from "@bladeio/shared";
import { QualityConfig } from "../quality";
import { getActiveTheme } from "../themes";

interface CrateEntry {
  id: string;
  mesh: THREE.Group;
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
    if (this.wireframeEnabled) {
      this.wireGeo = new THREE.EdgesGeometry(this.boxGeo);
      this.wireMat = new THREE.LineBasicMaterial({
        color: t.palette.crate.edge,
        transparent: true,
        opacity: 0.9,
      });
      this.materials.push(this.wireMat);
    }
  }

  add(id: string, x: number, y: number, hp: number, maxHp: number): void {
    if (this.entries.has(id)) return;
    const group = new THREE.Group();
    const inner = new THREE.Mesh(this.boxGeo, this.innerMat);
    group.add(inner);
    if (this.wireframeEnabled && this.wireGeo && this.wireMat) {
      const wire = new THREE.LineSegments(this.wireGeo, this.wireMat);
      group.add(wire);
    }
    group.position.set(x, CRATE_SCALE, y);
    this.root.add(group);
    this.entries.set(id, {
      id, mesh: group, hp, maxHp,
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
      e.mesh.position.y = CRATE_SCALE + bob;
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
