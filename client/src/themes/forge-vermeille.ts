import * as THREE from "three";
import { BladeRarity, PowerUpType } from "@bladeio/shared";
import { Theme, computeRarityGlowComp } from "./Theme";

// ─────────────────────────────────────────────────────────────────────────────
// Theme : Forge Vermeille
// Identité : forge volcanique, fissures de lave, charbon ardent, fumée. Mood
// agressif et intense — l'opposé chromatique du Sanctuaire (chaud dominant
// vs cool dominant). Premier thème "warm" de la roue élémentaire prévue
// (tech / spirit / feu / glace).
// ─────────────────────────────────────────────────────────────────────────────

// Palette structurelle (5 couleurs principales) :
const COAL_DEEP = 0x1a0a06;        // pierre charbon — fond du renderer
const SMOKE_MID = 0x3d1a14;        // fumée crimson — brouillard mid
const LAVA_BRIGHT = 0xff5e2e;      // fissures de lave — l'accent saturé
const EMBER_GOLD = 0xffba4a;       // braise dorée — accents chauds
const WHITE_HOT = 0xfff5d4;        // métal blanc-chaud — la rareté max
const IRON_RED = 0xc44a2e;         // fer rouge — couleur "froide" de la palette
const BOUNDARY_RED = 0xff2a0f;     // mur de mort — rouge brutal saturé

const RARITY_COLOR_FORGE: Record<BladeRarity, number> = {
  // Logique : dans une forge, la chaleur = la valeur. Le fer rouge sombre
  // est commun (slag), le métal blanc-chaud est précieux (forgé à point).
  [BladeRarity.Common]: IRON_RED,
  [BladeRarity.Rare]: 0xff8a3e,        // ember orange
  [BladeRarity.Epic]: EMBER_GOLD,
  [BladeRarity.Legendary]: WHITE_HOT,  // contraste max dans la palette chaude
};

// Lava ground shader — fissures lumineuses dans la pierre + mares de magma
// + braises pulsantes. La signature visuelle du thème.
const FRAG_RICH_FORGE = /* glsl */ `
  precision highp float;
  varying vec2 vWorld;
  uniform float uTime;
  uniform float uRadius;
  uniform vec3 uBase;     // pierre charbon sombre
  uniform vec3 uCrack;    // lave brillante dans les fissures
  uniform vec3 uPool;     // magma chaud dans les mares
  uniform vec3 uEmber;    // braises dorées qui pulsent

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  // FBM 4 octaves : rocher est plus "fracturé" que la brume du sanctuaire,
  // donc on ajoute une octave pour des cassures à plus haute fréquence.
  float fbm(vec2 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * vnoise(p);
      p *= 2.13; a *= 0.5;
    }
    return v;
  }

  void main() {
    float r = length(vWorld);
    float edgeFade = smoothstep(uRadius, uRadius - 60.0, r);

    // Drift très lent — la lave bouge à peine, on n'est pas dans la brume.
    vec2 drift = vec2(uTime * 0.012, uTime * 0.008);

    // Fissures de lave : bandes étroites où le FBM passe par 0.5. L'effet
    // "smoothstep up - smoothstep down" donne un pic narrow centré sur 0.5
    // → fissures lumineuses qui se ramifient comme des éclairs gelés.
    float crackBase = fbm(vWorld * 0.05 + drift);
    float crackBand = smoothstep(0.43, 0.50, crackBase) - smoothstep(0.50, 0.57, crackBase);
    crackBand *= 1.6;

    // Mares de magma : où le FBM est élevé, glow stable + pulse subtil.
    float poolField = fbm(vWorld * 0.022 - drift * 0.6);
    float pool = smoothstep(0.62, 0.85, poolField) * (0.85 + 0.15 * sin(uTime * 0.4 + r * 0.06));

    // Braises : taches lumineuses fines qui pulsent rapidement, donnent
    // l'impression que la pierre respire.
    float emberField = fbm(vWorld * 0.11 + vec2(uTime * 0.06, -uTime * 0.04));
    float embers = smoothstep(0.72, 0.92, emberField) * (0.5 + 0.5 * sin(uTime * 1.8 + r * 0.2));

    vec3 col = uBase;
    col += uPool * pool * 0.7;
    col += uCrack * crackBand;
    col += uEmber * embers * 0.85;
    col *= edgeFade;

    // Dithering anti-banding (cf. CLAUDE.md, obligatoire sur les thèmes
    // avec gradients étendus).
    float dither = (hash(gl_FragCoord.xy + uTime * 60.0) - 0.5) / 255.0;
    col += vec3(dither);
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Version "simple" — fissures statiques + base seulement, pas de pools ni
// d'embers animés. Cible Iris Xe / Apple M1 / GPU mobiles.
const FRAG_SIMPLE_FORGE = /* glsl */ `
  precision highp float;
  varying vec2 vWorld;
  uniform float uRadius;
  uniform vec3 uBase;
  uniform vec3 uCrack;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  void main() {
    float r = length(vWorld);
    float edgeFade = smoothstep(uRadius, uRadius - 40.0, r);
    float crackBase = vnoise(vWorld * 0.05) * 0.6 + vnoise(vWorld * 0.1) * 0.4;
    float crackBand = smoothstep(0.45, 0.5, crackBase) - smoothstep(0.5, 0.55, crackBase);
    crackBand *= 1.4;
    vec3 col = uBase + uCrack * crackBand;
    col *= edgeFade;
    float dither = (hash(gl_FragCoord.xy) - 0.5) / 255.0;
    col += vec3(dither);
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Flat — couleur unie + edge fade (Potato Mode).
const FRAG_FLAT_FORGE = /* glsl */ `
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

function buildForgeUniforms(detail: "rich" | "simple" | "flat"): Record<string, THREE.IUniform> {
  const baseCol = new THREE.Color(0x0a0606);     // charbon profond
  const crackCol = new THREE.Color(LAVA_BRIGHT);
  const poolCol = new THREE.Color(IRON_RED);
  const emberCol = new THREE.Color(EMBER_GOLD);
  const out: Record<string, THREE.IUniform> = {
    uBase: { value: new THREE.Vector3(baseCol.r, baseCol.g, baseCol.b) },
  };
  if (detail !== "flat") {
    out.uCrack = { value: new THREE.Vector3(crackCol.r, crackCol.g, crackCol.b) };
  }
  if (detail === "rich") {
    out.uPool = { value: new THREE.Vector3(poolCol.r, poolCol.g, poolCol.b) };
    out.uEmber = { value: new THREE.Vector3(emberCol.r, emberCol.g, emberCol.b) };
  }
  return out;
}

export const FORGE_VERMEILLE_THEME: Theme = {
  id: "forge-vermeille",
  displayName: "Forge Vermeille",
  price: 350,
  tagline: "Volcan ardent, fissures de lave, agression dorée",

  palette: {
    clearColor: COAL_DEEP,
    fogColor: SMOKE_MID,
    boundary: BOUNDARY_RED,
    // Joueurs : local en or chaud (stand out), remote en rouge fer plus
    // sombre. La distinction reste très lisible malgré la palette warm.
    playerLocal: { primary: WHITE_HOT, accent: EMBER_GOLD, accentDim: 0x6e3a14 },
    playerRemote: { primary: 0xe8c8a0, accent: 0xff8a3e, accentDim: 0x4a1f0a },
    // Crate : enclume rouge avec arêtes dorées (objet précieux à briser).
    crate: { primary: IRON_RED, emissive: LAVA_BRIGHT, edge: EMBER_GOLD },
    rarityColor: RARITY_COLOR_FORGE,
    rarityGlowComp: computeRarityGlowComp(RARITY_COLOR_FORGE),
    powerUpColor: {
      [PowerUpType.Speed]: 0xff8a3e,    // ember (vitesse = élan ardent)
      [PowerUpType.Spin]: BOUNDARY_RED, // hot red rage
      [PowerUpType.Magnet]: EMBER_GOLD, // or (avarice)
      [PowerUpType.Shield]: WHITE_HOT,  // métal blanc-chaud (protection)
      [PowerUpType.Blades]: IRON_RED,   // fer rouge (matériau de guerre)
    },
    fx: {
      crateHitSpark: EMBER_GOLD,
      crateDestroyExplosion: LAVA_BRIGHT,
      deathExplosion: BOUNDARY_RED,
      clashSpark: EMBER_GOLD,            // étincelles dorées de forge !
      tierUpHi: WHITE_HOT,
      tierUpLo: 0xff8a3e,
      powerUpFallback: 0xff8a3e,
      bladeFallback: 0xff8a3e,
    },
  },

  lighting: {
    // Ambient orange-rouge : la lave illumine tout l'environnement, baigne
    // les matériaux PBR dans une teinte chaude.
    ambient: { color: LAVA_BRIGHT, intensity: 0.5 },
    // Key gold : "soleil" doré chaud du forgeron.
    key: { color: EMBER_GOLD, intensity: 0.45 },
    // Rim red : contre-jour rouge sombre qui découpe les silhouettes côté opposé.
    rim: { color: IRON_RED, intensity: 0.35 },
  },

  blades: {
    // Lames de forge : poli métal (plus brillant que sanctuaire) avec
    // emissive boostée — le métal forgé glow quand il sort de l'enclume.
    shininess: 70,
    specularColor: 0xff8a3e, // teinte ember sur les highlights
    emissiveBoost: 1.25,
  },

  // Decor : on réutilise la variant cyber retintée — le pilier devient
  // l'enclume centrale, les cônes deviennent des piliers de fer, les cubes
  // flottants des chunks de braise, les bushes des tas de charbon ardent.
  decor: {
    kind: "cyber",
    shrineCore: LAVA_BRIGHT,    // enclume centrale brillante
    shrineHalo: EMBER_GOLD,     // halo doré au sol autour
    obeliskInner: 0xff8a3e,     // piliers proches (chauds)
    obeliskOuter: IRON_RED,     // piliers extérieurs (rouge sombre)
    cubeColor: 0xff8a3e,        // chunks de braise flottants
    bushFoliage: 0x2a0f0a,      // tas de charbon (brun très sombre)
    bushAccent: LAVA_BRIGHT,    // braises rougeoyantes au cœur des tas
    groundPad: 0xff8a3e,        // sceaux orange — coulures de magma
    ringHint: IRON_RED,         // anneaux rouge sombre
  },

  ambient: {
    // Étincelles flottantes (réutilise le système wisps avec couleurs warm).
    // Counts modérés pour ne pas saturer un visuel déjà chargé.
    wisps: {
      counts: { high: 60, medium: 40, low: 25, ultra: 12 },
      colors: [EMBER_GOLD, 0xff8a3e, WHITE_HOT],
      drifSpeedMin: 0.8,        // un peu plus rapide que sanctuaire
      drifSpeedMax: 1.5,        // — la forge est agitée, pas contemplative
    },
  },

  music: {
    lobby: "lobby-forge.mp3",
    battle: "battle-forge.mp3",
  },

  ground: {
    fragRich: FRAG_RICH_FORGE,
    fragSimple: FRAG_SIMPLE_FORGE,
    fragFlat: FRAG_FLAT_FORGE,
    buildExtraUniforms: buildForgeUniforms,
  },

  ui: {
    // Variables CSS injectées au boot. Rouge sombre + or + braise.
    accentCool: "#ff8a3e",                       // → --cyan (ember orange)
    accentWarm: "#ffba4a",                       // → --pink (gold)
    purple: "#ff5e2e",                           // → --purple (lava bright)
    dark: "#1a0a06",                             // → --dark
    panelBg: "rgba(26, 10, 6, 0.85)",            // → --panel
    panelBorder: "rgba(255, 138, 62, 0.35)",     // → --panel-border (ember)
    fgBright: "#fff5d4",                         // → --fg-bright (white-hot)
    fgMuted: "#c89976",                          // → --fg-muted (warm beige)
    accentCoolRgb: "255, 138, 62",               // ember pour les box-shadow / glow
    accentWarmRgb: "255, 186, 74",               // gold pour les hover / accents
  },

  // Caméra légèrement plus plongée que sanctuaire : la forge est un thème
  // de combat intense, on privilégie la lisibilité tactique.
  cameraOffset: { x: 0, y: 21, z: 16 },
};
