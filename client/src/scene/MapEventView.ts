import * as THREE from "three";
import { BladeRarity, MapEventKind } from "@bladeio/shared";
import { QualityConfig } from "../quality";
import { getActiveTheme } from "../themes";

// Zone d'un évènement de carte (tâche 4.4) au sol : anneau et disque léger
// pour la pluie de lames (couleur de la rareté rare) et la zone dorée
// (couleur de la légendaire, l'or de tous les thèmes). Pendant l'annonce,
// l'anneau pulse, selon le réglage des flashs ; actif, il est plein. La
// caisse légendaire, elle, est une caisse (CrateRenderer).

export interface MapEventSnapshot {
  kind: number;
  x: number;
  y: number;
  radius: number;
  startsAt: number;
  endsAt: number;
}

export class MapEventView {
  readonly root = new THREE.Group();
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly discMat: THREE.MeshBasicMaterial;
  private readonly disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  private kind: number = MapEventKind.None;
  private flash = 1;

  constructor(q: QualityConfig) {
    const seg = q.playerDetail === "rich" ? 96 : 48;
    // Rayon unité : l'échelle du groupe donne celui de la zone.
    const ringGeo = new THREE.RingGeometry(0.965, 1, seg);
    const discGeo = new THREE.CircleGeometry(0.965, seg);
    this.ringMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
    this.discMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, this.ringMat);
    const disc = new THREE.Mesh(discGeo, this.discMat);
    ring.rotation.x = disc.rotation.x = -Math.PI / 2;
    this.root.add(disc, ring);
    this.root.visible = false;
    this.disposables.push(ringGeo, discGeo, this.ringMat, this.discMat);
  }

  // 0 : pas de pulsation (flashs coupés), 1 : pleine.
  setFlashIntensity(k: number): void {
    this.flash = Math.max(0, Math.min(1, k));
  }

  update(ev: MapEventSnapshot, serverNow: number, elapsedSec: number): void {
    const zone = (ev.kind === MapEventKind.Rain || ev.kind === MapEventKind.Golden) && ev.radius > 0;
    this.root.visible = zone;
    if (!zone) return;
    if (ev.kind !== this.kind) {
      this.kind = ev.kind;
      const rarity = ev.kind === MapEventKind.Golden ? BladeRarity.Legendary : BladeRarity.Rare;
      const color = getActiveTheme().palette.rarityColor[rarity];
      this.ringMat.color.setHex(color);
      this.discMat.color.setHex(color);
    }
    this.root.position.set(ev.x, 0.035, ev.y);
    this.root.scale.set(ev.radius, 1, ev.radius);
    const warning = serverNow < ev.startsAt;
    const pulse = warning ? 0.5 + 0.5 * Math.sin(elapsedSec * 7) : 1;
    this.ringMat.opacity = warning ? 0.6 - 0.35 * this.flash * (1 - pulse) : 0.6;
    this.discMat.opacity = warning ? 0.04 : 0.1;
  }

  dispose(): void {
    this.root.parent?.remove(this.root);
    for (const d of this.disposables) d.dispose();
  }
}
