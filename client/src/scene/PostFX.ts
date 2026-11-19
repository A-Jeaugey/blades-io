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
  uniform sampler2D tAo;
  uniform float uAo;
  uniform float uFilmic;
  uniform float uExposure;
  uniform float uAoDebug;
  varying vec2 vUv;

  vec3 sceneAt(vec2 uv) {
    vec3 c = texture2D(tScene, min(uv * uUvScale, uUvMax)).rgb;
    if (uAo > 0.0) {
      // Occlusion ambiante : sur ce qui est éclairé, pas sur ce qui éclaire
      // (néons, lames, effets additifs : plus le pixel est clair, moins
      // elle l'assombrit).
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c *= mix(1.0, texture2D(tAo, uv).r, uAo * (1.0 - clamp(lum * 1.6, 0.0, 1.0)));
    }
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
    // ?debug=ao : l'occlusion seule, pour la régler.
    if (uAoDebug > 0.0) color = vec3(texture2D(tAo, vUv).r) * 0.6;
    if (uFilmic > 0.0) {
      // Courbe filmique (ajustement ACES de Narkowicz) : pied qui creuse
      // les ombres, épaule qui amène les hautes lumières au blanc sans les
      // écrêter d'un coup. Entrée bornée à zéro (une valeur négative
      // sortirait de la courbe).
      vec3 x = max(color * uExposure, 0.0);
      vec3 mapped = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
      color = mix(color, mapped, uFilmic);
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

// --- Occlusion ambiante (rendu v2, qualité haute) ---------------------------
// Tirée de la seule profondeur de la scène, à demi-résolution : pour chaque
// pixel, la position et la normale sont reconstruites, puis quelques points
// voisins disent combien de géométrie surplombe la surface (estimateur de
// « Scalable Ambient Obscurance », McGuire et al.). Deux passes de flou qui
// respectent les bords (écart de profondeur) effacent le bruit du tirage.
// C'est ce qui assoit les objets : creux des façades, pied des murs, dessous
// des auvents, contact des caisses et des joueurs avec le sol.
const AO_SAMPLES = 10;
const AO_RADIUS = 1.3;
const AO_INTENSITY = 1.5;
const AO_STRENGTH = 0.85;

const AO_FRAG = /* glsl */ `
  uniform sampler2D tDepth;
  uniform vec2 uUvScale;
  uniform vec2 uUvMax;
  uniform vec2 uTexel;
  uniform vec2 uInvProj;
  uniform vec2 uProj;
  uniform vec2 uNearFar;
  varying vec2 vUv;

  // Distance à la caméra, depuis la profondeur du tampon.
  float depthAt(vec2 uv) {
    // textureLod : pas de dérivées à calculer dans la boucle du tirage.
    float z = textureLod(tDepth, min(max(uv, 0.0) * uUvScale, uUvMax), 0.0).x;
    return (2.0 * uNearFar.x * uNearFar.y) / (uNearFar.y + uNearFar.x - (2.0 * z - 1.0) * (uNearFar.y - uNearFar.x));
  }
  vec3 posAt(vec2 uv, float d) {
    return vec3((uv * 2.0 - 1.0) * uInvProj * d, -d);
  }

  void main() {
    float d = depthAt(vUv);
    float key = clamp(d / uNearFar.y, 0.0, 1.0);
    vec2 dkey = vec2(floor(key * 255.0) / 255.0, fract(key * 255.0));
    // Ciel, et lointain déjà pris dans le brouillard : rien.
    if (d > uNearFar.y * 0.8) {
      gl_FragColor = vec4(1.0, dkey, 1.0);
      return;
    }
    vec3 p = posAt(vUv, d);
    // Normale : de chaque côté, le voisin le plus proche en profondeur (pas
    // celui d'un autre objet, au bord d'une silhouette).
    vec2 dx = vec2(uTexel.x, 0.0);
    vec2 dy = vec2(0.0, uTexel.y);
    float dl = depthAt(vUv - dx);
    float dr = depthAt(vUv + dx);
    float db = depthAt(vUv - dy);
    float dt = depthAt(vUv + dy);
    vec3 px = abs(dr - d) < abs(d - dl) ? posAt(vUv + dx, dr) - p : p - posAt(vUv - dx, dl);
    vec3 py = abs(dt - d) < abs(d - db) ? posAt(vUv + dy, dt) - p : p - posAt(vUv - dy, db);
    vec3 n = cross(px, py);
    float nl = length(n);
    n = nl > 1e-12 ? n / nl : vec3(0.0, 0.0, 1.0);

    // Tirage en spirale, tourné d'un pixel à l'autre (bruit en dégradé
    // entrelacé). Rayon à l'écran borné : un objet contre la caméra ne lit
    // pas la moitié de l'image.
    float turn = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
    vec2 radius = min(${AO_RADIUS.toFixed(2)} * uProj / d, vec2(0.12));
    const float R2 = ${(AO_RADIUS * AO_RADIUS).toFixed(4)};
    float sum = 0.0;
    for (int i = 0; i < ${AO_SAMPLES}; i++) {
      float t = (float(i) + 0.5) / ${AO_SAMPLES.toFixed(1)};
      float a = turn + t * 15.08;
      vec2 suv = vUv + vec2(cos(a), sin(a)) * t * radius;
      vec3 v = posAt(suv, depthAt(suv)) - p;
      float vv = dot(v, v);
      float f = max(R2 - vv, 0.0);
      // Biais qui grandit avec la distance : la profondeur y est moins
      // précise, une surface plane ne doit pas s'occulter elle-même.
      sum += f * f * f * max((dot(v, n) - 0.02 - 0.0015 * d) / (vv + 0.01), 0.0);
    }
    float ao = max(0.0, 1.0 - sum * ${(AO_INTENSITY * 5 / (AO_RADIUS ** 6 * AO_SAMPLES)).toFixed(5)});
    ao = mix(ao, 1.0, smoothstep(uNearFar.y * 0.5, uNearFar.y * 0.8, d));
    gl_FragColor = vec4(ao, dkey, 1.0);
  }
`;

// Flou séparable, pondéré par l'écart de profondeur : il ne passe pas d'un
// objet à celui de derrière.
const AO_BLUR_FRAG = /* glsl */ `
  uniform sampler2D tAo;
  uniform vec2 uStep;
  varying vec2 vUv;
  float keyOf(vec4 t) {
    return t.g + t.b / 255.0;
  }
  void main() {
    vec4 c = texture2D(tAo, vUv);
    float k0 = keyOf(c);
    float sum = c.r * 0.2;
    float wsum = 0.2;
    for (int i = 1; i <= 4; i++) {
      float g = 0.2 - 0.04 * float(i);
      for (int s = -1; s <= 1; s += 2) {
        vec4 t = textureLod(tAo, vUv + uStep * float(i * s), 0.0);
        float w = g * max(0.0, 1.0 - abs(keyOf(t) - k0) / (0.02 * k0 + 0.0004));
        sum += t.r * w;
        wsum += w;
      }
    }
    gl_FragColor = vec4(sum / wsum, c.g, c.b, 1.0);
  }
`;

class AoChain {
  private readonly aoMat: THREE.ShaderMaterial;
  private readonly blurMat: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;
  private readonly a: THREE.WebGLRenderTarget;
  private readonly b: THREE.WebGLRenderTarget;
  private readonly step = new THREE.Vector2();

  constructor(uvScale: THREE.Vector2, uvMax: THREE.Vector2) {
    const target = () => {
      const t = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
      t.texture.generateMipmaps = false;
      return t;
    };
    this.a = target();
    this.b = target();
    this.aoMat = new THREE.ShaderMaterial({
      uniforms: {
        tDepth: { value: null },
        uUvScale: { value: uvScale },
        uUvMax: { value: uvMax },
        uTexel: { value: new THREE.Vector2() },
        uInvProj: { value: new THREE.Vector2() },
        uProj: { value: new THREE.Vector2() },
        uNearFar: { value: new THREE.Vector2() },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: AO_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tAo: { value: null }, uStep: { value: this.step } },
      vertexShader: QUAD_VERT,
      fragmentShader: AO_BLUR_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.aoMat);
  }

  // Demi-résolution du canvas.
  setSize(w: number, h: number): void {
    const hw = Math.max(1, Math.round(w / 2));
    const hh = Math.max(1, Math.round(h / 2));
    this.a.setSize(hw, hh);
    this.b.setSize(hw, hh);
  }

  // drawnW, drawnH : pixels de la cible où la scène est dessinée.
  renderFrom(renderer: THREE.WebGLRenderer, depth: THREE.Texture, camera: THREE.PerspectiveCamera, drawnW: number, drawnH: number): THREE.Texture {
    const u = this.aoMat.uniforms;
    const e = camera.projectionMatrix.elements;
    u.tDepth.value = depth;
    u.uTexel.value.set(1 / drawnW, 1 / drawnH);
    u.uInvProj.value.set(1 / e[0], 1 / e[5]);
    u.uProj.value.set(e[0] * 0.5, e[5] * 0.5);
    u.uNearFar.value.set(camera.near, camera.far);
    this.quad.material = this.aoMat;
    renderer.setRenderTarget(this.a);
    this.quad.render(renderer);
    this.quad.material = this.blurMat;
    this.blurMat.uniforms.tAo.value = this.a.texture;
    this.step.set(1 / this.a.width, 0);
    renderer.setRenderTarget(this.b);
    this.quad.render(renderer);
    this.blurMat.uniforms.tAo.value = this.b.texture;
    this.step.set(0, 1 / this.a.height);
    renderer.setRenderTarget(this.a);
    this.quad.render(renderer);
    return this.a.texture;
  }
}

// Réglages du rendu v2 (rien de tout ça hors de lui : l'image d'origine ne
// change pas d'un pixel).
export interface PostFxLook {
  // Courbe filmique et exposition de la passe finale.
  filmic: boolean;
  // Occlusion ambiante en espace écran.
  ao: boolean;
}
// Exposition avant la courbe : elle relève les tons moyens de la nuit sans
// toucher au noir.
const FILMIC_EXPOSURE = 1.25;

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
  private ao: AoChain | null = null;
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
    look: PostFxLook = { filmic: false, ao: false },
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
    // Avant la cible : elle porte alors une texture de profondeur.
    if (look.ao) this.ao = new AoChain(this.uvScale, this.uvMax);
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
        tAo: { value: null },
        uAo: { value: 0 },
        uFilmic: { value: look.filmic ? 1 : 0 },
        uExposure: { value: FILMIC_EXPOSURE },
        uAoDebug: { value: this.ao && new URLSearchParams(location.search).get("debug") === "ao" ? 1 : 0 },
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

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
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
    const aoOn = this.ao !== null && !this.lite && t.depthTexture !== null;
    u.uAo.value = aoOn ? AO_STRENGTH : 0;
    if (aoOn) u.tAo.value = this.ao!.renderFrom(renderer, t.depthTexture!, camera, sw, sh);
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
    const w = Math.max(1, this.size.x);
    const h = Math.max(1, this.size.y);
    return new THREE.WebGLRenderTarget(w, h, {
      samples,
      // Demi-flottants : pas de bandes dans les dégradés du bloom, et les
      // valeurs au-dessus de 1 restent pour son seuil.
      type: THREE.HalfFloatType,
      // Profondeur lisible par l'occlusion ambiante (24 bits : le format
      // que three.js donne aussi au tampon multiéchantillonné, pour que la
      // résolution vers la texture soit permise).
      depthTexture: this.ao ? new THREE.DepthTexture(w, h, THREE.UnsignedIntType) : undefined,
    });
  }

  // Bloom calculé depuis l'image à pleine résolution, sa première mip à la
  // moitié : l'aspect réglé jusqu'ici.
  private resize(): void {
    const w = Math.max(1, this.size.x);
    const h = Math.max(1, this.size.y);
    this.target?.setSize(w, h);
    this.bloom?.setSize(w, h);
    this.ao?.setSize(w, h);
  }
}
