import * as THREE from "three";
import { CAMERA_DISTANCE, CAMERA_FOV_DEG, CAMERA_PITCH_DEG } from "@bladeio/shared";
import { CAM_ISO, ISO_FOV_DEG } from "../gfx";
import { QualityConfig } from "../quality";
import { getActiveTheme } from "../themes";
import { gfxV2Active } from "./v2/kit";

// Lune du rendu v2 : direction vers laquelle on la voit depuis le sol
// (derrière et à gauche de la caméra d'origine : les ombres tombent vers le
// joueur, là où elles se lisent), demi-côté de la zone d'ombres autour du
// point suivi et distance de la lumière.
const MOON_DIR = new THREE.Vector3(-0.42, 0.76, -0.49).normalize();
const SHADOW_HALF = 48;
const SHADOW_DISTANCE = 90;

export class SceneStack {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  // Resolution scale courant — peut varier en runtime (résolution
  // dynamique). Le pixelRatio effectif appliqué = min(devicePR, q.pixelRatio)
  // × resScale.
  private resScale: number;
  private basePixelRatio: number;
  // Brouillard pour la distance de caméra de base (CAMERA_DISTANCE).
  private fogNear: number;
  private fogFar: number;
  // Rendu v2 : la lune, seule lumière qui porte une ombre, et le repère de
  // sa carte d'ombres (axes perpendiculaires à sa direction).
  private moon: THREE.DirectionalLight | null = null;
  private shadowRight = new THREE.Vector3();
  private shadowUp = new THREE.Vector3();
  private shadowTexel = 1;

  constructor(canvas: HTMLCanvasElement, q: QualityConfig) {
    this.basePixelRatio = q.pixelRatio;
    this.resScale = q.resScale;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      // Avec post-FX, le canvas ne reçoit que la passe finale (un triangle
      // plein écran) : son MSAA ne servait à rien et coûtait de la mémoire
      // et de la bande passante à chaque image. L'AA vient alors de la
      // cible de la scène (PostFX, q.samples).
      antialias: q.antialias && !q.postFx,
      powerPreference: "high-performance",
      // Évite la lecture pixel par pixel pour les screenshots ; gain mineur
      // mais gratuit côté code.
      preserveDrawingBuffer: false,
      // Pas d'alpha buffer (on remplit toujours le clearColor) → moins de
      // bande passante mémoire sur GPU intégrés.
      alpha: false,
      // Sur les GPU faibles, le stencil buffer est inutile pour notre rendu :
      // on l'éteint pour économiser de la mémoire et de la bande passante.
      stencil: false,
      depth: true,
    });
    this.applyPixelRatio();
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const theme = getActiveTheme();
    // Clear color + fog + lights tirés du thème actif. Tout est paramétrable
    // par thème (cf. themes/Theme.ts).
    this.renderer.setClearColor(new THREE.Color(theme.palette.clearColor), 1);

    this.scene = new THREE.Scene();
    this.fogNear = 60 * q.fogDensity;
    this.fogFar = 200 * q.fogDensity;
    this.scene.fog = new THREE.Fog(new THREE.Color(theme.palette.fogColor), this.fogNear, this.fogFar);

    // Cadrage partagé (shared/), le même pour tous les thèmes ; la
    // CameraRig le pilote ensuite.
    this.camera = new THREE.PerspectiveCamera(
      CAM_ISO ? ISO_FOV_DEG : CAMERA_FOV_DEG,
      window.innerWidth / window.innerHeight,
      0.5,
      Math.max(220, this.fogFar + 40),
    );
    const pitch = (CAMERA_PITCH_DEG * Math.PI) / 180;
    this.camera.position.set(0, Math.sin(pitch) * CAMERA_DISTANCE, Math.cos(pitch) * CAMERA_DISTANCE);
    this.camera.lookAt(0, 0, 0);

    const ambient = new THREE.AmbientLight(theme.lighting.ambient.color, theme.lighting.ambient.intensity);
    this.scene.add(ambient);
    if (gfxV2Active(q)) {
      // Rendu v2 : la lumière principale devient une lune qui porte des
      // ombres (couleur du thème, plus forte : c'est elle qui donne le
      // volume). La carte d'ombres suit le joueur (followShadows). À régler
      // avant la première compilation : activer les ombres change les
      // programmes de tous les matériaux éclairés.
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      const moon = new THREE.DirectionalLight(theme.lighting.key.color, 1.1);
      moon.castShadow = true;
      const size = q.preset === "high" ? 2048 : 1024;
      moon.shadow.mapSize.set(size, size);
      const cam = moon.shadow.camera;
      cam.left = cam.bottom = -SHADOW_HALF;
      cam.right = cam.top = SHADOW_HALF;
      cam.near = 1;
      cam.far = SHADOW_DISTANCE * 2;
      cam.updateProjectionMatrix();
      moon.shadow.bias = -0.0006;
      moon.shadow.normalBias = 0.04;
      this.shadowTexel = (SHADOW_HALF * 2) / size;
      this.shadowRight.crossVectors(new THREE.Vector3(0, 1, 0), MOON_DIR).normalize();
      this.shadowUp.crossVectors(MOON_DIR, this.shadowRight).normalize();
      this.moon = moon;
      this.scene.add(moon, moon.target);
      this.followShadows(0, 0);
      const rim = new THREE.DirectionalLight(theme.lighting.rim.color, theme.lighting.rim.intensity);
      rim.position.set(-30, 20, -20);
      this.scene.add(rim);
    } else if (!q.simpleMaterials) {
      const key = new THREE.DirectionalLight(theme.lighting.key.color, theme.lighting.key.intensity);
      key.position.set(20, 40, 20);
      this.scene.add(key);
      const rim = new THREE.DirectionalLight(theme.lighting.rim.color, theme.lighting.rim.intensity);
      rim.position.set(-30, 20, -20);
      this.scene.add(rim);
    }

    window.addEventListener("resize", () => this.onResize());
  }

  // La caméra recule (orbite, écran étroit) : brouillard et plan lointain
  // se décalent d'autant, pour garder le même profil autour du joueur.
  // Sans ça, en portrait (caméra à ~80 u), le joueur lui-même serait dans
  // le brouillard.
  setViewDistance(distance: number): void {
    const shift = distance - CAMERA_DISTANCE;
    const fog = this.scene.fog as THREE.Fog;
    fog.near = this.fogNear + shift;
    fog.far = this.fogFar + shift;
    const far = Math.max(220, fog.far + 40);
    if (Math.abs(this.camera.far - far) > 1) {
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
  }

  // Rendu v2 : la carte d'ombres suit le point visé. Son centre avance par
  // pas d'un texel dans le repère de la lumière : sans ça, le bord des
  // ombres fourmille à chaque déplacement de la caméra.
  followShadows(x: number, z: number): void {
    const moon = this.moon;
    if (!moon) return;
    const t = moon.target.position.set(x, 0, z);
    const r = t.dot(this.shadowRight);
    const u = t.dot(this.shadowUp);
    t.addScaledVector(this.shadowRight, Math.round(r / this.shadowTexel) * this.shadowTexel - r);
    t.addScaledVector(this.shadowUp, Math.round(u / this.shadowTexel) * this.shadowTexel - u);
    moon.position.copy(t).addScaledVector(MOON_DIR, SHADOW_DISTANCE);
    moon.target.updateMatrixWorld();
  }

  private applyPixelRatio(): void {
    const effective = Math.min(window.devicePixelRatio, this.basePixelRatio) * this.resScale;
    this.renderer.setPixelRatio(Math.max(0.4, effective));
  }

  // Permet au moniteur FPS d'ajuster le scale en temps réel.
  setResScale(scale: number): void {
    const clamped = Math.max(0.4, Math.min(1.0, scale));
    if (Math.abs(clamped - this.resScale) < 0.005) return;
    this.resScale = clamped;
    this.applyPixelRatio();
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  getResScale(): number {
    return this.resScale;
  }

  onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.applyPixelRatio();
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
