import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MAP_RADIUS, WALL_KILL_THICKNESS } from "@bladeio/shared";
import { QualityConfig } from "../quality";
import { getActiveTheme } from "../themes";
import { READABILITY, groundUniformName } from "../themes/readability";

// Vertex shader commun à tous les thèmes : projette la position monde dans
// vWorld pour que le fragment shader puisse calculer ses effets en
// coordonnées world-space (insensibles à la rotation/translation du mesh).
const GROUND_VERT = /* glsl */ `
  varying vec2 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

// Sources GLSL du fragment shader fournies par le thème actif
// (theme.ground.fragRich/fragSimple/fragFlat). Chaque thème a sa propre
// vision du sol — grille néon, brume mauve organique, etc.

// Sortie commune à tous les sols (tâche 6.3), ajoutée après le main du thème
// (renommé) :
// - garde-fou de lisibilité : la luminance affichée ne dépasse jamais
//   READABILITY.groundMaxLuma, quel que soit le shader (teinte gardée) ;
// - tramage anti-banding (rich, simple) d'un demi-niveau sur 255, calculé
//   dans l'espace d'affichage (gamma 2,2 approché) : ajouté en linéaire comme
//   les thèmes le faisaient, il devenait un grain de 4 à 5 niveaux dans les
//   sombres une fois encodé ;
// - conversion vers l'espace de sortie, comme les matériaux de three : le
//   shader travaille en linéaire. Sans elle, le sol s'affichait plus sombre
//   sans post-FX (low, ultra : rendu direct, sortie brute) qu'avec (high,
//   medium : OutputPass encode en sRGB), et les couleurs déclarées par le
//   thème n'étaient celles de l'écran qu'avec post-FX.
const GROUND_OUTPUT = /* glsl */ `
precision highp float;
uniform float uGroundMaxLuma;
float groundDither(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
}
void main() {
  themeGround();
  vec3 c = max(gl_FragColor.rgb, vec3(0.0));
  float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c *= min(1.0, uGroundMaxLuma / max(y, 1e-5));
  #ifdef GROUND_DITHER
  c = pow(max(pow(c, vec3(1.0 / 2.2)) + groundDither(gl_FragCoord.xy) / 255.0, vec3(0.0)), vec3(2.2));
  #endif
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`;

function wrapGroundShader(src: string, dither: boolean): string {
  const body = src.replace(/void\s+main\s*\(\s*\)/, "void themeGround()");
  return (dither ? "#define GROUND_DITHER\n" : "") + body + GROUND_OUTPUT;
}

export interface GroundSurface {
  mesh: THREE.Mesh;
  update: (t: number) => void;
  // Rayon de l'arène du moment (ArenaState.mapRadius) : le sol s'éteint
  // au-delà du mur (tâche 4.5).
  setRadius: (radius: number) => void;
}

// Les shaders du sol l'éteignent sur 30 à 60 u avant uRadius : uRadius =
// mur + GROUND_FADE, sans dépasser le bord de la carte (le plan du sol est
// un carré, son bord se verrait). L'arène pleine garde son sol d'avant ;
// plus petite, seule la zone mortelle s'assombrit.
const GROUND_FADE = 60;

export function createGround(q: QualityConfig): GroundSurface {
  const theme = getActiveTheme();
  const geo = new THREE.PlaneGeometry(MAP_RADIUS * 2.2, MAP_RADIUS * 2.2, 1, 1);
  let frag: string;
  switch (q.groundDetail) {
    case "rich": frag = theme.ground.fragRich; break;
    case "simple": frag = theme.ground.fragSimple; break;
    case "flat": frag = theme.ground.fragFlat; break;
  }

  // Uniforms communs à tous les thèmes : uRadius (toujours), uTime (en rich
  // seulement quand le shader anime quelque chose), plafond de luminance, et
  // une couleur par entrée de theme.ground.colors (uBase pour base…), en
  // linéaire (THREE.Color convertit le hex sRGB).
  const uniforms: Record<string, THREE.IUniform> = {
    uRadius: { value: MAP_RADIUS },
    uGroundMaxLuma: { value: READABILITY.groundMaxLuma },
  };
  for (const [key, hex] of Object.entries(theme.ground.colors)) {
    uniforms[groundUniformName(key)] = { value: new THREE.Color(hex) };
  }
  const hasTime = q.groundDetail === "rich";
  if (hasTime) uniforms.uTime = { value: 0 };

  const mat = new THREE.ShaderMaterial({
    vertexShader: GROUND_VERT,
    // Sol uni en potato : pas de dégradé à tramer, quelques opérations de
    // moins par pixel sur les plus petits GPU.
    fragmentShader: wrapGroundShader(frag, q.groundDetail !== "flat"),
    uniforms,
    transparent: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();

  const radius = mat.uniforms.uRadius as THREE.IUniform;
  return {
    mesh,
    update(t: number) {
      if (hasTime) (mat.uniforms.uTime as THREE.IUniform).value = t;
    },
    setRadius(r: number) {
      radius.value = Math.min(MAP_RADIUS, r + GROUND_FADE);
    },
  };
}

// Arène resserrée (fin de manche, tâche 7.1) : chaque sommet du mur recule
// de uShift vers le centre (rayon de la carte moins rayon du moment). La
// géométrie reste celle du rayon plein, l'épaisseur des bandes ne change pas.
// La bande de danger, elle, garde son bord extérieur au bord de la carte :
// seuls ses sommets intérieurs (rayon < uKeepBeyond) reculent, et toute
// l'arène perdue se couvre de la zone mortelle.
const SHIFT_GLSL = /* glsl */ `
  vec2 shiftRadial(vec2 p, float shift) {
    float r = length(p);
    return p * (max(r - shift, 0.0) / max(r, 1e-4));
  }
  vec2 shiftInner(vec2 p, float shift, float keepBeyond) {
    return length(p) < keepBeyond ? shiftRadial(p, shift) : p;
  }
`;

// Rideau du mur (qualités high/medium) : bandes diagonales qui défilent le
// long de la bordure, façon ruban de chantier, avec une pulsation lente et
// un fondu vers le haut. 160 bandes sur le tour, soit une tous les ~10 u.
const WALL_CURTAIN_VERT = /* glsl */ `
  uniform float uShift;
  varying vec2 vUv;
  ${SHIFT_GLSL}
  void main() {
    vUv = uv;
    vec3 p = position;
    p.xz = shiftRadial(p.xz, uShift);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const WALL_CURTAIN_FRAG = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    float stripes = step(0.5, fract(vUv.x * 160.0 + vUv.y * 1.5 - uTime * 0.6));
    float pulse = 0.75 + 0.25 * sin(uTime * 3.0);
    float fade = 1.0 - vUv.y; // uv.y = 0 en bas du rideau, 1 en haut
    gl_FragColor = vec4(uColor, (0.05 + 0.22 * stripes) * pulse * fade);
  }
`;

// Bande de danger au sol (qualités high/medium), sur les derniers mètres
// avant la zone mortelle : c'est ce que la caméra plongeante voit le mieux,
// bien plus que le rideau vertical. Rayures diagonales qui tournent (~390
// sur le tour), rampe d'opacité vers la zone mortelle, zone mortelle
// elle-même quasi pleine. highp : atan() et des coordonnées monde de ~250 u
// crénèlent en mediump.
const DANGER_BAND_VERT = /* glsl */ `
  uniform float uShift;
  uniform float uKeepBeyond;
  varying vec2 vWorld;
  ${SHIFT_GLSL}
  void main() {
    vec3 p = position;
    p.xy = shiftInner(p.xy, uShift, uKeepBeyond);
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vWorld = wp.xz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const DANGER_BAND_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uInner;
  uniform float uKill;
  varying vec2 vWorld;
  void main() {
    float r = length(vWorld);
    float a = atan(vWorld.y, vWorld.x);
    float stripes = step(0.5, fract(a * 62.0 + r * 0.25 - uTime * 0.8));
    float ramp = smoothstep(uInner, uKill, r);
    float lethal = step(uKill, r);
    float pulse = 0.8 + 0.2 * sin(uTime * 4.0);
    float alpha = mix((0.08 + 0.32 * stripes) * ramp, 0.55 + 0.25 * stripes, lethal) * pulse;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

// Même décalage pour les matériaux de three.js (anneau, bande unie) : la
// gestion des couleurs reste la leur. Plan du cercle : xy de la géométrie
// (anneau et bande sont couchés par leur rotation).
function shiftVertices(mat: THREE.Material, shift: THREE.IUniform, keepBeyond = Infinity): void {
  const move = Number.isFinite(keepBeyond)
    ? `transformed.xy = shiftInner(transformed.xy, uShift, ${keepBeyond.toFixed(2)});`
    : "transformed.xy = shiftRadial(transformed.xy, uShift);";
  // Clé de cache propre à la variante : sinon three.js réutilise le
  // programme de l'anneau pour la bande (même source d'onBeforeCompile), et
  // l'anneau restait au bord de la carte en qualité basse.
  mat.customProgramCacheKey = () => `arena-shift:${keepBeyond}`;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uShift = shift;
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", `uniform float uShift;\n${SHIFT_GLSL}\nvoid main() {`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${move}`);
  };
}

export interface BoundaryWall {
  object: THREE.Object3D;
  update: (t: number) => void;
  // Rayon de l'arène du moment (ArenaState.mapRadius).
  setRadius: (radius: number) => void;
  // Resserrement annoncé (tâche 4.5) : rayon où le mur s'arrêtera (0 :
  // aucun), et préavis en cours (le repère pulse).
  setTarget: (radius: number, warning: boolean) => void;
  // 0 : pas de pulsation (flashs coupés), 1 : pleine.
  setFlashIntensity: (k: number) => void;
}

// Repère du resserrement annoncé : la future limite mortelle, en tirets au
// sol (la forme le distingue du mur, en plus de la luminosité), un tous
// les ~8 u.
function createTargetRing(color: number): {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  build: (killRadius: number) => void;
} {
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.05;
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return {
    mesh,
    mat,
    build(killRadius: number) {
      const dashes = Math.max(24, Math.round((2 * Math.PI * killRadius) / 8));
      const step = (2 * Math.PI) / dashes;
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < dashes; i++) {
        parts.push(new THREE.RingGeometry(killRadius - 0.35, killRadius + 0.35, 2, 1, i * step, step * 0.55));
      }
      const merged = mergeGeometries(parts, false);
      for (const g of parts) g.dispose();
      mesh.geometry.dispose();
      if (merged) mesh.geometry = merged;
    },
  };
}

// Mur de la zone mortelle. Toutes qualités : anneau lumineux qui pulse et
// bande de danger au sol. high/medium : rideau vertical animé en plus. Le
// mur doit paraître dangereux : c'est la seule chose qui tue sans adversaire.
export function createBoundaryWall(q: QualityConfig): BoundaryWall {
  const theme = getActiveTheme();
  const group = new THREE.Group();
  const shift: THREE.IUniform = { value: 0 };
  const segments = q.wallSegments;
  const tubeSeg = q.wallSegments >= 64 ? 8 : 4;
  const geo = new THREE.TorusGeometry(MAP_RADIUS, 0.6, tubeSeg, segments);
  const ringMat = new THREE.MeshBasicMaterial({
    color: theme.palette.boundary,
    transparent: true,
    opacity: 0.85,
  });
  shiftVertices(ringMat, shift);
  const torus = new THREE.Mesh(geo, ringMat);
  torus.rotation.x = Math.PI / 2;
  torus.position.y = 1.0;
  torus.matrixAutoUpdate = false;
  torus.updateMatrix();
  group.add(torus);

  // Bande de danger au sol : shader rayé en high/medium, bande unie qui
  // pulse en low/ultra. 64 segments minimum : avec les 24 du preset ultra,
  // le polygone s'écarterait de 2 u du vrai cercle, là où la précision compte.
  const killRadius = MAP_RADIUS - WALL_KILL_THICKNESS;
  const bandInner = killRadius - 6;
  const bandGeo = new THREE.RingGeometry(bandInner, MAP_RADIUS + 0.5, Math.max(64, segments), 1);
  let bandUniforms: {
    uColor: THREE.IUniform; uTime: THREE.IUniform; uInner: THREE.IUniform; uKill: THREE.IUniform;
    uShift: THREE.IUniform; uKeepBeyond: THREE.IUniform;
  } | null = null;
  let bandBasic: THREE.MeshBasicMaterial | null = null;
  let bandMat: THREE.Material;
  if (q.wallSegments >= 64) {
    bandUniforms = {
      uColor: { value: new THREE.Color(theme.palette.boundary) },
      uTime: { value: 0 },
      uInner: { value: bandInner },
      uKill: { value: killRadius },
      uShift: shift,
      uKeepBeyond: { value: killRadius },
    };
    bandMat = new THREE.ShaderMaterial({
      vertexShader: DANGER_BAND_VERT,
      fragmentShader: DANGER_BAND_FRAG,
      uniforms: bandUniforms,
      transparent: true,
      depthWrite: false,
    });
  } else {
    bandBasic = new THREE.MeshBasicMaterial({
      color: theme.palette.boundary,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    });
    shiftVertices(bandBasic, shift, killRadius);
    bandMat = bandBasic;
  }
  const band = new THREE.Mesh(bandGeo, bandMat);
  band.rotation.x = -Math.PI / 2;
  band.position.y = 0.04;
  band.frustumCulled = false;
  band.matrixAutoUpdate = false;
  band.updateMatrix();
  group.add(band);

  let curtainUniforms: { uColor: THREE.IUniform; uTime: THREE.IUniform; uShift: THREE.IUniform } | null = null;
  if (q.wallSegments >= 64) {
    curtainUniforms = {
      uColor: { value: new THREE.Color(theme.palette.boundary) },
      uTime: { value: 0 },
      uShift: shift,
    };
    const wallGeo = new THREE.CylinderGeometry(MAP_RADIUS, MAP_RADIUS, 4, segments, 1, true);
    const wallMat = new THREE.ShaderMaterial({
      vertexShader: WALL_CURTAIN_VERT,
      fragmentShader: WALL_CURTAIN_FRAG,
      uniforms: curtainUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.y = 2;
    wall.matrixAutoUpdate = false;
    wall.updateMatrix();
    group.add(wall);
  }

  const target = createTargetRing(theme.palette.boundary);
  group.add(target.mesh);
  let targetRadius = 0;
  let targetWarning = false;
  let flash = 1;

  group.matrixAutoUpdate = false;
  group.updateMatrix();
  return {
    object: group,
    update(t: number) {
      ringMat.opacity = 0.65 + 0.3 * (0.5 + 0.5 * Math.sin(t * 3));
      if (curtainUniforms) curtainUniforms.uTime.value = t;
      if (bandUniforms) bandUniforms.uTime.value = t;
      if (bandBasic) bandBasic.opacity = 0.18 + 0.12 * Math.sin(t * 4);
      // Préavis : le repère pulse (selon le réglage des flashs) ; le mur en
      // marche, il reste plein.
      if (target.mesh.visible) {
        const pulse = targetWarning ? 0.5 + 0.5 * Math.sin(t * 6) : 1;
        target.mat.opacity = 0.7 - 0.45 * flash * (1 - pulse);
      }
    },
    setTarget(radius: number, warning: boolean) {
      targetWarning = warning;
      target.mesh.visible = radius > 0;
      if (radius <= 0 || Math.abs(radius - targetRadius) < 0.05) return;
      targetRadius = radius;
      target.build(radius - WALL_KILL_THICKNESS);
    },
    setFlashIntensity(k: number) {
      flash = Math.max(0, Math.min(1, k));
    },
    setRadius(radius: number) {
      const d = Math.max(0, MAP_RADIUS - radius);
      if (d === shift.value) return;
      shift.value = d;
      if (bandUniforms) {
        bandUniforms.uInner.value = bandInner - d;
        bandUniforms.uKill.value = killRadius - d;
      }
    },
  };
}
