import * as THREE from "three";
import { QualityConfig } from "../quality";
import { fxIntensity } from "./flash";

// Zone de l'aimant (power-up Magnet, retour de jeu du 2026-10-12) autour du
// joueur local tant que l'effet dure : on voit jusqu'où les lames au sol
// viennent à soi, donc où aller les chercher. Un anneau discret au sol, à la
// couleur du power-up dans le thème, qui s'ouvre au ramassage et s'efface
// dans la dernière seconde. Des ondes qui se resserrent vers le joueur
// disent le sens de l'aspiration (deux en qualité haute et moyenne, une en
// basse, aucune en « potato », où l'anneau a aussi moins de facettes).
// Lumière additive et fine, à ras du sol : elle ne cache ni une lame ni un
// joueur. Seul le joueur local la voit (les autres n'ont pas besoin de
// savoir où porte son aimant).

const Y = 0.045;
const RING_ALPHA = 0.2;
const DISC_ALPHA = 0.035;
const WAVE_ALPHA = 0.14;
// Ouverture au ramassage (s), et fondu final (ms).
const OPEN_S = 0.3;
const FADE_MS = 1000;
// Une onde va du bord au joueur en 1 / WAVE_RATE s.
const WAVE_RATE = 0.9;

export class MagnetRing {
  readonly root = new THREE.Group();
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly discMat: THREE.MeshBasicMaterial;
  private readonly waveMats: THREE.MeshBasicMaterial[] = [];
  private readonly waves: THREE.Mesh[] = [];
  private readonly ring: THREE.Mesh;
  private readonly disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  private flash = 1;
  // Temps depuis l'ouverture (s) ; < 0 : fermé.
  private openFor = -1;

  constructor(q: QualityConfig, color: number) {
    const detail = q.fx.detail;
    const seg = Math.max(32, q.fx.ringSegments * 2);
    // Rayon unité : l'échelle donne celui de l'aimant.
    const ringGeo = new THREE.RingGeometry(0.985, 1, seg);
    const material = (alpha: number) => new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: alpha,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ringMat = material(RING_ALPHA);
    this.discMat = material(DISC_ALPHA);
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.root.add(this.ring);
    this.disposables.push(ringGeo, this.ringMat, this.discMat);
    if (detail !== "minimal") {
      const discGeo = new THREE.CircleGeometry(0.985, seg);
      const disc = new THREE.Mesh(discGeo, this.discMat);
      disc.rotation.x = -Math.PI / 2;
      this.root.add(disc);
      this.disposables.push(discGeo);
      const waveGeo = new THREE.RingGeometry(0.96, 1, seg);
      this.disposables.push(waveGeo);
      const count = detail === "rich" ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const mat = material(0);
        const wave = new THREE.Mesh(waveGeo, mat);
        wave.rotation.x = -Math.PI / 2;
        this.root.add(wave);
        this.waves.push(wave);
        this.waveMats.push(mat);
        this.disposables.push(mat);
      }
    }
    this.root.visible = false;
    this.root.renderOrder = 1;
  }

  setFlashIntensity(k: number): void {
    this.flash = k;
  }

  // active : l'effet dure ; (x, z) : position dessinée du joueur ; radius :
  // rayon de l'aimant ; remainingMs : temps restant de l'effet.
  update(active: boolean, x: number, z: number, radius: number, remainingMs: number, dt: number, elapsedSec: number): void {
    if (!active) {
      this.openFor = -1;
      if (this.root.visible) this.root.visible = false;
      return;
    }
    this.openFor = this.openFor < 0 ? 0 : this.openFor + dt;
    // Ouverture : de 60 % à 100 % du rayon, en ralentissant.
    const o = Math.min(1, this.openFor / OPEN_S);
    const open = 1 - (1 - o) * (1 - o);
    const fade = Math.max(0, Math.min(1, remainingMs / FADE_MS));
    const r = radius * (0.6 + 0.4 * open);
    this.root.visible = true;
    this.root.position.set(x, Y, z);
    this.root.scale.set(r, 1, r);
    this.ringMat.opacity = RING_ALPHA * (0.4 + 0.6 * open) * fade;
    this.discMat.opacity = DISC_ALPHA * fade;
    const k = fxIntensity(this.flash) * fade * open;
    for (let i = 0; i < this.waves.length; i++) {
      // Phase de 0 (au bord) à 1 (au joueur) : l'onde rétrécit et s'éteint
      // aux deux bouts.
      const p = (elapsedSec * WAVE_RATE + i / this.waves.length) % 1;
      const s = Math.max(0.02, 1 - p);
      this.waves[i].scale.set(s, s, 1);
      this.waveMats[i].opacity = WAVE_ALPHA * k * Math.sin(p * Math.PI);
    }
  }

  dispose(): void {
    this.root.parent?.remove(this.root);
    for (const d of this.disposables) d.dispose();
  }
}
