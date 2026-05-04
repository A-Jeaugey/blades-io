import * as THREE from "three";
import { BladeRarity, PowerUpType } from "@bladeio/shared";
import { Theme, computeRarityGlowComp } from "./Theme";

// ─────────────────────────────────────────────────────────────────────────────
// Theme : Profondeurs Glacées
// Identité : cathédrale gelée, aurores boréales, cristaux fracturés. Mood
// silencieux et dangereusement beau — l'inverse intensity du Forge Vermeille.
// Complète le wheel élémentaire (tech / spirit / feu / glace).
// ─────────────────────────────────────────────────────────────────────────────

// Palette structurelle (5 couleurs principales + variations) :
const NIGHT_DEEP = 0x081424;        // nuit minuit profonde — fond du renderer
const FOG_FROST = 0x1a3045;         // brume givrée — brouillard mid
const CRYSTAL_BRIGHT = 0x66c4ff;    // cyan glacial vif — accent saturé
const AURORA_VIOLET = 0xb480ff;     // violet polaire mystique
const AURORA_GREEN = 0x6affb8;      // mint glacé — aurore verte
const AMBER_PRECIOUS = 0xffd49a;    // ambre doré chaud — la rareté max (chaleur dans le froid)
const ICE_PALE = 0xb8d4ec;          // glace pâle — couleur "common" discrète
const BOUNDARY_HOT = 0xff4d6a;      // mur de mort — rouge chaud saturé (signale clairement la mort dans la palette froide)

const RARITY_COLOR_GLACEES: Record<BladeRarity, number> = {
  // Logique : la chaleur est PRÉCIEUSE dans le froid. Common = givre pâle
  // (banal), Legendary = ambre doré (le seul élément chaud → ressort
  // immédiatement comme un trésor dans une mer cyan).
  [BladeRarity.Common]: ICE_PALE,
  [BladeRarity.Rare]: CRYSTAL_BRIGHT,
  [BladeRarity.Epic]: AURORA_VIOLET,
  [BladeRarity.Legendary]: AMBER_PRECIOUS,
};

// Voronoi tessellation — cristaux fracturés au sol. Signature visuelle
// distincte des autres thèmes (grille néon, FBM brume sanctuaire, lava cracks
// forge). Les arêtes des cellules deviennent des veines de cristal lumineux.
const FRAG_RICH_GLACEES = /* glsl */ `
  precision highp float;
  varying vec2 vWorld;
  uniform float uTime;
  uniform float uRadius;
  uniform vec3 uBase;       // pierre glaciaire profonde
  uniform vec3 uMid;        // teinte intermédiaire — variation interne aux cellules
  uniform vec3 uCrystal;    // veines de cristal — les arêtes Voronoï
  uniform vec3 uAurora;     // bandes d'aurore qui dérivent

  float hash11(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  vec2 hash22(vec2 p) {
    return vec2(
      fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453),
      fract(sin(dot(p, vec2(269.5, 183.3))) * 43758.5453)
    );
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash11(i);
    float b = hash11(i + vec2(1.0, 0.0));
    float c = hash11(i + vec2(0.0, 1.0));
    float d = hash11(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 3; i++) {
      v += a * vnoise(p);
      p *= 2.07; a *= 0.5;
    }
    return v;
  }
  // Voronoi 3x3 — retourne (d1 = distance au centre le plus proche,
  //                         d2 = distance au 2e plus proche).
  // Différence (d2 - d1) est petite près des arêtes → on s'en sert pour
  // illuminer les frontières de cellules ("crystal edges").
  vec2 voronoi(vec2 p) {
    vec2 cell = floor(p);
    vec2 frac = fract(p);
    float d1 = 8.0;
    float d2 = 8.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 nb = vec2(float(i), float(j));
        vec2 site = nb + hash22(cell + nb);
        float d = length(site - frac);
        if (d < d1) { d2 = d1; d1 = d; }
        else if (d < d2) { d2 = d; }
      }
    }
    return vec2(d1, d2);
  }

  void main() {
    float r = length(vWorld);
    float edgeFade = smoothstep(uRadius, uRadius - 60.0, r);

    // Tessellation cristalline. Échelle 0.18 → cellules de ~5.5 unités
    // monde (assez grand pour être lisible vue plongée, assez petit pour
    // remplir l'écran).
    vec2 v = voronoi(vWorld * 0.18);
    float edgeStrength = 1.0 - smoothstep(0.0, 0.08, v.y - v.x);

    // Variation interne aux cellules — bruit doux pour casser l'aspect
    // "couleur unie" entre deux arêtes.
    float interior = fbm(vWorld * 0.04);

    // Aurore boréale : bande FBM qui dérive horizontalement très lentement.
    // Smoothstep "double-edged" → pic centré sur 0.55, chute douce des deux
    // côtés → ondes lumineuses qui semblent serpenter. Pulse sinusoïdal
    // global pour la respiration.
    vec2 auroraDrift = vec2(uTime * 0.025, uTime * 0.045);
    float a1 = fbm(vWorld * 0.018 + auroraDrift);
    float auroraBand = smoothstep(0.40, 0.55, a1) * (1.0 - smoothstep(0.55, 0.72, a1));
    auroraBand *= 0.7 + 0.3 * sin(uTime * 0.5);

    vec3 col = uBase;
    col = mix(col, uMid, interior * 0.45);
    col += uCrystal * edgeStrength * 0.95;
    col += uAurora * auroraBand * 0.55;
    col *= edgeFade;

    // Dithering anti-banding sur les gradients aurore.
    float dither = (hash11(gl_FragCoord.xy + uTime * 60.0) - 0.5) / 255.0;
    col += vec3(dither);
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Version "simple" — Voronoï statique, pas d'aurore animée. Suffisant pour
// la signature visuelle.
const FRAG_SIMPLE_GLACEES = /* glsl */ `
  precision highp float;
  varying vec2 vWorld;
  uniform float uRadius;
  uniform vec3 uBase;
  uniform vec3 uMid;
  uniform vec3 uCrystal;

  float hash11(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  vec2 hash22(vec2 p) {
    return vec2(
      fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453),
      fract(sin(dot(p, vec2(269.5, 183.3))) * 43758.5453)
    );
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash11(i);
    float b = hash11(i + vec2(1.0, 0.0));
    float c = hash11(i + vec2(0.0, 1.0));
    float d = hash11(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  vec2 voronoi(vec2 p) {
    vec2 cell = floor(p);
    vec2 frac = fract(p);
    float d1 = 8.0; float d2 = 8.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 nb = vec2(float(i), float(j));
        vec2 site = nb + hash22(cell + nb);
        float d = length(site - frac);
        if (d < d1) { d2 = d1; d1 = d; }
        else if (d < d2) { d2 = d; }
      }
    }
    return vec2(d1, d2);
  }

  void main() {
    float r = length(vWorld);
    float edgeFade = smoothstep(uRadius, uRadius - 40.0, r);
    vec2 v = voronoi(vWorld * 0.18);
    float edgeStrength = 1.0 - smoothstep(0.0, 0.1, v.y - v.x);
    float interior = vnoise(vWorld * 0.04);
    vec3 col = mix(uBase, uMid, interior * 0.4);
    col += uCrystal * edgeStrength * 0.85;
    col *= edgeFade;
    float dither = (hash11(gl_FragCoord.xy) - 0.5) / 255.0;
    col += vec3(dither);
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Flat — couleur unie + edge fade (Potato Mode).
const FRAG_FLAT_GLACEES = /* glsl */ `
  precision lowp float;
  varying vec2 vWorld;
  uniform float uRadius;
  uniform vec3 uBase;

  void main() {
    float r = length(vWorld);
    float edgeFade = smoothstep(uRadius, uRadius - 30.0, r);
    gl_FragColor = vec4(uBase * edgeFade, 1.0);
  }
`;

function buildGlaceesUniforms(detail: "rich" | "simple" | "flat"): Record<string, THREE.IUniform> {
  const baseCol = new THREE.Color(0x040c1a);              // glace profonde sombre
  const midCol = new THREE.Color(FOG_FROST);
  const crystalCol = new THREE.Color(CRYSTAL_BRIGHT);
  const auroraCol = new THREE.Color(AURORA_GREEN);
  const out: Record<string, THREE.IUniform> = {
    uBase: { value: new THREE.Vector3(baseCol.r, baseCol.g, baseCol.b) },
  };
  if (detail !== "flat") {
    out.uMid = { value: new THREE.Vector3(midCol.r, midCol.g, midCol.b) };
    out.uCrystal = { value: new THREE.Vector3(crystalCol.r, crystalCol.g, crystalCol.b) };
  }
  if (detail === "rich") {
    out.uAurora = { value: new THREE.Vector3(auroraCol.r, auroraCol.g, auroraCol.b) };
  }
  return out;
}

export const PROFONDEURS_GLACEES_THEME: Theme = {
  id: "profondeurs-glacees",
  displayName: "Profondeurs Glacées",
  price: 6000,
  tagline: "Cathédrale gelée, aurores boréales, beauté dangereuse",

  palette: {
    clearColor: NIGHT_DEEP,
    fogColor: FOG_FROST,
    boundary: BOUNDARY_HOT,
    // Joueurs : local en blanc-fantôme + halo cyan vif (focus), remote en
    // bleu-givre + violet aurore (différencié visuellement à 50% zoom).
    playerLocal: { primary: 0xeef6ff, accent: CRYSTAL_BRIGHT, accentDim: 0x2a4870 },
    playerRemote: { primary: 0xc8d8ec, accent: AURORA_VIOLET, accentDim: 0x4a3a7a },
    // Crate : reliquaire de glace bleu profond, pulse cyan, arêtes ambre
    // (le trésor caché dedans).
    crate: { primary: 0x2a4870, emissive: CRYSTAL_BRIGHT, edge: AMBER_PRECIOUS },
    rarityColor: RARITY_COLOR_GLACEES,
    rarityGlowComp: computeRarityGlowComp(RARITY_COLOR_GLACEES),
    powerUpColor: {
      [PowerUpType.Speed]: AURORA_GREEN,        // flow vert aurore
      [PowerUpType.Spin]: CRYSTAL_BRIGHT,       // cyan tournoyant
      [PowerUpType.Magnet]: AURORA_VIOLET,      // violet attracteur
      [PowerUpType.Shield]: 0xeef6ff,           // blanc-fantôme protecteur
      [PowerUpType.Blades]: AMBER_PRECIOUS,     // ambre = bonus précieux
    },
    fx: {
      crateHitSpark: AURORA_GREEN,              // étincelles vertes
      crateDestroyExplosion: AMBER_PRECIOUS,    // boum doré (trésor révélé)
      deathExplosion: BOUNDARY_HOT,             // rouge mort
      clashSpark: AURORA_VIOLET,                // étincelles violettes éthérées
      tierUpHi: AMBER_PRECIOUS,
      tierUpLo: AURORA_GREEN,
      powerUpFallback: CRYSTAL_BRIGHT,
      bladeFallback: ICE_PALE,
    },
  },

  lighting: {
    // Ambient cyan pâle : la lumière polaire baigne tout en bleu-glacé.
    ambient: { color: 0x88b8d8, intensity: 0.45 },
    // Key vert aurore : lumière mystique principale.
    key: { color: AURORA_GREEN, intensity: 0.4 },
    // Rim violet : contre-jour qui découpe les silhouettes.
    rim: { color: AURORA_VIOLET, intensity: 0.32 },
  },

  blades: {
    // Lames de glace : surface vitreuse — shininess intermédiaire entre
    // forge (70 polie) et sanctuaire (30 éthéré). Specular teinté cyan
    // pour cohérence avec l'ambient.
    shininess: 60,
    specularColor: 0x88c8e8,
    emissiveBoost: 1.10,
  },

  // Decor : variant cyber retintée. L'enclume Forge devient un spire de
  // cristal, les cônes deviennent des stalactites, les cubes flottent
  // comme des éclats de glace, les bushes sont des congères avec des
  // cristaux enfouis.
  decor: {
    kind: "cyber",
    shrineCore: CRYSTAL_BRIGHT,       // spire cristal central
    shrineHalo: AURORA_VIOLET,        // halo violet au sol
    obeliskInner: 0x9af0ff,           // stalactites proches (cyan clair)
    obeliskOuter: 0x4080a8,           // stalactites lointaines (bleu sombre)
    cubeColor: AURORA_VIOLET,         // éclats de glace flottants
    bushFoliage: 0x1a3045,            // congères de neige sombre
    bushAccent: CRYSTAL_BRIGHT,       // cristal au cœur des congères
    groundPad: AURORA_GREEN,          // sceaux verts — flaques d'aurore
    ringHint: AURORA_VIOLET,          // anneaux d'évocation violets
  },

  ambient: {
    // Cristaux scintillants en suspension : drift lent (frozen world,
    // pas d'agitation), couleurs froides + 1 touche d'ambre qui passe
    // rarement (chaleur lointaine, mystique).
    wisps: {
      counts: { high: 70, medium: 45, low: 28, ultra: 14 },
      colors: [0xb8e8ff, CRYSTAL_BRIGHT, AURORA_VIOLET, 0xeef6ff, AMBER_PRECIOUS],
      drifSpeedMin: 0.4,    // plus lent que sanctuaire (0.6) — monde gelé
      drifSpeedMax: 0.9,    // plus lent que sanctuaire (1.2) — languissant
    },
  },

  music: {
    lobby: "lobby-glacees.mp3",
    battle: "battle-glacees.mp3",
  },

  ground: {
    fragRich: FRAG_RICH_GLACEES,
    fragSimple: FRAG_SIMPLE_GLACEES,
    fragFlat: FRAG_FLAT_GLACEES,
    buildExtraUniforms: buildGlaceesUniforms,
  },

  ui: {
    accentCool: "#66c4ff",                       // → --cyan (cristal)
    accentWarm: "#ffd49a",                       // → --pink (ambre)
    purple: "#b480ff",                           // → --purple (aurore violet)
    dark: "#081424",                             // → --dark
    panelBg: "rgba(8, 20, 36, 0.85)",            // → --panel
    panelBorder: "rgba(102, 196, 255, 0.35)",    // → --panel-border (cyan)
    fgBright: "#eef6ff",                         // → --fg-bright (ghost white)
    fgMuted: "#8aa8c4",                          // → --fg-muted (frosty muted)
    accentCoolRgb: "102, 196, 255",
    accentWarmRgb: "255, 212, 154",
  },

  // Caméra : équivalente à Forge pour la lisibilité. Le mood "silencieux
  // dangereux" demande d'avoir une bonne vue panoramique sur la map.
  cameraOffset: { x: 0, y: 20, z: 16 },
};
