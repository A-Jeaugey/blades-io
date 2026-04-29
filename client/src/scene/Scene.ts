import * as THREE from "three";
import { QualityConfig } from "../quality";

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
    this.renderer.setClearColor(new THREE.Color("#05060c"), 1);

    this.scene = new THREE.Scene();
    const fogNear = 60 * q.fogDensity;
    const fogFar = 200 * q.fogDensity;
    this.scene.fog = new THREE.Fog(new THREE.Color("#1a0033"), fogNear, fogFar);

    this.camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.5,
      // Far plane resserré au-delà du brouillard : tout ce qui dépasse est
      // déjà invisible via le fog, donc pas la peine de le projeter.
      Math.max(220, fogFar + 40),
    );
    this.camera.position.set(0, 18, 14);
    this.camera.lookAt(0, 0, 0);

    const ambient = new THREE.AmbientLight(0x9ad1ff, 0.55);
    this.scene.add(ambient);
    // Sur "simpleMaterials" (low/ultra), les directional lights sont inutiles
    // (les matériaux n'utilisent pas de lighting) : on n'ajoute que l'ambient
    // pour économiser des uniforms/shader.
    if (!q.simpleMaterials) {
      const key = new THREE.DirectionalLight(0xffffff, 0.4);
      key.position.set(20, 40, 20);
      this.scene.add(key);
      const rim = new THREE.DirectionalLight(0xff2ea8, 0.25);
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
