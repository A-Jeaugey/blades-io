import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { FilmPass } from "three/examples/jsm/postprocessing/FilmPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { QualityConfig } from "../quality";

const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    offset: { value: 1.05 },
    darkness: { value: 1.1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float offset;
    uniform float darkness;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec2 uv = (vUv - 0.5) * vec2(offset);
      color.rgb *= 1.0 - dot(uv, uv) * darkness;
      gl_FragColor = color;
    }
  `,
};

const ChromaShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    amount: { value: 0.002 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float amount;
    varying vec2 vUv;
    void main() {
      vec2 d = (vUv - 0.5);
      float r = texture2D(tDiffuse, vUv + d * amount).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - d * amount).b;
      float a = texture2D(tDiffuse, vUv).a;
      gl_FragColor = vec4(r, g, b, a);
    }
  `,
};

export class PostFX {
  // Quand postFx=false, on ne crée AUCUNE des structures EffectComposer.
  // render() devient un simple renderer.render() — exactement le minimum.
  composer: EffectComposer | null = null;
  bloom: UnrealBloomPass | null = null;
  vignette: ShaderPass | null = null;
  chroma: ShaderPass | null = null;
  film: FilmPass | null = null;
  private enabled: boolean;
  private bloomResScale: number;

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    q: QualityConfig,
  ) {
    this.enabled = q.postFx;
    this.bloomResScale = q.bloomResScale;

    if (!q.postFx) {
      // Path rapide : pas de composer du tout. C'est le cas low/ultra et
      // c'est l'optimisation la plus impactante sur GPU faibles.
      return;
    }

    this.composer = new EffectComposer(renderer);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    const renderPass = new RenderPass(scene, camera);
    this.composer.addPass(renderPass);

    if (q.bloomEnabled) {
      this.bloom = new UnrealBloomPass(
        new THREE.Vector2(
          window.innerWidth * q.bloomResScale,
          window.innerHeight * q.bloomResScale,
        ),
        q.bloomStrength,
        0.7,
        0.65,
      );
      this.composer.addPass(this.bloom);
    }
    if (q.chroma) {
      this.chroma = new ShaderPass(ChromaShader);
      this.composer.addPass(this.chroma);
    }
    if (q.vignette) {
      this.vignette = new ShaderPass(VignetteShader);
      this.composer.addPass(this.vignette);
    }
    if (q.filmGrain) {
      this.film = new FilmPass(0.08, false);
      this.composer.addPass(this.film);
    }
    this.composer.addPass(new OutputPass());

    window.addEventListener("resize", () => {
      this.composer?.setSize(window.innerWidth, window.innerHeight);
      this.bloom?.setSize(
        window.innerWidth * this.bloomResScale,
        window.innerHeight * this.bloomResScale,
      );
    });
  }

  setEnabled(on: boolean): void {
    this.enabled = on && this.composer !== null;
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (this.enabled && this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(scene, camera);
    }
  }
}
