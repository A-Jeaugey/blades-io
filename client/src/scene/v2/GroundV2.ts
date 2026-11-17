import * as THREE from "three";
import { MAP_RADIUS } from "@bladeio/shared";
import { getActiveTheme } from "../../themes";
import { READABILITY } from "../../themes/readability";
import type { GroundSurface } from "../Ground";
import { LightPool } from "./DecorV2";

// Sol du rendu v2 (?gfx=v2) : dalles de béton mouillé. C'est un matériau
// éclairé de three.js (il reçoit la lune et les ombres portées) dont on
// remplace la couleur, la rugosité et l'émission par un calcul en
// coordonnées monde :
// - dalles de 5 u aux joints sombres, chacune à sa teinte, taches et grain ;
// - flaques : lisses, plus sombres, elles renvoient le ciel et les lueurs ;
// - rails lumineux tous les 20 u : le repère de vitesse de la grille
//   d'origine ;
// - lueurs des pièces du décor, lues dans une texture peinte une fois.
// Toutes les couleurs viennent du thème (ground.colors.base, brouillard,
// décor) ; la sortie garde le plafond de luminance du contrat de lisibilité
// (READABILITY.groundMaxLuma), lueurs comprises.

// Demi-côté du plan du sol, et de la zone couverte par la texture des lueurs.
const EXTENT = MAP_RADIUS * 1.1;
const POOL_TEXTURE_SIZE = 1024;
// Même fondu que les sols d'origine au-delà du mur (cf. Ground.ts).
const GROUND_FADE = 60;
// Lumière reçue par le sol (lune, ciel) : environ 0,4 fois sa couleur.
// Compensé en partie : la dalle sèche reste un peu sous la couleur déclarée
// par le thème, pour que les lueurs du décor s'en détachent.
const ALBEDO_BOOST = 1.7;

const GROUND_PARS = /* glsl */ `
  uniform vec3 uGBase;
  uniform vec3 uGRail;
  uniform vec3 uGSky;
  uniform sampler2D uGPools;
  uniform float uGExtent;
  uniform float uGRadius;
  uniform float uGMaxLuma;
  varying vec3 vGroundPos;
  float gHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float gNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x),
               mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float gFbm(vec2 p) {
    float a = 0.5;
    float s = 0.0;
    for (int k = 0; k < 3; k++) {
      s += a * gNoise(p);
      p = p * 2.03 + 17.0;
      a *= 0.5;
    }
    return s;
  }
`;

// Couleur : dalles, joints, taches, flaques, canal des rails.
const GROUND_COLOR = /* glsl */ `
  vec2 gp = vGroundPos.xz;
  vec2 gSlab = gp / 5.0;
  vec2 gEdge = abs(fract(gSlab) - 0.5);
  // Largeur d'un pixel en dalles : le joint s'adoucit, puis s'efface quand
  // il devient plus fin qu'un pixel (caméra reculée), sans moirer.
  float gAa = max(fwidth(gSlab.x), fwidth(gSlab.y));
  float gSeam = smoothstep(0.491 - gAa, 0.491, max(gEdge.x, gEdge.y)) * clamp(0.03 / max(gAa, 1e-4), 0.0, 1.0);
  float gTint = gHash(floor(gSlab));
  float gWet = smoothstep(0.6, 0.625, gFbm(gp * 0.11));
  float gStain = gFbm(gp * 0.45 + 31.0);
  float gFine = gNoise(gp * 3.1);
  // Rails : distance au trait le plus proche de la grille de 20 u.
  vec2 gRailD = abs(fract(gp / 20.0 + 0.5) - 0.5) * 20.0;
  float gRd = min(gRailD.x, gRailD.y);
  float gRaa = max(fwidth(gp.x), fwidth(gp.y));
  float gRail = 1.0 - smoothstep(0.04, 0.04 + gRaa, gRd);
  float gChannel = 1.0 - smoothstep(0.18, 0.18 + gRaa, gRd);
  vec3 gCol = uGBase * (0.62 + 0.5 * gStain) * (0.88 + 0.24 * gTint) * (0.94 + 0.12 * gFine);
  gCol *= mix(1.0, 0.6, gWet);
  gCol *= mix(1.0, 0.25, gSeam);
  gCol *= mix(1.0, 0.35, gChannel);
  diffuseColor.rgb = gCol * ${ALBEDO_BOOST.toFixed(2)};
`;

const GROUND_ROUGHNESS = /* glsl */ `
  roughnessFactor = mix(0.8 - 0.15 * gFine, 0.07, gWet);
  roughnessFactor = mix(roughnessFactor, 0.95, gSeam);
`;

// Émission : lueurs du décor (plus vives dans les flaques, qui les
// reflètent), ciel dans les flaques, filet des rails.
const GROUND_EMISSIVE = /* glsl */ `
  vec3 gPool = texture2D(uGPools, gp / (2.0 * uGExtent) + 0.5).rgb;
  totalEmissiveRadiance += gPool * (0.3 + 0.5 * gWet) * (1.0 - 0.6 * gSeam);
  totalEmissiveRadiance += uGSky * 0.3 * gWet;
  totalEmissiveRadiance += uGRail * gRail * 0.45;
`;

// Reflet de la lune : les deux cadrages la voient presque en miroir sur le
// sol. Il s'étalait en liseré clair au bord des flaques (rugosité moyenne)
// et en aplat gris dedans : coupé sur l'eau, atténué sur la dalle sèche
// (un sol sombre et calme, cf. readability.ts). Les flaques ne renvoient
// que le ciel et les lueurs du décor.
const GROUND_SPECULAR = /* glsl */ `
  float gDry = 1.0 - gWet;
  reflectedLight.directSpecular *= 0.3 * gDry * gDry;
`;

// Sortie : fondu au-delà du mur, puis plafond de luminance.
const GROUND_OUTPUT = /* glsl */ `
  outgoingLight *= 1.0 - smoothstep(uGRadius - ${GROUND_FADE.toFixed(1)}, uGRadius, length(vGroundPos.xz));
  float gLuma = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
  outgoingLight *= min(1.0, uGMaxLuma / max(gLuma, 1e-5));
`;

// Une tache par source, en addition : dégradé radial de la couleur de la
// pièce vers le noir. La texture est lue telle que peinte (flipY coupé) :
// u suit x, v suit z.
function paintPools(pools: LightPool[]): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = POOL_TEXTURE_SIZE;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, POOL_TEXTURE_SIZE, POOL_TEXTURE_SIZE);
    ctx.globalCompositeOperation = "lighter";
    const scale = POOL_TEXTURE_SIZE / (2 * EXTENT);
    const c = new THREE.Color();
    for (const p of pools) {
      const px = (p.x + EXTENT) * scale;
      const py = (p.z + EXTENT) * scale;
      const r = p.radius * scale;
      c.set(p.color);
      // getStyle : la couleur en sRGB, celle du canvas.
      const rgb = c.getStyle().replace("rgb(", "").replace(")", "");
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(${rgb},${p.strength})`);
      g.addColorStop(0.35, `rgba(${rgb},${p.strength * 0.45})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

export function createGroundV2(pools: LightPool[]): GroundSurface {
  const theme = getActiveTheme();
  const decor = theme.decor;
  const uniforms = {
    uGBase: { value: new THREE.Color(theme.ground.colors.base) },
    uGRail: { value: new THREE.Color(decor.groundPad) },
    uGSky: { value: new THREE.Color(theme.palette.fogColor) },
    uGPools: { value: paintPools(pools) },
    uGExtent: { value: EXTENT },
    uGRadius: { value: MAP_RADIUS },
    uGMaxLuma: { value: READABILITY.groundMaxLuma },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGroundPos;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${GROUND_PARS}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${GROUND_COLOR}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${GROUND_ROUGHNESS}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${GROUND_EMISSIVE}`)
      .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>\n${GROUND_SPECULAR}`)
      .replace("#include <opaque_fragment>", `${GROUND_OUTPUT}\n#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => "v2-ground";

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(EXTENT * 2, EXTENT * 2, 1, 1), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();

  return {
    mesh,
    update() {},
    setRadius(r: number) {
      uniforms.uGRadius.value = Math.min(MAP_RADIUS, r + GROUND_FADE);
    },
  };
}
