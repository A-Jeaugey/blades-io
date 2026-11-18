import * as THREE from "three";
import { CRATE_SCALE, CrateKind } from "@bladeio/shared";
import { QualityConfig } from "../quality";
import { getActiveTheme } from "../themes";
import { ChipKit, VAULT_GAUGE_SEGMENTS, VaultKit } from "./eventModels";

// Puce restée entière au sol (chute de processeurs) : plus grosse que la
// puce qui tombe, à la taille de sa hitbox (CHIP_HITBOX), à moitié plantée
// et penchée par l'impact.
const CHIP_CRATE_SCALE = 1.25;
// Décor interactif (shared/src/interactive.ts) : un rack à butin ou un
// obélisque qui se charge n'a pas de modèle à lui (la pièce est dans le
// décor, dans les deux rendus). Ce qui se joue se lit au sol : une jauge en
// anneau autour de la pièce (rack : ce qu'il lui reste ; obélisque : sa
// charge), et un losange qui tourne au-dessus d'un rack plein. Pièce vidée
// ou au repos : plus rien.
const SITE_GAUGE_SEGMENTS = 48;
const RACK_GAUGE_RADIUS = 2.5;
const OBELISK_GAUGE_RADIUS = 2.7;
const RACK_MARKER_Y = 4.7;

// Un coup sur le coffre : au plus un effet (étincelles, son) par intervalle.
// Une orbite de 40 lames le touche ~200 fois par seconde : un effet par
// coup saturait les particules et le son.
const VAULT_FX_INTERVAL_MS = 70;

interface CrateEntry {
  id: string;
  kind: number;
  mesh: THREE.Group;
  // Hauteur du centre.
  baseY: number;
  hp: number;
  maxHp: number;
  bobPhase: number;
  shake: number;
  // Coffre-fort : molette, sa vitesse (rad/s, relancée à chaque coup),
  // jauge des PV et dernier effet joué.
  dial: THREE.Object3D | null;
  dialSpeed: number;
  gauge: THREE.Mesh | null;
  // Décor interactif : géométrie de la jauge (une par pièce, sa part
  // dessinée lui est propre) et losange d'un rack.
  siteGeo: THREE.BufferGeometry | null;
  marker: THREE.Object3D | null;
  lastFxAt: number;
  x: number;
  z: number;
}

export class CrateRenderer {
  public root = new THREE.Group();
  // Modèles des caisses d'évènement ; la chute de processeurs reprend la
  // puce (ProcessorFallView).
  readonly chipKit: ChipKit;
  private readonly vaultKit: VaultKit;
  private entries = new Map<string, CrateEntry>();
  private boxGeo: THREE.BoxGeometry;
  private wireGeo: THREE.EdgesGeometry | null = null;
  private materials: THREE.Material[] = [];
  private innerMat: THREE.Material;
  private wireMat: THREE.LineBasicMaterial | null = null;
  private wireframeEnabled: boolean;
  // Lueurs des caisses d'évènement : couleur du thème, modulée à chaque
  // image (au-dessus de 1 avec post-FX, pour le bloom).
  private readonly vaultGlow = new THREE.Color();
  private readonly chipCore = new THREE.Color();
  private readonly hdr: boolean;
  private flash = 1;
  // Décor interactif : jauges (pleine, fond) et losange, aux couleurs du
  // thème (celle des caisses pour le rack, celle de l'obélisque pour le sien).
  private readonly rackGauge: THREE.MeshBasicMaterial;
  private readonly rackGaugeBack: THREE.MeshBasicMaterial;
  private readonly obeliskGauge: THREE.MeshBasicMaterial;
  private readonly obeliskGaugeBack: THREE.MeshBasicMaterial;
  private readonly markerGeo = new THREE.OctahedronGeometry(0.45, 0);
  private readonly markerMat: THREE.MeshBasicMaterial;

  constructor(q: QualityConfig) {
    const simpleMaterials = q.simpleMaterials;
    this.wireframeEnabled = q.crateWireframe;
    this.hdr = q.postFx;
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
    const ring = (color: number, opacity: number) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    this.rackGauge = ring(t.palette.crate.edge, 0.75);
    this.rackGaugeBack = ring(t.palette.crate.edge, 0.13);
    this.obeliskGauge = ring(t.decor.obeliskInner, 0.8);
    this.obeliskGaugeBack = ring(t.decor.obeliskInner, 0.13);
    this.markerMat = new THREE.MeshBasicMaterial({ color: t.palette.crate.edge });
    this.materials.push(this.rackGauge, this.rackGaugeBack, this.obeliskGauge, this.obeliskGaugeBack, this.markerMat);
    if (this.wireframeEnabled) {
      this.wireGeo = new THREE.EdgesGeometry(this.boxGeo);
      this.wireMat = new THREE.LineBasicMaterial({
        color: t.palette.crate.edge,
        transparent: true,
        opacity: 0.9,
      });
      this.materials.push(this.wireMat);
    }
    this.vaultKit = new VaultKit(q, t.palette);
    this.chipKit = new ChipKit(q, t.palette);
    this.vaultGlow.setHex(t.palette.mapEvent.vaultGlow);
    this.chipCore.setHex(t.palette.mapEvent.chipCore);
  }

  // Pulsations et éclats des caisses d'évènement (0 : coupés).
  setFlashIntensity(k: number): void {
    this.flash = Math.max(0, Math.min(1, k));
  }

  add(id: string, x: number, y: number, hp: number, maxHp: number, kind: number = CrateKind.Normal): void {
    if (this.entries.has(id)) return;
    let group: THREE.Group;
    let baseY: number;
    let dial: THREE.Object3D | null = null;
    let gauge: THREE.Mesh | null = null;
    let siteGeo: THREE.BufferGeometry | null = null;
    let marker: THREE.Object3D | null = null;
    if (kind === CrateKind.Rack || kind === CrateKind.Obelisk) {
      const rack = kind === CrateKind.Rack;
      const r = rack ? RACK_GAUGE_RADIUS : OBELISK_GAUGE_RADIUS;
      group = new THREE.Group();
      siteGeo = new THREE.RingGeometry(r - 0.22, r, SITE_GAUGE_SEGMENTS, 1);
      const back = new THREE.Mesh(siteGeo, rack ? this.rackGaugeBack : this.obeliskGaugeBack);
      gauge = new THREE.Mesh(siteGeo.clone(), rack ? this.rackGauge : this.obeliskGauge);
      for (const m of [back, gauge]) {
        m.rotation.x = -Math.PI / 2;
        m.position.y = 0.06;
        group.add(m);
      }
      if (rack) {
        marker = new THREE.Mesh(this.markerGeo, this.markerMat);
        marker.position.y = RACK_MARKER_Y;
        group.add(marker);
      }
      baseY = 0;
    } else if (kind === CrateKind.Vault) {
      // Posé au sol, porte face à la caméra : ni flottement ni rotation.
      const parts = this.vaultKit.build();
      group = parts.group;
      dial = parts.dial;
      gauge = parts.gauge;
      baseY = 0;
    } else if (kind === CrateKind.Chip) {
      group = new THREE.Group();
      const chip = this.chipKit.build().group;
      // Penchée et à moitié plantée : elle vient de tomber du ciel.
      chip.rotation.set(0.22, Math.random() * Math.PI * 2, -0.14);
      chip.scale.setScalar(CHIP_CRATE_SCALE);
      group.add(chip);
      baseY = 0.12;
    } else {
      group = new THREE.Group();
      group.add(new THREE.Mesh(this.boxGeo, this.innerMat));
      if (this.wireframeEnabled && this.wireGeo && this.wireMat) group.add(new THREE.LineSegments(this.wireGeo, this.wireMat));
      baseY = CRATE_SCALE;
    }
    group.position.set(x, baseY, y);
    this.root.add(group);
    this.entries.set(id, {
      id, kind, mesh: group, baseY, hp, maxHp,
      bobPhase: Math.random() * Math.PI * 2,
      shake: 0,
      dial, dialSpeed: 0, gauge, siteGeo, marker, lastFxAt: -Infinity,
      x, z: y,
    });
    const e = this.entries.get(id)!;
    if (siteGeo) this.setSiteGauge(e);
    else if (gauge) this.setGauge(gauge, hp, maxHp);
  }

  // PV lus dans l'état, hors de tout coup (charge d'un obélisque qui
  // retombe) : la jauge suit, sans effet.
  setHp(id: string, hp: number): void {
    const e = this.entries.get(id);
    if (!e || !e.siteGeo) return;
    e.hp = hp;
    this.setSiteGauge(e);
  }

  // Genre de la caisse (CrateKind), -1 si elle n'est pas (ou plus) là.
  kindOf(id: string): number {
    return this.entries.get(id)?.kind ?? -1;
  }

  // Coup reçu : vrai si l'appelant doit jouer son effet (le coffre en
  // espace les effets, cf. VAULT_FX_INTERVAL_MS).
  hit(id: string, hp: number): boolean {
    const e = this.entries.get(id);
    if (!e) return false;
    e.hp = hp;
    e.shake = 1;
    if (e.siteGeo) {
      // Rack, obélisque : frappés aussi souvent qu'un coffre, effets
      // espacés de même.
      this.setSiteGauge(e);
      const t = performance.now();
      if (t - e.lastFxAt < VAULT_FX_INTERVAL_MS) return false;
      e.lastFxAt = t;
      return true;
    }
    if (e.kind !== CrateKind.Vault) return true;
    // La molette tourne sous les coups, plus vite quand il cède.
    e.dialSpeed = Math.min(14, e.dialSpeed + 3);
    if (e.gauge) this.setGauge(e.gauge, hp, e.maxHp);
    const now = performance.now();
    if (now - e.lastFxAt < VAULT_FX_INTERVAL_MS) return false;
    e.lastFxAt = now;
    return true;
  }

  remove(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    this.root.remove(e.mesh);
    this.disposeSite(e);
    this.entries.delete(id);
  }

  clear(): void {
    this.entries.forEach((e) => {
      this.root.remove(e.mesh);
      this.disposeSite(e);
    });
    this.entries.clear();
  }

  // Jauge d'une pièce du décor interactif : ses deux géométries (fond,
  // part pleine) sont les siennes.
  private disposeSite(e: CrateEntry): void {
    if (!e.siteGeo) return;
    e.siteGeo.dispose();
    e.gauge?.geometry.dispose();
  }

  // Rack : ce qu'il lui reste. Obélisque : sa charge (ses PV perdus).
  private setSiteGauge(e: CrateEntry): void {
    if (!e.gauge) return;
    const left = e.maxHp > 0 ? Math.max(0, Math.min(1, e.hp / e.maxHp)) : 0;
    const frac = e.kind === CrateKind.Obelisk ? 1 - left : left;
    e.gauge.geometry.setDrawRange(0, 6 * Math.ceil(SITE_GAUGE_SEGMENTS * frac));
  }

  update(dt: number, elapsedSec: number): void {
    let vault: CrateEntry | null = null;
    this.entries.forEach((e) => {
      if (e.kind === CrateKind.Vault) {
        vault = e;
        this.updateVault(e, dt);
        return;
      }
      if (e.kind === CrateKind.Chip) {
        this.updateChip(e, dt);
        return;
      }
      if (e.siteGeo) {
        // Posée au sol, immobile ; seul le losange du rack tourne et flotte.
        if (e.marker) {
          e.marker.rotation.y += dt * 1.6;
          e.marker.position.y = RACK_MARKER_Y + Math.sin(elapsedSec * 2 + e.bobPhase) * 0.18;
        }
        return;
      }
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
    // Joints du coffre : plus vifs et plus rapides à mesure qu'il cède,
    // éclat à chaque coup ; pulsation et éclat suivent le réglage des
    // flashs. Matériau partagé : un seul coffre à la fois.
    const v = vault as CrateEntry | null;
    const damage = v && v.maxHp > 0 ? 1 - v.hp / v.maxHp : 0;
    const pulse = 0.5 + 0.5 * Math.sin(elapsedSec * (2 + 7 * damage));
    const lit = 0.55 + 0.25 * damage + 0.2 * pulse * this.flash + 0.35 * (v?.shake ?? 0) * this.flash;
    this.vaultKit.glowMat.color.copy(this.vaultGlow).multiplyScalar(this.hdr ? 0.6 + 1.6 * lit : Math.min(1, lit));
    // Cœur des puces : battement lent, le même pour toutes.
    const beat = 0.75 + 0.25 * Math.sin(elapsedSec * 3.2) * this.flash;
    this.chipKit.coreMat.color.copy(this.chipCore).multiplyScalar(this.hdr ? 0.8 + 1.2 * beat : beat);
  }

  private updateVault(e: CrateEntry, dt: number): void {
    // Molette : rotation lente au repos, relancée à chaque coup.
    e.dialSpeed *= Math.exp(-dt / 0.45);
    if (e.dial) e.dial.rotation.z -= (0.3 + e.dialSpeed) * dt;
    // Secousse : un léger tremblement du caisson, pas un roulis (il est
    // lourd).
    if (e.shake > 0) {
      e.shake *= Math.exp(-dt / 0.1);
      if (e.shake < 0.01) e.shake = 0;
      const j = e.shake * 0.06;
      e.mesh.position.x = e.x + (Math.random() - 0.5) * j;
      e.mesh.position.z = e.z + (Math.random() - 0.5) * j;
    } else if (e.mesh.position.x !== e.x || e.mesh.position.z !== e.z) {
      e.mesh.position.x = e.x;
      e.mesh.position.z = e.z;
    }
  }

  private updateChip(e: CrateEntry, dt: number): void {
    if (e.shake > 0) {
      e.shake *= Math.exp(-dt / 0.12);
      if (e.shake < 0.01) e.shake = 0;
      const j = e.shake * 0.12;
      e.mesh.rotation.x = (Math.random() - 0.5) * j;
      e.mesh.rotation.z = (Math.random() - 0.5) * j;
    } else if (e.mesh.rotation.x !== 0 || e.mesh.rotation.z !== 0) {
      e.mesh.rotation.x = 0;
      e.mesh.rotation.z = 0;
    }
  }

  // Jauge au sol : la part des PV qui reste, en segments de l'anneau
  // (6 indices par segment, une couronne d'une seule rangée).
  private setGauge(gauge: THREE.Mesh, hp: number, maxHp: number): void {
    const frac = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
    gauge.geometry.setDrawRange(0, 6 * Math.ceil(VAULT_GAUGE_SEGMENTS * frac));
  }

  dispose(): void {
    this.entries.forEach((e) => this.root.remove(e.mesh));
    this.entries.clear();
    this.markerGeo.dispose();
    this.boxGeo.dispose();
    this.wireGeo?.dispose();
    for (const m of this.materials) m.dispose();
    this.vaultKit.dispose();
    this.chipKit.dispose();
  }
}
