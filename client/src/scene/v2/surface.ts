import * as THREE from "three";

// Matière des surfaces du rendu v2 : ce qui sépare un aplat de couleur d'un
// mur de béton, d'une tôle ou d'un bitume. Injecté dans les matériaux
// éclairés de three.js (ils gardent lumières, ombres, environnement) pour
// tout ce qui ne bouge pas :
//  - grain et taches : la couleur et la rugosité varient, à l'échelle du
//    centimètre et à celle du mètre ;
//  - relief : la normale est troublée par le grain (les reflets accrochent) ;
//  - salissures : coulures sur les murs, pied des murs encrassé ;
//  - pluie : les faces tournées vers le ciel luisent par plaques ;
//  - lumière des alentours : chaque surface reçoit la lueur des enseignes,
//    vitrines et lampadaires proches, lue dans la texture des lueurs du sol
//    (une lecture de texture au lieu d'une lumière par source).
// Le motif est plaqué depuis les coordonnées monde, selon la face (dessus,
// côtés) : aucune pièce du kit n'a besoin de coordonnées de texture, et deux
// pièces voisines se raccordent. D'où « ce qui ne bouge pas » : sur une
// pièce mobile, le motif glisserait.
//
// Aucune couleur ici : la texture de détail n'est que du relief et des
// variations, les teintes restent celles des matériaux (donc du thème).

const DETAIL_SIZE = 256;

// Bruit de valeur périodique : `period` cases sur le côté, raccordé d'un
// bord à l'autre (la texture se répète sans couture).
function lattice(period: number, seed: number): Float32Array {
  const out = new Float32Array(period * period);
  let s = (seed * 2654435761) >>> 0;
  for (let i = 0; i < out.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = s / 4294967296;
  }
  return out;
}

function sample(grid: Float32Array, period: number, u: number, v: number): number {
  const x = u * period;
  const y = v * period;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  let fx = x - x0;
  let fy = y - y0;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const xa = ((x0 % period) + period) % period;
  const ya = ((y0 % period) + period) % period;
  const xb = (xa + 1) % period;
  const yb = (ya + 1) % period;
  const a = grid[ya * period + xa];
  const b = grid[ya * period + xb];
  const c = grid[yb * period + xa];
  const d = grid[yb * period + xb];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(periods: number[], seed: number): Float32Array {
  const n = DETAIL_SIZE;
  const out = new Float32Array(n * n);
  let amp = 1;
  let total = 0;
  periods.forEach((period, k) => {
    const grid = lattice(period, seed + k * 31);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) out[y * n + x] += amp * sample(grid, period, x / n, y / n);
    }
    total += amp;
    amp *= 0.55;
  });
  // Étalé sur toute la plage : une somme de bruits se tasse vers 0,5.
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < out.length; i++) {
    out[i] /= total;
    if (out[i] < min) min = out[i];
    if (out[i] > max) max = out[i];
  }
  const span = Math.max(1e-6, max - min);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - min) / span;
  return out;
}

let detail: THREE.DataTexture | null = null;

// Texture de détail, la même pour toutes les surfaces : rouge = taches
// (basses fréquences), vert = grain, bleu et alpha = pente du relief (une
// normale, en x et y du plan de plaquage).
export function detailTexture(): THREE.DataTexture {
  if (detail) return detail;
  const n = DETAIL_SIZE;
  const blotch = fbm([4, 8, 16, 32], 11);
  const grain = fbm([48, 96, 128], 23);
  const pores = fbm([64, 128], 41);
  const height = new Float32Array(n * n);
  for (let i = 0; i < height.length; i++) {
    // Relief : le grain, des bosses larges, et des pores creusés.
    height[i] = grain[i] * 0.55 + blotch[i] * 0.35 - Math.max(0, pores[i] - 0.72) * 2.2;
  }
  const data = new Uint8Array(n * n * 4);
  const at = (x: number, y: number) => height[((y + n) % n) * n + ((x + n) % n)];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      const sx = (at(x - 1, y) - at(x + 1, y)) * 3.2;
      const sy = (at(x, y - 1) - at(x, y + 1)) * 3.2;
      data[i] = Math.round(blotch[y * n + x] * 255);
      data[i + 1] = Math.round(grain[y * n + x] * 255);
      data[i + 2] = Math.round(Math.max(0, Math.min(1, 0.5 + 0.5 * sx)) * 255);
      data[i + 3] = Math.round(Math.max(0, Math.min(1, 0.5 + 0.5 * sy)) * 255);
    }
  }
  detail = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  detail.magFilter = THREE.LinearFilter;
  detail.minFilter = THREE.LinearMipmapLinearFilter;
  detail.generateMipmaps = true;
  detail.anisotropy = 4;
  detail.needsUpdate = true;
  return detail;
}

// Lueurs des alentours : texture des lueurs peintes au sol, et passage des
// coordonnées monde (x, z) à ses coordonnées (u = x * su + 0,5,
// v = z * sv + 0,5 ; sv négatif pour une texture de canvas retournée).
export interface SurfaceLight {
  map: THREE.IUniform<THREE.Texture>;
  su: number;
  sv: number;
}

export interface SurfaceLook {
  // Répétitions du motif par unité de monde.
  scale: number;
  // Variation de la couleur, de la rugosité, force du relief.
  tint: number;
  rough: number;
  bump: number;
  // Coulures et encrassement.
  grime: number;
}

export const SURFACE: Record<"concrete" | "metal" | "paint", SurfaceLook> = {
  concrete: { scale: 0.42, tint: 0.34, rough: 0.3, bump: 0.3, grime: 1 },
  metal: { scale: 0.75, tint: 0.2, rough: 0.42, bump: 0.12, grime: 0.6 },
  paint: { scale: 0.5, tint: 0.22, rough: 0.35, bump: 0.16, grime: 0.8 },
};

export interface SurfaceEnv {
  light: SurfaceLight | null;
  // Pluie (0 ou 1) : le dessus des choses luit.
  wet: number;
}

let blank: THREE.DataTexture | null = null;
export function blackTexture(): THREE.DataTexture {
  if (!blank) {
    blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    blank.needsUpdate = true;
  }
  return blank;
}

// Position monde du fragment (vSurfPos), instances comprises.
export function withWorldPosition(shader: { vertexShader: string; fragmentShader: string }): void {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vSurfPos;")
    .replace(
      "#include <project_vertex>",
      `#include <project_vertex>
      vec4 surfWorld = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        surfWorld = instanceMatrix * surfWorld;
      #endif
      vSurfPos = (modelMatrix * surfWorld).xyz;`,
    );
  shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vSurfPos;");
}

const SURFACE_PARS = /* glsl */ `
  uniform sampler2D uSDetail;
  uniform sampler2D uSLight;
  uniform vec4 uSA;
  uniform vec4 uSB;
  uniform vec2 uSLightMap;
`;

// Après le calcul de la normale, avant l'éclairage : couleur, rugosité et
// normale sont encore modifiables. Plan de plaquage : celui de la face
// (dessus, ou l'un des deux côtés), dérivées choisies avec lui pour que le
// filtrage de la texture reste juste d'une face à l'autre.
const SURFACE_BODY = /* glsl */ `
  vec3 sN = inverseTransformDirection(normal, viewMatrix);
  vec3 sAn = abs(sN);
  vec3 sPx = dFdx(vSurfPos);
  vec3 sPy = dFdy(vSurfPos);
  vec2 sUv;
  vec2 sUx;
  vec2 sUy;
  vec3 sT;
  vec3 sBt;
  if (sAn.y >= sAn.x && sAn.y >= sAn.z) {
    sUv = vSurfPos.xz; sUx = sPx.xz; sUy = sPy.xz; sT = vec3(1.0, 0.0, 0.0); sBt = vec3(0.0, 0.0, 1.0);
  } else if (sAn.x >= sAn.z) {
    sUv = vSurfPos.zy; sUx = sPx.zy; sUy = sPy.zy; sT = vec3(0.0, 0.0, 1.0); sBt = vec3(0.0, 1.0, 0.0);
  } else {
    sUv = vSurfPos.xy; sUx = sPx.xy; sUy = sPy.xy; sT = vec3(1.0, 0.0, 0.0); sBt = vec3(0.0, 1.0, 0.0);
  }
  vec4 sFine = textureGrad(uSDetail, sUv * uSA.x, sUx * uSA.x, sUy * uSA.x);
  float sMs = uSA.x * 0.137;
  vec4 sMacro = textureGrad(uSDetail, sUv * sMs + 0.31, sUx * sMs, sUy * sMs);
  // Coulures : le même bruit, étiré de haut en bas, sur les faces debout.
  float sWall = 1.0 - sAn.y;
  vec2 sSs = vec2(0.23, 0.019);
  float sStreak = textureGrad(uSDetail, sUv * sSs + 0.57, sUx * sSs, sUy * sSs).r;
  float sGrime = sWall * (smoothstep(0.5, 0.8, sStreak) * 0.7 + (1.0 - smoothstep(0.0, 2.4, vSurfPos.y)) * 0.5);
  sGrime = clamp(uSB.x * (sGrime + (sMacro.r - 0.5) * 0.3), 0.0, 1.0);
  diffuseColor.rgb *= (1.0 + uSA.y * ((sMacro.r - 0.5) * 1.4 + (sFine.g - 0.5) * 0.6)) * (1.0 - 0.5 * sGrime);
  roughnessFactor = clamp(roughnessFactor + uSA.z * (sFine.r + sMacro.g - 1.0) + 0.25 * sGrime, 0.05, 1.0);
  // Pluie : pellicule d'eau par plaques sur ce qui regarde le ciel.
  float sWet = uSB.y * max(sN.y, 0.0) * smoothstep(0.3, 0.55, sMacro.r);
  roughnessFactor = mix(roughnessFactor, 0.07, sWet);
  diffuseColor.rgb *= 1.0 - 0.3 * sWet;
  // Relief : la normale est de longueur 1 et l'écart reste sous 1, la somme
  // n'est jamais nulle.
  vec2 sNd = (sFine.ba * 2.0 - 1.0) * (uSA.w * (1.0 - 0.8 * sWet));
  normal = normalize(normal + (viewMatrix * vec4(sT * sNd.x + sBt * sNd.y, 0.0)).xyz);
`;

// Après l'éclairage : lueur des sources proches, plus forte près du sol.
const SURFACE_LIGHT = /* glsl */ `
  vec3 sLight = texture2D(uSLight, vSurfPos.xz * uSLightMap + 0.5).rgb;
  float sLh = max(0.0, 1.0 - vSurfPos.y / 11.0);
  reflectedLight.indirectDiffuse += sLight * (sLh * sLh * uSB.z) * material.diffuseColor;
`;

// Force de la lueur des alentours sur les surfaces (la texture est peinte
// faible : au sol, elle ne doit pas noyer les lames).
const LOCAL_LIGHT_GAIN = 3.2;

export function addSurface<T extends THREE.MeshStandardMaterial>(mat: T, look: SurfaceLook, env: SurfaceEnv): T {
  const uniforms = {
    uSDetail: { value: detailTexture() },
    uSLight: env.light ? env.light.map : { value: blackTexture() },
    uSA: { value: new THREE.Vector4(look.scale, look.tint, look.rough, look.bump) },
    uSB: { value: new THREE.Vector4(look.grime, env.wet, env.light ? LOCAL_LIGHT_GAIN : 0, 0) },
    uSLightMap: { value: new THREE.Vector2(env.light?.su ?? 0, env.light?.sv ?? 0) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    withWorldPosition(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${SURFACE_PARS}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${SURFACE_BODY}`)
      .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>\n${SURFACE_LIGHT}`);
  };
  mat.customProgramCacheKey = () => "v2-surface";
  return mat;
}
