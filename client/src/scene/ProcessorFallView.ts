import * as THREE from "three";
import { PROCESSOR_ALERT_RADIUS, PROCESSOR_COUNT_MAX, PROCESSOR_FALL_MS, PROCESSOR_WARNING_MS } from "@bladeio/shared";
import { ChipKit } from "../entities/eventModels";
import { fxIntensity } from "../fx/flash";
import { QualityConfig } from "../quality";
import { getActiveTheme } from "../themes";

// Chute de processeurs (retours du 2026-10-12) : pour chaque puce, un
// cercle d'alerte au sol dès l'annonce, qui se remplit jusqu'à l'impact,
// puis la puce qui tombe en tournoyant, une traînée derrière elle
// (incandescente, à bandes « glitch » en haute qualité). L'impact lui-même
// (onde, étincelles, son) est joué par main.ts au tick de l'évènement.
//
// Tout est réglé sur l'heure du serveur au tick de rendu (80 ms dans le
// passé, comme les entités) : la puce touche le sol à l'image où l'impact
// est joué. Un emplacement par puce possible (PROCESSOR_COUNT_MAX), créé
// d'avance : rien n'est créé en partie, tout est compilé au lobby.

export interface DropSnapshot {
  x: number;
  y: number;
  // Heure du serveur de l'impact.
  at: number;
}

// Départ de la chute, par rapport au point d'impact (x, hauteur, z) :
// d'en haut, un peu de côté et du fond de l'écran (la caméra regarde vers
// -z), pour une trajectoire de météorite lisible. Assez bas pour que la
// puce entre dans le champ à mi-chute (caméra à ~22 u de haut, 54°).
const FALL_FROM = new THREE.Vector3(5, 22, -7);
// Puce en vol plus grosse qu'au sol : un repère de loin.
const FALL_SCALE = 1.4;
const FALL_DIR = FALL_FROM.clone().normalize();
const UP = new THREE.Vector3(0, 1, 0);
const TRAIL_MAX = 11;

const TRAIL_VERT = /* glsl */ `
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

// Traînée : vUv.y vaut 0 contre la puce et 1 au bout. Plus chaude et plus
// opaque contre la puce, éteinte au bout ; en haute qualité, des bandes
// qui défilent vers le haut (le « glitch »), atténuées avec le réglage des
// flashs (uGlitch), comme l'éclat de la traînée (uIntensity, fxIntensity).
// Mélange additif : de la lumière par-dessus la scène.
const TRAIL_FRAG = /* glsl */ `
precision mediump float;
uniform vec3 uHead;
uniform vec3 uTail;
uniform float uTime;
uniform float uGlitch;
uniform float uIntensity;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  float head = 1.0 - clamp(vUv.y, 0.0, 1.0);
  float a = head * head * uIntensity;
  float band = step(0.55, fract(vUv.y * 9.0 - uTime * 7.0));
  a *= mix(1.0, 0.3 + 0.7 * band, uGlitch);
  #ifdef USE_FOG
    a *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor = vec4(mix(uTail, uHead, head), a);
  #include <colorspace_fragment>
}
`;

interface Slot {
  alert: THREE.Group;
  ring: THREE.Mesh;
  fill: THREE.Mesh;
  chip: THREE.Group;
  trail: THREE.Mesh;
}

export class ProcessorFallView {
  readonly root = new THREE.Group();
  private readonly slots: Slot[] = [];
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly fillMat: THREE.MeshBasicMaterial;
  private readonly trailMat: THREE.ShaderMaterial;
  private readonly disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  private readonly glitch: boolean;
  private flash = 1;
  // Première image : tout est dessiné une fois sous le sol, pour que les
  // pilotes préparent les pipelines au lobby (cf. CombatFx).
  private warm = true;
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly back = new THREE.Vector3();

  constructor(q: QualityConfig, kit: ChipKit) {
    const c = getActiveTheme().palette.mapEvent;
    const seg = q.fx.detail === "rich" ? 48 : q.fx.detail === "simple" ? 32 : 20;
    this.glitch = q.fx.detail === "rich";
    // Rayon unité : l'échelle du groupe donne PROCESSOR_ALERT_RADIUS.
    const ringGeo = new THREE.RingGeometry(0.9, 1, seg);
    const fillGeo = new THREE.CircleGeometry(0.9, seg);
    this.ringMat = new THREE.MeshBasicMaterial({ color: c.chipCore, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
    this.fillMat = new THREE.MeshBasicMaterial({ color: c.chipCore, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide });
    // Cône ouvert, base (rayon 0,8) contre la puce, pointe au bout :
    // longueur unité le long de +y, orienté et étiré à chaque image.
    const trailGeo = new THREE.CylinderGeometry(0.05, 0.8, 1, q.fx.detail === "minimal" ? 6 : 10, 1, true).translate(0, 0.5, 0);
    this.trailMat = new THREE.ShaderMaterial({
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uHead: { value: new THREE.Color(c.chipCore) },
        uTail: { value: new THREE.Color(c.chipTrail) },
        uTime: { value: 0 },
        uGlitch: { value: this.glitch ? 1 : 0 },
        uIntensity: { value: 1 },
      }]),
      fog: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.disposables.push(ringGeo, fillGeo, trailGeo, this.ringMat, this.fillMat, this.trailMat);
    for (let i = 0; i < PROCESSOR_COUNT_MAX; i++) {
      const alert = new THREE.Group();
      const ring = new THREE.Mesh(ringGeo, this.ringMat);
      const fill = new THREE.Mesh(fillGeo, this.fillMat);
      ring.rotation.x = fill.rotation.x = -Math.PI / 2;
      alert.add(fill, ring);
      alert.scale.setScalar(PROCESSOR_ALERT_RADIUS);
      const chip = kit.build().group;
      chip.scale.setScalar(FALL_SCALE);
      const trail = new THREE.Mesh(trailGeo, this.trailMat);
      // Sommets placés par l'échelle et l'orientation : la sphère englobante
      // du cône unité ne dit rien de son étendue.
      trail.frustumCulled = false;
      alert.visible = chip.visible = trail.visible = false;
      this.root.add(alert, chip, trail);
      this.slots.push({ alert, ring, fill, chip, trail });
    }
  }

  // 0 : ni pulsation ni bandes (flashs coupés), 1 : pleines.
  setFlashIntensity(k: number): void {
    this.flash = Math.max(0, Math.min(1, k));
    this.trailMat.uniforms.uGlitch.value = this.glitch ? this.flash : 0;
    this.trailMat.uniforms.uIntensity.value = fxIntensity(this.flash);
  }

  // drops : puces de l'évènement en cours (vide sinon) ; renderMs : heure
  // du serveur au tick de rendu.
  update(drops: readonly DropSnapshot[], renderMs: number, dt: number, elapsedSec: number): void {
    this.trailMat.uniforms.uTime.value = elapsedSec;
    if (this.warm) {
      this.warm = false;
      for (const s of this.slots) {
        s.alert.visible = s.chip.visible = s.trail.visible = true;
        s.alert.position.set(0, -60, 0);
        s.chip.position.set(0, -60, 0);
        s.trail.position.set(0, -60, 0);
      }
      return;
    }
    const pulse = 0.5 + 0.5 * Math.sin(elapsedSec * 8);
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      const d = i < drops.length ? drops[i] : null;
      // Avant l'impact au tick de rendu, quel que soit ce que l'état dit
      // déjà (il a 80 ms d'avance) ; après, l'impact a pris le relais.
      const left = d ? d.at - renderMs : -1;
      if (!d || left <= 0) {
        if (s.alert.visible) s.alert.visible = s.chip.visible = s.trail.visible = false;
        continue;
      }
      s.alert.visible = true;
      s.alert.position.set(d.x, 0.045, d.y);
      // Le disque se remplit pendant les dernières secondes.
      const fill = 1 - Math.min(1, left / PROCESSOR_WARNING_MS);
      s.fill.scale.setScalar(Math.max(0.02, fill));
      this.ringMat.opacity = 0.65 - 0.3 * this.flash * (1 - pulse);
      const falling = left <= PROCESSOR_FALL_MS;
      s.chip.visible = s.trail.visible = falling;
      if (!falling) continue;
      // Vitesse constante, comme une météorite (déjà lancée à l'entrée
      // dans le champ) : visible la moitié de sa chute.
      const p = 1 - left / PROCESSOR_FALL_MS;
      const k = 1 - p;
      s.chip.position.set(d.x + FALL_FROM.x * k, 0.4 + FALL_FROM.y * k, d.y + FALL_FROM.z * k);
      s.chip.rotation.x += dt * 7;
      s.chip.rotation.z += dt * 4.5;
      // Traînée vers le haut de la trajectoire, plus longue à mesure qu'elle
      // prend de la vitesse.
      this.back.copy(FALL_DIR);
      this.tmpQuat.setFromUnitVectors(UP, this.back);
      s.trail.quaternion.copy(this.tmpQuat);
      s.trail.position.copy(s.chip.position);
      const len = TRAIL_MAX * Math.min(1, 0.3 + p);
      s.trail.scale.set(1, len, 1);
    }
  }

  clear(): void {
    for (const s of this.slots) s.alert.visible = s.chip.visible = s.trail.visible = false;
  }

  dispose(): void {
    this.root.parent?.remove(this.root);
    for (const d of this.disposables) d.dispose();
  }
}
