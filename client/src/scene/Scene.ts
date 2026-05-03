import * as THREE from "three";
import { QualityConfig } from "../quality";
import { PALETTE } from "./palette";

export class SceneStack {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  // Resolution scale courant — peut varier en runtime (résolution
  // dynamique). Le pixelRatio effectif appliqué = min(devicePR, q.pixelRatio)
  // × resScale.
  private resScale: number;
  private basePixelRatio: number;

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
    // Clear color = nuit étoilée violette. Tout ce qui dépasse le sol
    // (skybox virtuelle) baigne dans cette teinte.
    this.renderer.setClearColor(new THREE.Color(PALETTE.nightDeep), 1);

    this.scene = new THREE.Scene();
    const fogNear = 60 * q.fogDensity;
    const fogFar = 200 * q.fogDensity;
    // Brouillard mauve mid : se confond avec la nuit profonde au loin pour
    // un effet "le monde s'évapore" plutôt qu'un mur de fog visible.
    this.scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fogMid), fogNear, fogFar);

    this.camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.5,
      // Far plane resserré au-delà du brouillard : tout ce qui dépasse est
      // déjà invisible via le fog, donc pas la peine de le projeter.
      Math.max(220, fogFar + 40),
    );
    // Caméra légèrement plus inclinée qu'avant : (0, 19, 17) ≈ 48° depuis
    // l'horizontale, vs 54° avant. Suffisant pour donner du volume aux
    // décors verticaux (sanctuaires, champignons, reliques flottantes) sans
    // casser la lisibilité tactique d'un .io top-down.
    this.camera.position.set(0, 19, 17);
    this.camera.lookAt(0, 0, 0);

    // Ambient = clair de lune mauve doux. Donne la teinte chaude/froide
    // unifiée à tous les matériaux PBR en lit (joueurs, décor).
    const ambient = new THREE.AmbientLight(0xb4a4d8, 0.55);
    this.scene.add(ambient);
    // Sur "simpleMaterials" (low/ultra), les directional lights sont inutiles
    // (les matériaux n'utilisent pas de lighting) : on n'ajoute que l'ambient
    // pour économiser des uniforms/shader.
    if (!q.simpleMaterials) {
      // Key light : lune chaude (crème) plongeant depuis le haut.
      const key = new THREE.DirectionalLight(PALETTE.playerLocalPrimary, 0.4);
      key.position.set(20, 40, 20);
      this.scene.add(key);
      // Rim light : violet-rose pour souligner les silhouettes côté opposé.
      const rim = new THREE.DirectionalLight(PALETTE.shrineAccent, 0.3);
      rim.position.set(-30, 20, -20);
      this.scene.add(rim);
    }

    window.addEventListener("resize", () => this.onResize());
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
