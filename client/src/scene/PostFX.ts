import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { QualityConfig } from "../quality";

// Post-traitement des qualités haute et moyenne : la scène est rendue dans
// une cible HDR (demi-flottants, MSAA en haute), le bloom en est tiré, puis
// UNE passe finale écrit l'écran : bloom ajouté, aberration chromatique,
// vignette, grain, conversion sRGB.
// Avant : EffectComposer enchaînait une passe plein écran par effet
// (mélange du bloom, chroma, vignette, grain, sortie), chacune écrite dans
// une cible multiéchantillonnée puis résolue : cinq passes et cinq
// résolutions MSAA à pleine résolution par image, le plus gros poste GPU
// des machines modestes, pour la même image (à l'arrondi des
// demi-flottants près). Le canvas n'a plus d'antialiasing à lui (il ne
// reçoit que la passe finale) : l'AA vient de la cible de la scène.

// Garde-fou du bloom : un seul pixel NaN ou infini dans la cible HDR (un
// shader qui divise par zéro, élève un négatif à une puissance, normalise
// un vecteur nul…) passait dans le filtre de luminosité, puis dans le flou
// des cinq mips : un carré noir d'un millier de pixels de côté en 1080p,
// tant que le pixel fautif restait à l'image (constaté sur Opera GX sous
// Windows, où ANGLE passe par Direct3D). Le filtre ne garde que les valeurs
// finies, ramenées entre 0 et BLOOM_INPUT_MAX : il ne reste que le pixel
// fautif, invisible. Le plafond est loin de ce qu'atteint une scène normale
// (lames émissives, effets additifs empilés : quelques unités) et évite
// qu'une valeur énorme mais finie devienne une tache blanche.
// Aucune comparaison avec NaN n'est vraie : le test « fini » l'écarte
// (isnan() peut disparaître à l'optimisation chez certains pilotes).
const BLOOM_INPUT_MAX = "64.0";

// Filtre de luminosité de UnrealBloomPass (même seuil, même transition),
// entrée assainie. Écrit ici plutôt que retouché dans celui de three.js :
// il ne dépend plus du texte de leur shader.
const HIGH_PASS_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float luminosityThreshold;
  uniform float smoothWidth;
  uniform vec2 uUvScale;
  uniform vec2 uUvMax;
  varying vec2 vUv;
  void main() {
    vec4 texel = texture2D(tDiffuse, min(vUv * uUvScale, uUvMax));
    bvec3 finite = lessThan(abs(texel.rgb), vec3(65504.0));
    texel.rgb = clamp(vec3(finite.x ? texel.r : 0.0, finite.y ? texel.g : 0.0, finite.z ? texel.b : 0.0), 0.0, ${BLOOM_INPUT_MAX});
    float v = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
    float alpha = smoothstep(luminosityThreshold, luminosityThreshold + smoothWidth, v);
    gl_FragColor = mix(vec4(0.0), texel, alpha);
  }
`;

const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

// Passe finale, dans l'ordre de l'ancienne chaîne : bloom (mélange additif
// de UnrealBloomPass : rgb × alpha, alpha = force × somme des facteurs des
// mips), aberration chromatique (canaux rouge et bleu décalés depuis le
// centre), vignette, grain (FilmShader de three.js), sortie sRGB. Chaque
// effet se coupe par son uniform, sans recompiler. La scène n'occupe
// qu'une partie de sa cible à résolution réduite (uUvScale), lue sans
// déborder sur le reste (uUvMax, un demi-texel en deçà).
const FINAL_FRAG = /* glsl */ `
  #include <common>
  uniform sampler2D tScene;
  uniform sampler2D tBloom;
  uniform float uBloom;
  uniform float uChroma;
  uniform float uVignette;
  uniform float uVignetteOffset;
  uniform float uGrain;
  uniform float uTime;
  uniform vec2 uUvScale;
  uniform vec2 uUvMax;
  varying vec2 vUv;

  vec3 sceneAt(vec2 uv) {
    vec3 c = texture2D(tScene, min(uv * uUvScale, uUvMax)).rgb;
    if (uBloom > 0.0) {
      vec4 b = texture2D(tBloom, uv);
      c += b.rgb * b.a;
    }
    return c;
  }

  void main() {
    vec3 color;
    if (uChroma > 0.0) {
      vec2 d = vUv - 0.5;
      color = vec3(sceneAt(vUv + d * uChroma).r, sceneAt(vUv).g, sceneAt(vUv - d * uChroma).b);
    } else {
      color = sceneAt(vUv);
    }
    vec2 v = (vUv - 0.5) * uVignetteOffset;
    color *= 1.0 - dot(v, v) * uVignette;
    if (uGrain > 0.0) {
      float noise = rand(fract(vUv + uTime));
      color = mix(color, color + color * clamp(0.1 + noise, 0.0, 1.0), uGrain);
    }
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

// Vignette légère : darkness 1.1 → 0.65 (moins d'assombrissement global),
// offset 1.05 → 1.15 (vignette plus dans les coins, pas dans les 2/3 de
// l'écran). Évite l'effet "tunnel" qui mangeait les détails en périphérie.
const VIGNETTE_OFFSET = 1.15;
const VIGNETTE_DARKNESS = 0.65;
// Aberration chromatique réduite (0.002 → 0.0008) : à 0.002, visible sur
// toutes les arêtes et floue sur les détails fins ; à 0.0008, un soupçon de
// décalage en bordure, l'écran reste net.
const CHROMA_AMOUNT = 0.0008;
// Grain réduit (0.08 → 0.035) : à pleine intensité, il se lisait comme une
// compression VHS sur les écrans modernes plutôt qu'un grain de cinéma.
const GRAIN_INTENSITY = 0.035;

const BLUR_X = new THREE.Vector2(1, 0);
const BLUR_Y = new THREE.Vector2(0, 1);

// Le bloom de three.js (mêmes mips, même flou, même composition), arrêté
// avant son mélange dans l'image : la passe finale lit sa texture.
class BloomChain extends UnrealBloomPass {
  private readonly highPass: THREE.ShaderMaterial;
  private readonly savedClear = new THREE.Color();

  constructor(strength: number, radius: number, threshold: number, uvScale: THREE.Vector2, uvMax: THREE.Vector2) {
    super(new THREE.Vector2(256, 256), strength, radius, threshold);
    this.materialHighPassFilter.dispose();
    this.highPass = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        luminosityThreshold: { value: threshold },
        // Celle de UnrealBloomPass.
        smoothWidth: { value: 0.01 },
        uUvScale: { value: uvScale },
        uUvMax: { value: uvMax },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: HIGH_PASS_FRAG,
    });
  }

  // Texture composée du bloom de `input` : rgb, et alpha = force × somme des
  // facteurs (le mélange additif de UnrealBloomPass ajoutait rgb × alpha).
  renderFrom(renderer: THREE.WebGLRenderer, input: THREE.Texture): THREE.Texture {
    renderer.getClearColor(this.savedClear);
    const savedAlpha = renderer.getClearAlpha();
    const savedAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);

    this.highPass.uniforms.tDiffuse.value = input;
    this.highPass.uniforms.luminosityThreshold.value = this.threshold;
    this.fsQuad.material = this.highPass;
    renderer.setRenderTarget(this.renderTargetBright);
    renderer.clear();
    this.fsQuad.render(renderer);

    let source = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const blur = this.separableBlurMaterials[i];
      this.fsQuad.material = blur;
      blur.uniforms.colorTexture.value = source.texture;
      blur.uniforms.direction.value = BLUR_X;
      renderer.setRenderTarget(this.renderTargetsHorizontal[i]);
      renderer.clear();
      this.fsQuad.render(renderer);
      blur.uniforms.colorTexture.value = this.renderTargetsHorizontal[i].texture;
      blur.uniforms.direction.value = BLUR_Y;
      renderer.setRenderTarget(this.renderTargetsVertical[i]);
      renderer.clear();
      this.fsQuad.render(renderer);
      source = this.renderTargetsVertical[i];
    }

    const composite = this.compositeMaterial;
    this.fsQuad.material = composite;
    composite.uniforms.bloomStrength.value = this.strength;
    composite.uniforms.bloomRadius.value = this.radius;
    composite.uniforms.bloomTintColors.value = this.bloomTintColors;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
    renderer.clear();
    this.fsQuad.render(renderer);

    renderer.setClearColor(this.savedClear, savedAlpha);
    renderer.autoClear = savedAutoClear;
    return this.renderTargetsHorizontal[0].texture;
  }

  dispose(): void {
    super.dispose();
    this.highPass.dispose();
  }
}

export class PostFX {
  private readonly enabled: boolean;
  private target: THREE.WebGLRenderTarget | null = null;
  private bloom: BloomChain | null = null;
  private final: FullScreenQuad | null = null;
  private finalMat: THREE.ShaderMaterial | null = null;
  private readonly samples: number;
  private readonly chroma: number;
  private readonly vignette: number;
  private readonly grain: number;
  private lite = false;
  // Résolution dynamique : part de la cible où la scène est rendue.
  private scale = 1;
  private readonly uvScale = new THREE.Vector2(1, 1);
  private readonly uvMax = new THREE.Vector2(1, 1);
  private readonly size = new THREE.Vector2();
  private readonly bufferSize = new THREE.Vector2();
  private readonly clock = new THREE.Clock();

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    q: QualityConfig,
  ) {
    // Sans post-FX (basse qualité, potato) : rendu direct à l'écran, rien
    // n'est créé.
    this.enabled = q.postFx;
    this.samples = q.samples > 0 ? q.samples : 0;
    this.chroma = q.chroma ? CHROMA_AMOUNT : 0;
    this.vignette = q.vignette ? VIGNETTE_DARKNESS : 0;
    this.grain = q.filmGrain ? GRAIN_INTENSITY : 0;
    if (!this.enabled) return;

    renderer.getDrawingBufferSize(this.size);
    this.target = this.createTarget(this.samples);
    if (q.bloomEnabled) this.bloom = new BloomChain(q.bloomStrength, q.bloomRadius, q.bloomThreshold, this.uvScale, this.uvMax);
    this.finalMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.target.texture },
        tBloom: { value: null },
        uBloom: { value: 0 },
        uChroma: { value: this.chroma },
        uVignette: { value: this.vignette },
        uVignetteOffset: { value: VIGNETTE_OFFSET },
        uGrain: { value: this.grain },
        uTime: { value: 0 },
        uUvScale: { value: this.uvScale },
        uUvMax: { value: this.uvMax },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: FINAL_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.final = new FullScreenQuad(this.finalMat);
    this.resize();
  }

  get active(): boolean {
    return this.enabled;
  }

  // Résolution dynamique (0,4 à 1) : la scène est rendue dans une partie de
  // sa cible, que la passe finale agrandit. Rien n'est réalloué : changer
  // la taille du canvas et des cibles coûtait un à-coup à chaque palier.
  setRenderScale(scale: number): void {
    this.scale = Math.max(0.4, Math.min(1, scale));
  }

  get renderScale(): number {
    return this.scale;
  }

  get isLite(): boolean {
    return this.lite;
  }

  // Cible où la scène est rendue (null : rendu direct à l'écran). Les
  // shaders compilés d'avance doivent l'être pour elle : la conversion de
  // sortie d'un matériau dépend de sa destination.
  get sceneTarget(): THREE.WebGLRenderTarget | null {
    return this.target;
  }

  // Allègement en pleine partie (le moniteur de FPS baisse la qualité) :
  // plus de bloom, d'effets ni de MSAA, mais la scène reste rendue dans la
  // même cible. Couper le post-traitement changeait la destination de tous
  // les matériaux, donc leurs shaders : une quarantaine de recompilations
  // d'un coup, plusieurs secondes de gel sous Windows.
  setLite(on: boolean): void {
    if (!this.enabled || this.lite === on) return;
    this.lite = on;
    const samples = on ? 0 : this.samples;
    if (this.target && this.target.samples !== samples) {
      this.target.dispose();
      this.target = this.createTarget(samples);
      this.finalMat!.uniforms.tScene.value = this.target.texture;
    }
    const u = this.finalMat!.uniforms;
    u.uChroma.value = on ? 0 : this.chroma;
    u.uVignette.value = on ? 0 : this.vignette;
    u.uGrain.value = on ? 0 : this.grain;
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const renderer = this.renderer;
    if (!this.target || !this.final || !this.finalMat) {
      renderer.render(scene, camera);
      return;
    }
    // Taille suivie sur celle du canvas (fenêtre redimensionnée). La
    // résolution dynamique, elle, ne rend que dans une partie de la cible :
    // avant, les cibles gardaient la taille du démarrage et baisser la
    // résolution ne soulageait pas le GPU en qualité haute et moyenne.
    renderer.getDrawingBufferSize(this.bufferSize);
    if (!this.bufferSize.equals(this.size)) {
      this.size.copy(this.bufferSize);
      this.resize();
    }
    const t = this.target;
    const sw = Math.max(1, Math.round(this.size.x * this.scale));
    const sh = Math.max(1, Math.round(this.size.y * this.scale));
    t.viewport.set(0, 0, sw, sh);
    t.scissor.set(0, 0, sw, sh);
    t.scissorTest = sw < this.size.x || sh < this.size.y;
    this.uvScale.set(sw / this.size.x, sh / this.size.y);
    this.uvMax.set((sw - 0.5) / this.size.x, (sh - 0.5) / this.size.y);
    renderer.setRenderTarget(t);
    renderer.render(scene, camera);

    const u = this.finalMat.uniforms;
    const bloomOn = this.bloom !== null && !this.lite;
    u.uBloom.value = bloomOn ? 1 : 0;
    if (bloomOn) u.tBloom.value = this.bloom!.renderFrom(renderer, this.target.texture);
    u.uTime.value += this.clock.getDelta();

    renderer.setRenderTarget(null);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    this.final.render(renderer);
    renderer.autoClear = autoClear;
  }

  private createTarget(samples: number): THREE.WebGLRenderTarget {
    return new THREE.WebGLRenderTarget(Math.max(1, this.size.x), Math.max(1, this.size.y), {
      samples,
      // Demi-flottants : pas de bandes dans les dégradés du bloom, et les
      // valeurs au-dessus de 1 restent pour son seuil.
      type: THREE.HalfFloatType,
    });
  }

  // Bloom calculé depuis l'image à pleine résolution, sa première mip à la
  // moitié : l'aspect réglé jusqu'ici.
  private resize(): void {
    const w = Math.max(1, this.size.x);
    const h = Math.max(1, this.size.y);
    this.target?.setSize(w, h);
    this.bloom?.setSize(w, h);
  }
}
