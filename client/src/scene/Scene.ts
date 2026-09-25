import * as THREE from "three";
import { CAMERA_DISTANCE, CAMERA_FOV_DEG, CAMERA_PITCH_DEG } from "@bladeio/shared";
import { QualityConfig } from "../quality";
import { getActiveTheme } from "../themes";

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

  constructor(canvas: HTMLCanvasElement, q: QualityConfig) {
    this.basePixelRatio = q.pixelRatio;
    this.resScale = q.resScale;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: q.antialias,
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
      CAMERA_FOV_DEG,
      window.innerWidth / window.innerHeight,
      0.5,
      Math.max(220, this.fogFar + 40),
    );
    const pitch = (CAMERA_PITCH_DEG * Math.PI) / 180;
    this.camera.position.set(0, Math.sin(pitch) * CAMERA_DISTANCE, Math.cos(pitch) * CAMERA_DISTANCE);
    this.camera.lookAt(0, 0, 0);

    const ambient = new THREE.AmbientLight(theme.lighting.ambient.color, theme.lighting.ambient.intensity);
    this.scene.add(ambient);
    if (!q.simpleMaterials) {
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
