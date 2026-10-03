import * as THREE from "three";
import { QualityConfig } from "../quality";
import { getActiveTheme } from "../themes";
import { SKIN_LOOKS, SkinLook, TRAIL_LOOKS, TrailLook, lookOf } from "../cosmetics/looks";

// Traînée du joueur local (tâche 2.6) : ruban au sol qui couvre toujours
// les TRAIL_MS dernières millisecondes de déplacement, échantillonné dans
// le temps et non à chaque frame. Avant, une ligne de 1 px de N points pris
// toutes les ~30 ms de frames : plus longue quand le FPS tombait.
const TRAIL_MS = 400;
const TRAIL_SAMPLE_MS = 16;
const TRAIL_SAMPLES = Math.ceil(TRAIL_MS / TRAIL_SAMPLE_MS) + 2;
const TRAIL_HALF_WIDTH = 0.32;
const TRAIL_ALPHA = 0.7;
const TRAIL_Y = 0.05;
// Saut d'une frame à l'autre au-delà duquel la traînée repart de zéro
// (apparition, recalage) : sinon un long trait relierait les deux points.
const TRAIL_JUMP = 6;

// Dissolution à la mort (tâche 4.9) : le corps part en morceaux suivant un
// bruit, la tête d'abord, avec un liseré lumineux au bord de ce qui
// disparaît, et vire tout entier vers la couleur de l'effet d'élimination.
// Injectée dans les matériaux du corps dès leur création (un programme
// compilé une fois, pas d'à-coup à la première mort) ; uDissolve = 0, rien
// ne change. En potato, un bruit en blocs (des pixels), moins cher.
const DISSOLVE_S = 0.6;
const DISSOLVE_GLSL = /* glsl */ `
uniform float uDissolve;
uniform vec3 uDissolveColor;
uniform float uDissolveGlow;
varying vec3 vDissolvePos;
float dissolveHash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
float dissolveNoise(vec3 p) {
  vec3 i = floor(p);
  #ifdef DISSOLVE_BLOCKY
  return dissolveHash(i);
  #else
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(dissolveHash(i), dissolveHash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(dissolveHash(i + vec3(0.0, 1.0, 0.0)), dissolveHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(dissolveHash(i + vec3(0.0, 0.0, 1.0)), dissolveHash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(dissolveHash(i + vec3(0.0, 1.0, 1.0)), dissolveHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
  #endif
}
`;
// Seuil par fragment : bruit, plus un peu de hauteur (la tête part la
// première) ; au-dessous de uDissolve, le fragment a disparu.
const DISSOLVE_CUT = /* glsl */ `
float dissolveEdge = 0.0;
if (uDissolve > 0.0) {
  float dk = dissolveNoise(vDissolvePos * DISSOLVE_SCALE) * 0.72 + (1.0 - clamp(vDissolvePos.y / 1.9, 0.0, 1.0)) * 0.28;
  if (dk < uDissolve) discard;
  dissolveEdge = 1.0 - smoothstep(0.0, 0.09, dk - uDissolve);
}
`;
// Liseré blanc chaud, corps qui vire à la couleur de l'effet.
const DISSOLVE_TINT = /* glsl */ `
vec3 dissolveTint = mix(uDissolveColor, vec3(1.0), dissolveEdge * 0.6);
gl_FragColor.rgb = mix(gl_FragColor.rgb, dissolveTint, clamp(dissolveEdge + min(1.0, uDissolve * 5.0) * 0.4, 0.0, 1.0) * uDissolveGlow);
`;

// Géométries partagées par tous les joueurs d'un même niveau de détail : un
// joueur qui entre dans le champ ne recalcule plus ses capsules, sphères et
// anneaux ni ne les renvoie au GPU, et ne les jette plus en sortant.
const sharedGeos = new Map<string, THREE.BufferGeometry>();
function sharedGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let geo = sharedGeos.get(key);
  if (!geo) {
    geo = make();
    sharedGeos.set(key, geo);
  }
  return geo;
}

export class PlayerView {
  root: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Mesh;
  ring: THREE.Mesh;
  protHalo!: THREE.Mesh | null;
  private protPhase = 0;
  private protected_ = false;
  // Conteneur de la traînée, ajouté à la scène par main.ts ; le ruban y
  // entre quand le joueur en a une (local, ou traînée équipée).
  trail = new THREE.Group();
  private ribbon: THREE.Mesh | null = null;
  // Sous-ensembles pour l'animation. Null si playerDetail = "minimal".
  private leftLeg: THREE.Mesh | null = null;
  private rightLeg: THREE.Mesh | null = null;
  private leftArm: THREE.Mesh | null = null;
  private rightArm: THREE.Mesh | null = null;

  private disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  private walkPhase = 0;
  // Échantillons de la traînée, du plus récent au plus ancien (horloge
  // propre en ms, avancée par dt).
  private trailX = new Float64Array(TRAIL_SAMPLES);
  private trailZ = new Float64Array(TRAIL_SAMPLES);
  private trailT = new Float64Array(TRAIL_SAMPLES);
  private trailCount = 0;
  private trailClock = 0;
  private trailHeadX = 0;
  private trailHeadZ = 0;
  private trailColor = new THREE.Color();
  // Points du ruban de la frame : x, z, âge (ms).
  private trailPts = new Float64Array((TRAIL_SAMPLES + 2) * 3);
  private prevRenderX = 0;
  private prevRenderY = 0;
  public renderX = 0;
  public renderY = 0;
  // Direction (unité) et vitesse (u/s) du déplacement affiché.
  public moveX = 0;
  public moveZ = 1;
  public moveSpeed = 0;
  public targetX = 0;
  public targetY = 0;
  public prevX = 0;
  public prevY = 0;
  public prevTime = 0;
  public targetTime = 0;
  private hasTrail: boolean;
  // Cosmétiques (tâche 6.1) : skin (couleurs, tête, accessoire) et traînée,
  // appliqués d'après les champs synchronisés du joueur.
  private readonly q: QualityConfig;
  private readonly isLocal: boolean;
  private bodyMats: Array<THREE.MeshStandardMaterial | THREE.MeshBasicMaterial> = [];
  private baseColors: Array<{ color: number; emissive: number; intensity: number }> = [];
  private sphereHeadGeo: THREE.BufferGeometry;
  private boxHeadGeo: THREE.BufferGeometry | null = null;
  private accessory: THREE.Group | null = null;
  private accessoryDisposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  private skinId = "";
  private trailId = "";
  private trailLook: TrailLook | null = null;
  private baseTrailColor = new THREE.Color();
  private trailTail = new THREE.Color();
  // Modes équipe (tâche 7.2) : un allié prend la couleur d'anneau du joueur
  // local, avec quatre losanges autour (la forme en plus de la couleur,
  // tâche 3.8). Repères créés au premier allié seulement.
  private ally = false;
  private allyMarks: THREE.Mesh | null = null;
  // Dissolution : avancement (0 à 1,1), couleur, part de couleur (réglage
  // des flashs) ; partagés par tous les matériaux du corps. -1 : intact.
  private dissolveT = -1;
  private uDissolve = { value: 0 };
  private uDissolveColor = { value: new THREE.Color() };
  private uDissolveGlow = { value: 1 };

  constructor(isLocal: boolean, q: QualityConfig) {
    this.root = new THREE.Group();
    this.q = q;
    this.isLocal = isLocal;
    const simpleMaterials = q.simpleMaterials;
    const detail = q.playerDetail;
    this.hasTrail = q.playerTrail && isLocal;

    // Palette joueur tirée du thème actif : local vs remote différenciés
    // pour la lecture instantanée. Chaque thème définit ses propres teintes
    // (cf. themes/Theme.ts → palette.playerLocal/playerRemote).
    const t = getActiveTheme();
    const primary = isLocal ? t.palette.playerLocal.primary : t.palette.playerRemote.primary;
    const accent = isLocal ? t.palette.playerLocal.accent : t.palette.playerRemote.accent;
    const accentDim = isLocal ? t.palette.playerLocal.accentDim : t.palette.playerRemote.accentDim;

    const mkMat = (color: number, emissive: number, intensity: number) => {
      const mat = simpleMaterials
        ? new THREE.MeshBasicMaterial({ color: emissive })
        : new THREE.MeshStandardMaterial({
            color,
            emissive,
            emissiveIntensity: intensity,
            metalness: 0.35,
            roughness: 0.35,
          });
      this.addDissolve(mat);
      // Couleurs de base, rendues quand le skin revient à la base.
      this.bodyMats.push(mat);
      this.baseColors.push({ color: simpleMaterials ? emissive : color, emissive, intensity });
      return mat;
    };

    // Tronc — segments capsule réduits selon detail.
    const torsoCapSeg = detail === "rich" ? 6 : detail === "low" ? 4 : 4;
    const torsoRadSeg = detail === "rich" ? 3 : 2;
    const torsoGeo = sharedGeo(`torso:${detail}`, () => new THREE.CapsuleGeometry(0.28, 0.55, torsoRadSeg, torsoCapSeg));
    const torsoMat = mkMat(primary, accentDim, 0.5);
    this.body = new THREE.Mesh(torsoGeo, torsoMat);
    this.body.position.y = 0.95;
    this.root.add(this.body);
    this.disposables.push(torsoMat);

    // Tête — sphère segments selon detail.
    const headSeg = detail === "rich" ? 14 : detail === "low" ? 8 : 6;
    const headRingSeg = Math.max(6, headSeg - 4);
    const headGeo = sharedGeo(`head:${detail}`, () => new THREE.SphereGeometry(0.26, headSeg, headRingSeg));
    this.sphereHeadGeo = headGeo;
    const headMat = mkMat(primary, accentDim, 0.4);
    this.head = new THREE.Mesh(headGeo, headMat);
    this.head.position.y = 1.55;
    this.root.add(this.head);
    this.disposables.push(headMat);

    // Membres — uniquement en rich/low. En minimal (ultra), on n'ajoute pas
    // les bras/jambes : le corps + tête suffit.
    if (detail !== "minimal") {
      const armCapSeg = detail === "rich" ? 6 : 4;
      const armRadSeg = detail === "rich" ? 3 : 2;
      const armGeo = sharedGeo(`arm:${detail}`, () => new THREE.CapsuleGeometry(0.09, 0.45, armRadSeg, armCapSeg));
      const armMat = mkMat(primary, accentDim, 0.45);
      this.leftArm = new THREE.Mesh(armGeo, armMat);
      this.rightArm = new THREE.Mesh(armGeo, armMat);
      this.leftArm.position.set(-0.38, 1.05, 0);
      this.rightArm.position.set(0.38, 1.05, 0);
      this.root.add(this.leftArm);
      this.root.add(this.rightArm);
      this.disposables.push(armMat);

      const legCapSeg = detail === "rich" ? 6 : 4;
      const legRadSeg = detail === "rich" ? 3 : 2;
      const legGeo = sharedGeo(`leg:${detail}`, () => new THREE.CapsuleGeometry(0.12, 0.5, legRadSeg, legCapSeg));
      const legMat = mkMat(primary, accentDim, 0.35);
      this.leftLeg = new THREE.Mesh(legGeo, legMat);
      this.rightLeg = new THREE.Mesh(legGeo, legMat);
      this.leftLeg.position.set(-0.14, 0.35, 0);
      this.rightLeg.position.set(0.14, 0.35, 0);
      this.root.add(this.leftLeg);
      this.root.add(this.rightLeg);
      this.disposables.push(legMat);
    }

    // Anneau néon au sol (cercle d'ancrage). Segments réduits en low/ultra.
    const ringSeg = detail === "rich" ? 32 : detail === "low" ? 20 : 16;
    const ringGeo = sharedGeo(`ring:${detail}`, () => new THREE.RingGeometry(0.55, 0.72, ringSeg));
    const ringMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    this.root.add(this.ring);
    this.disposables.push(ringMat);

    // Halo de spawn protection : optionnel selon q.playerHalo.
    if (q.playerHalo) {
      const protSeg = detail === "rich" ? 36 : 20;
      const protGeo = sharedGeo(`halo:${detail}`, () => new THREE.RingGeometry(1.0, 1.6, protSeg));
      const protMat = new THREE.MeshBasicMaterial({
        color: t.palette.playerLocal.accent,
        transparent: true,
        opacity: 0.0,
        side: THREE.DoubleSide,
      });
      this.protHalo = new THREE.Mesh(protGeo, protMat);
      this.protHalo.rotation.x = -Math.PI / 2;
      this.protHalo.position.y = 0.04;
      this.protHalo.visible = false;
      this.root.add(this.protHalo);
      this.disposables.push(protMat);
    } else {
      this.protHalo = null;
    }

    // Traînée de base : le joueur local, à la couleur de son anneau.
    this.baseTrailColor.set(accent);
    this.trailColor.copy(this.baseTrailColor);
    this.trailTail.copy(this.baseTrailColor);
    if (this.hasTrail) this.ensureRibbon();
  }

  // Cosmétiques équipés (identifiants validés par le serveur, "" = base).
  applyCosmetics(skin: string, trail: string): void {
    if (skin !== this.skinId) {
      this.skinId = skin;
      this.applySkin(lookOf(SKIN_LOOKS, skin));
    }
    if (trail !== this.trailId) {
      this.trailId = trail;
      this.applyTrail(lookOf(TRAIL_LOOKS, trail));
    }
  }

  private applySkin(look: SkinLook | null): void {
    const headMat = this.head.material;
    this.bodyMats.forEach((m, i) => {
      const base = this.baseColors[i];
      if (m instanceof THREE.MeshStandardMaterial) {
        m.color.setHex(look ? (m === headMat ? look.head : look.body) : base.color);
        m.emissive.setHex(look ? look.emissive : base.emissive);
        m.emissiveIntensity = look ? look.emissiveIntensity : base.intensity;
      } else {
        m.color.setHex(look ? look.flat : base.color);
      }
    });
    const box = look?.headShape === "box";
    if (box && !this.boxHeadGeo) this.boxHeadGeo = sharedGeo("boxHead", () => new THREE.BoxGeometry(0.42, 0.42, 0.42));
    this.head.geometry = box ? this.boxHeadGeo! : this.sphereHeadGeo;
    this.clearAccessory();
    // Accessoires absents en qualité potato : le corps et la tête suffisent.
    if (look && look.accessory !== "none" && this.q.playerDetail !== "minimal") this.buildAccessory(look);
  }

  // Accessoire accroché à la tête (il suit son balancement).
  private buildAccessory(look: SkinLook): void {
    const g = new THREE.Group();
    const mat = this.q.simpleMaterials
      ? new THREE.MeshBasicMaterial({ color: look.accent })
      : new THREE.MeshStandardMaterial({ color: look.accent, emissive: look.accent, emissiveIntensity: 0.8, metalness: 0.2, roughness: 0.4 });
    this.addDissolve(mat);
    this.accessoryDisposables.push(mat);
    let part = 0;
    const add = (make: () => THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, rz = 0) => {
      const geo = sharedGeo(`acc:${look.accessory}:${this.q.playerDetail}:${part++}`, make);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, 0, rz);
      g.add(mesh);
    };
    const seg = this.q.playerDetail === "rich" ? 16 : 10;
    switch (look.accessory) {
      case "headband":
        add(() => new THREE.TorusGeometry(0.27, 0.035, 6, seg), 0, 0.05, 0, Math.PI / 2);
        break;
      case "antenna":
        add(() => new THREE.CylinderGeometry(0.018, 0.018, 0.28, 6), 0, 0.33, 0);
        add(() => new THREE.SphereGeometry(0.06, 8, 6), 0, 0.5, 0);
        break;
      case "visor":
        add(() => new THREE.BoxGeometry(0.4, 0.1, 0.06), 0, 0.03, 0.24);
        break;
      case "horns":
        add(() => new THREE.ConeGeometry(0.07, 0.3, 8), -0.16, 0.24, 0, 0, 0.5);
        add(() => new THREE.ConeGeometry(0.07, 0.3, 8), 0.16, 0.24, 0, 0, -0.5);
        break;
      case "crest":
        // Cimier de heaume, d'avant en arrière.
        add(() => new THREE.BoxGeometry(0.06, 0.2, 0.44), 0, 0.3, -0.02);
        break;
      case "hood":
        // Capuche pointue, ouverte : elle coiffe la tête sans la masquer.
        add(() => new THREE.ConeGeometry(0.34, 0.6, seg, 1, true), 0, 0.14, -0.04, -0.15);
        break;
      case "ears":
        add(() => new THREE.ConeGeometry(0.08, 0.22, 4), -0.15, 0.25, 0, 0, 0.3);
        add(() => new THREE.ConeGeometry(0.08, 0.22, 4), 0.15, 0.25, 0, 0, -0.3);
        break;
      case "none":
        break;
    }
    this.head.add(g);
    this.accessory = g;
  }

  private clearAccessory(): void {
    if (this.accessory) this.head.remove(this.accessory);
    this.accessory = null;
    for (const d of this.accessoryDisposables) d.dispose();
    this.accessoryDisposables = [];
  }

  // Traînée équipée : visible pour tous ; sans elle, seul le joueur local
  // en a une, à sa couleur. Aucune en basse qualité (q.playerTrail).
  private applyTrail(look: TrailLook | null): void {
    this.trailLook = look;
    this.hasTrail = this.q.playerTrail && (this.isLocal || look !== null);
    if (look) {
      this.trailColor.setHex(look.head);
      this.trailTail.setHex(look.tail);
    } else {
      this.trailColor.copy(this.baseTrailColor);
      this.trailTail.copy(this.baseTrailColor);
    }
    this.trailCount = 0;
    if (this.hasTrail) this.ensureRibbon();
    this.ribbon?.geometry.setDrawRange(0, 0);
  }

  // Ruban de la traînée (espace monde), créé au premier besoin.
  private ensureRibbon(): void {
    if (this.ribbon) return;
    // Deux sommets par point (tête, échantillons, bout interpolé) ; alpha
    // par sommet (couleur RGBA).
    const points = TRAIL_SAMPLES + 2;
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(points * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    trailGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(points * 2 * 4), 4).setUsage(THREE.DynamicDrawUsage));
    const index: number[] = [];
    for (let i = 0; i < points - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    trailGeo.setIndex(index);
    trailGeo.setDrawRange(0, 0);
    const trailMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const ribbon = new THREE.Mesh(trailGeo, trailMat);
    ribbon.frustumCulled = false;
    this.ribbon = ribbon;
    this.trail.add(ribbon);
    this.disposables.push(trailGeo, trailMat);
  }

  // Dissolution injectée dans un matériau du corps (position monde du
  // fragment, seuil, liseré, teinte).
  private addDissolve(mat: THREE.Material): void {
    const blocky = this.q.playerDetail === "minimal";
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uDissolve = this.uDissolve;
      shader.uniforms.uDissolveColor = this.uDissolveColor;
      shader.uniforms.uDissolveGlow = this.uDissolveGlow;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vDissolvePos;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvDissolvePos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>\n${blocky ? "#define DISSOLVE_BLOCKY\n#define DISSOLVE_SCALE 6.0" : "#define DISSOLVE_SCALE 4.5"}\n${DISSOLVE_GLSL}`,
        )
        .replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\n${DISSOLVE_CUT}`)
        // Teinte en espace linéaire, avant la conversion de sortie.
        .replace("#include <opaque_fragment>", `#include <opaque_fragment>\n${DISSOLVE_TINT}`);
    };
    // Même programme pour tous les joueurs (le texte de onBeforeCompile est
    // identique, pas ses valeurs capturées : la clé les distingue).
    mat.customProgramCacheKey = () => `player-dissolve:${blocky ? "blocks" : "noise"}`;
  }

  // Début de la dissolution (élimination), à la couleur donnée ; glow : part
  // de cette couleur (réglage des flashs). Anneau, halo et repères d'allié
  // disparaissent aussitôt : ce sont des repères de jeu, pas le corps.
  startDissolve(color: number, glow: number): void {
    if (this.dissolveT >= 0) return;
    this.dissolveT = 0;
    this.uDissolve.value = 0.001;
    this.uDissolveColor.value.setHex(color);
    this.uDissolveGlow.value = glow;
    this.ring.visible = false;
    if (this.protHalo) this.protHalo.visible = false;
    this.resetTrail();
  }

  // Avance la dissolution ; vrai tant qu'elle n'est pas finie.
  updateDissolve(dt: number): boolean {
    if (this.dissolveT < 0 || this.dissolveT >= 1) return false;
    this.dissolveT = Math.min(1, this.dissolveT + dt / DISSOLVE_S);
    // Au-delà de 1 : le dernier fragment (seuil maximal 1) disparaît.
    this.uDissolve.value = this.dissolveT * 1.1;
    return this.dissolveT < 1;
  }

  get dissolving(): boolean {
    return this.dissolveT >= 0 && this.dissolveT < 1;
  }

  // Corps intact (réapparition).
  resetDissolve(): void {
    if (this.dissolveT < 0) return;
    this.dissolveT = -1;
    this.uDissolve.value = 0;
    this.ring.visible = true;
    if (this.protHalo) this.protHalo.visible = this.protected_;
  }

  setSnapshot(x: number, y: number, now: number): void {
    if (x === this.targetX && y === this.targetY) return;
    this.prevX = this.targetX;
    this.prevY = this.targetY;
    this.prevTime = this.targetTime;
    this.targetX = x;
    this.targetY = y;
    this.targetTime = now;
  }

  interpolate(now: number, renderDelay: number): void {
    const renderTime = now - renderDelay;
    const span = this.targetTime - this.prevTime;
    if (span <= 0) {
      this.renderX = this.targetX;
      this.renderY = this.targetY;
    } else {
      // Lerp linéaire : vélocité constante dans un segment, discontinue à
      // chaque transition de snapshot. Sur écran 240+Hz les kinks sont
      // visibles ("pas fluide" malgré 480fps). Le vrai fix demanderait
      // de stocker 3+ snapshots et faire Catmull-Rom (continuité de
      // vélocité). Smoothstep n'est pas la solution : il met la vélocité
      // à 0 aux extrémités → micro stop-and-go pire que les kinks.
      const alpha = Math.max(0, Math.min(1, (renderTime - this.prevTime) / span));
      this.renderX = this.prevX + (this.targetX - this.prevX) * alpha;
      this.renderY = this.prevY + (this.targetY - this.prevY) * alpha;
    }
    this.root.position.set(this.renderX, 0, this.renderY);
  }

  setLocalRender(x: number, y: number): void {
    this.renderX = x;
    this.renderY = y;
    this.root.position.set(x, 0, y);
  }

  get isProtectedShown(): boolean {
    return this.protected_;
  }

  setAlly(ally: boolean): void {
    if (ally === this.ally || this.isLocal) return;
    this.ally = ally;
    const palette = getActiveTheme().palette;
    const color = ally ? palette.playerLocal.accent : palette.playerRemote.accent;
    (this.ring.material as THREE.MeshBasicMaterial).color.setHex(color);
    if (ally && !this.allyMarks) {
      const geo = sharedGeo("allyMarks", allyMarksGeometry);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
      // Enfant de l'anneau : à plat comme lui.
      this.allyMarks = new THREE.Mesh(geo, mat);
      this.ring.add(this.allyMarks);
      this.disposables.push(mat);
    }
    if (this.allyMarks) this.allyMarks.visible = ally;
  }

  setProtected(active: boolean): void {
    if (this.protected_ === active) return;
    this.protected_ = active;
    if (this.protHalo) {
      this.protHalo.visible = active;
      if (!active) (this.protHalo.material as THREE.MeshBasicMaterial).opacity = 0;
    }
  }

  animate(dt: number): void {
    if (this.protected_ && this.protHalo) {
      this.protPhase += dt * 4.5;
      const o = 0.25 + (Math.sin(this.protPhase) * 0.5 + 0.5) * 0.30;
      (this.protHalo.material as THREE.MeshBasicMaterial).opacity = o;
      const s = 1.0 + Math.sin(this.protPhase * 0.7) * 0.06 + 0.06;
      this.protHalo.scale.set(s, s, 1);
    }
    const vx = this.renderX - this.prevRenderX;
    const vy = this.renderY - this.prevRenderY;
    const speed = Math.hypot(vx, vy) / Math.max(1e-6, dt);
    const moving = speed > 0.5;
    // Vitesse affichée (lignes de vitesse du boost), lissée : un saut d'une
    // frame (recalage) ne doit pas la faire bondir.
    this.moveSpeed += (Math.min(speed, 40) - this.moveSpeed) * Math.min(1, dt * 12);
    if (moving) {
      const d = Math.hypot(vx, vy);
      this.moveX = vx / d;
      this.moveZ = vy / d;
    }

    if (moving) {
      const target = Math.atan2(vx, vy);
      const cur = this.root.rotation.y;
      let delta = target - cur;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      this.root.rotation.y = cur + delta * Math.min(1, dt * 12);
    }

    // Animation de marche : seulement si on a les membres.
    if (this.leftLeg && this.rightLeg && this.leftArm && this.rightArm) {
      const walkRate = moving ? Math.min(12, 3 + speed * 0.8) : 0;
      this.walkPhase += dt * walkRate;
      const amp = moving ? Math.min(0.35, speed * 0.03) : 0;
      const s = Math.sin(this.walkPhase);
      this.leftLeg.position.z = s * amp;
      this.rightLeg.position.z = -s * amp;
      this.leftArm.position.z = -s * amp * 0.7;
      this.rightArm.position.z = s * amp * 0.7;
      const bob = moving ? Math.abs(Math.sin(this.walkPhase * 2)) * 0.04 : 0;
      this.body.position.y = 0.95 + bob;
      this.head.position.y = 1.55 + bob;
    }

    this.prevRenderX = this.renderX;
    this.prevRenderY = this.renderY;
  }

  // Repart de zéro (apparition) : pas de trait depuis l'ancienne position.
  resetTrail(): void {
    this.trailCount = 0;
    this.ribbon?.geometry.setDrawRange(0, 0);
  }

  updateTrail(dt: number): void {
    if (!this.hasTrail) return;
    const x = this.renderX;
    const z = this.renderY;
    if (Math.hypot(x - this.trailHeadX, z - this.trailHeadZ) > TRAIL_JUMP) this.trailCount = 0;
    this.trailHeadX = x;
    this.trailHeadZ = z;
    this.trailClock += dt * 1000;
    const now = this.trailClock;
    if (this.trailCount === 0 || now - this.trailT[0] >= TRAIL_SAMPLE_MS) {
      // Nouvel échantillon en tête ; le plus ancien sort si plein.
      const n = Math.min(this.trailCount, TRAIL_SAMPLES - 1);
      this.trailX.copyWithin(1, 0, n);
      this.trailZ.copyWithin(1, 0, n);
      this.trailT.copyWithin(1, 0, n);
      this.trailX[0] = x;
      this.trailZ[0] = z;
      this.trailT[0] = now;
      this.trailCount = n + 1;
    }
    this.buildTrail(now);
  }

  // Ruban : la tête (position courante), les échantillons plus récents que
  // TRAIL_MS, puis un dernier point interpolé à exactement TRAIL_MS. La
  // longueur ne dépend que de la vitesse, pas du FPS.
  private buildTrail(now: number): void {
    const mesh = this.ribbon;
    if (!mesh) return;
    const geo = mesh.geometry;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const col = geo.getAttribute("color") as THREE.BufferAttribute;
    const px = pos.array as Float32Array;
    const cc = col.array as Float32Array;
    const cut = now - TRAIL_MS;
    let n = 0;
    let lastX = this.trailHeadX;
    let lastZ = this.trailHeadZ;
    let lastT = now;
    // Points du ruban, de la tête au bout, rangés dans px avant d'y
    // calculer les bords (x, z, âge dans px[0..2]).
    const pts = this.trailPts;
    pts[0] = lastX; pts[1] = lastZ; pts[2] = 0;
    n = 1;
    for (let i = 0; i < this.trailCount; i++) {
      const t = this.trailT[i];
      const sx = this.trailX[i];
      const sz = this.trailZ[i];
      if (t >= cut) {
        if (t < lastT || sx !== lastX || sz !== lastZ) {
          pts[n * 3] = sx; pts[n * 3 + 1] = sz; pts[n * 3 + 2] = now - t;
          n++;
          lastX = sx; lastZ = sz; lastT = t;
        }
        continue;
      }
      // Premier échantillon trop vieux : bout interpolé à `cut`, puis fin.
      const span = lastT - t;
      const k = span > 0 ? (lastT - cut) / span : 0;
      pts[n * 3] = lastX + (sx - lastX) * k;
      pts[n * 3 + 1] = lastZ + (sz - lastZ) * k;
      pts[n * 3 + 2] = TRAIL_MS;
      n++;
      break;
    }
    if (n < 2) {
      geo.setDrawRange(0, 0);
      return;
    }
    let perpX = 0;
    let perpZ = 0;
    for (let i = 0; i < n; i++) {
      const x = pts[i * 3];
      const z = pts[i * 3 + 1];
      // Direction locale du ruban : vers le point suivant (le précédent
      // pour le bout) ; un segment nul garde la normale d'avant.
      const j = i < n - 1 ? i + 1 : i - 1;
      const dx = (pts[j * 3] - x) * (i < n - 1 ? 1 : -1);
      const dz = (pts[j * 3 + 1] - z) * (i < n - 1 ? 1 : -1);
      const len = Math.hypot(dx, dz);
      if (len > 1e-4) {
        perpX = -dz / len;
        perpZ = dx / len;
      }
      const f = Math.min(1, pts[i * 3 + 2] / TRAIL_MS);
      const w = TRAIL_HALF_WIDTH * (1 - f) * (this.trailLook?.width ?? 1);
      const a = TRAIL_ALPHA * (1 - f) * (1 - f) * (this.trailLook?.alpha ?? 1);
      const v = i * 2 * 3;
      px[v] = x + perpX * w; px[v + 1] = TRAIL_Y; px[v + 2] = z + perpZ * w;
      px[v + 3] = x - perpX * w; px[v + 4] = TRAIL_Y; px[v + 5] = z - perpZ * w;
      // Dégradé de la tête au bout (uni pour la traînée de base).
      const c = i * 2 * 4;
      const head = this.trailColor;
      const tail = this.trailTail;
      cc[c] = cc[c + 4] = head.r + (tail.r - head.r) * f;
      cc[c + 1] = cc[c + 5] = head.g + (tail.g - head.g) * f;
      cc[c + 2] = cc[c + 6] = head.b + (tail.b - head.b) * f;
      cc[c + 3] = cc[c + 7] = a;
    }
    geo.setDrawRange(0, (n - 1) * 6);
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  // Longueur du ruban au sol (u), le long de son axe : contrôle de la
  // tâche 2.6 (identique à 30 et 144 FPS).
  trailLength(): number {
    const geo = this.ribbon?.geometry;
    if (!geo) return 0;
    const segments = geo.drawRange.count / 6;
    let len = 0;
    for (let i = 0; i < segments; i++) {
      len += Math.hypot(this.trailPts[(i + 1) * 3] - this.trailPts[i * 3], this.trailPts[(i + 1) * 3 + 1] - this.trailPts[i * 3 + 1]);
    }
    return len;
  }

  dispose(): void {
    this.root.parent?.remove(this.root);
    this.clearAccessory();
    for (const d of this.disposables) d.dispose();
  }
}

// Quatre losanges dans le plan de l'anneau, en diagonale, entre l'anneau
// (0,72) et le halo de protection (1,0).
function allyMarksGeometry(): THREE.BufferGeometry {
  const r = 0.88;
  const h = 0.1;
  const pos: number[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i + 0.5) * (Math.PI / 2);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    pos.push(x + h, y, 0, x, y + h, 0, x - h, y, 0);
    pos.push(x - h, y, 0, x, y - h, 0, x + h, y, 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return geo;
}
