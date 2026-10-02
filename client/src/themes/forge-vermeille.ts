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
const LAVA_BRIGHT = 0xff5e2e;      // lave vive — décor, caisses, éclats
const EMBER_GOLD = 0xffba4a;       // braise dorée — accents chauds
const WHITE_HOT = 0xfff5d4;        // métal blanc-chaud — joueur, bouclier
const IRON_RED = 0xc44a2e;         // fer rouge — couleur "froide" de la palette
const BOUNDARY_RED = 0xff2a0f;     // mur de mort — rouge brutal saturé

// Raretés (tâche 6.3) : les couleurs de revenu de l'acier, dans les familles
// universelles (blanc, bleu, violet, or). Avant, fer rouge, orange, or et
// blanc-chaud : les teintes de la lave du sol, où les lames disparaissaient
// (audit, GFX-02).
const RARITY_COLOR_FORGE: Record<BladeRarity, number> = {
  [BladeRarity.Common]: 0xe8e2da,      // acier poli
  [BladeRarity.Rare]: 0x4f9dff,        // revenu bleu
  [BladeRarity.Epic]: 0xa46bff,        // revenu violet
  [BladeRarity.Legendary]: 0xffc94a,   // paille dorée, forgé à point
};

// Sol (tâche 6.3) : basalte sombre, veines de lave fines et sourdes, mares de
// magma profondes. Avant, la lave couvrait la moitié du sol en orange vif
// (luminance moyenne 0,11 en qualité haute).
const GROUND_COLORS_FORGE = {
  base: 0x120a08,     // basalte
  rock: 0x2a1610,     // strates
  crack: 0xa0400f,    // cœur des veines de lave (orangé : loin du rouge de danger)
  pool: 0x4a1408,     // magma profond
  ember: 0x9a4a14,    // braises
};

// Basalte en strates, veines de lave, mares de magma et braises qui pulsent.
const FRAG_RICH_FORGE = /* glsl */ `
  precision highp float;
  varying vec2 vWorld;
  uniform float uTime;
  uniform float uRadius;
  uniform vec3 uBase;
  uniform vec3 uRock;
  uniform vec3 uCrack;
  uniform vec3 uPool;
  uniform vec3 uEmber;

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

    // Drift très lent — la lave bouge à peine + parallax du joueur doit
    // dominer. Drift × 0.5 vs version précédente.
    vec2 drift = vec2(uTime * 0.006, uTime * 0.004);

    // ─── 1. Stone strates (cell-shaded bands de pierre charbon) ───
    // Au lieu d'un sol uniforme, on stratifie la pierre en 4 niveaux de
    // luminosité → rendu peint stylisé. Soft-quantize pour éviter le
    // crawl d'arêtes dures à 1 pixel.
    float stoneRaw = fbm(vWorld * 0.018);
    float stoneScaled = stoneRaw * 4.0;
    float stoneFloor = floor(stoneScaled);
    float stoneFract = fract(stoneScaled);
    float stoneBands = (stoneFloor + smoothstep(0.7, 1.0, stoneFract)) / 4.0;

    // Edge contours entre strates : fines lignes orange sombre qui
    // soulignent les "couches" géologiques.
    float stoneEdge = 1.0 - smoothstep(0.0, 0.08, abs(stoneFract - 1.0));
    stoneEdge = clamp(stoneEdge, 0.0, 1.0);

    // ─── 2. Veines de lave ───
    // Pic étroit autour de 0.5 (smoothstep montant moins descendant) : des
    // fissures fines qui se ramifient, cœur vif et halo sombre autour. Plus
    // larges, la lave couvrait le sol.
    float crackBase = fbm(vWorld * 0.05 + drift);
    float crackCore = smoothstep(0.485, 0.50, crackBase) - smoothstep(0.50, 0.515, crackBase);
    float crackGlow = smoothstep(0.44, 0.50, crackBase) - smoothstep(0.50, 0.56, crackBase);

    // ─── 3. Mares de magma ───
    // Cœur à seuil serré + halo doux : des flaques distinctes, figées, qui
    // pulsent à peine.
    float poolField = fbm(vWorld * 0.022 - drift * 0.6);
    float poolCore = smoothstep(0.7, 0.75, poolField);
    float poolHalo = smoothstep(0.62, 0.7, poolField) * 0.4;
    float pool = min(1.0, poolCore + poolHalo) * (0.85 + 0.15 * sin(uTime * 0.4 + r * 0.06));

    // ─── 4. Braises (haute fréquence, quasi fixes, pulsent en intensité) ───
    vec2 emberPos = vWorld * 0.11 + drift * 1.0;
    float emberField = fbm(emberPos);
    float embers = smoothstep(0.8, 0.86, emberField) * (0.5 + 0.5 * sin(uTime * 1.8 + r * 0.2));

    // Composition par mélanges seulement (contrat du sol, readability.ts).
    vec3 col = mix(uBase, uRock, stoneBands * 0.6);           // strates
    col = mix(col, uCrack, stoneEdge * 0.3);                  // contours des strates
    col = mix(col, uPool, pool);                              // mares
    col = mix(col, uPool, crackGlow * 0.8);                   // halo des veines
    col = mix(col, uCrack, crackCore);                        // cœur des veines
    col = mix(col, uEmber, embers);                           // braises
    col *= edgeFade;
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
  uniform vec3 uPool;

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
    float crackCore = smoothstep(0.485, 0.5, crackBase) - smoothstep(0.5, 0.515, crackBase);
    float crackGlow = smoothstep(0.44, 0.5, crackBase) - smoothstep(0.5, 0.56, crackBase);
    vec3 col = mix(uBase, uPool, crackGlow * 0.8);
    col = mix(col, uCrack, crackCore);
    col *= edgeFade;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Flat — couleur unie + edge fade (Potato Mode).
// Potato : couleur unie et grille de 20 u, le repère minimal pour sentir
// sa vitesse (tâche 4.7) ; une comparaison par pixel, sans dérivée.
const FRAG_FLAT_FORGE = /* glsl */ `
  precision mediump float;
  varying vec2 vWorld;
  uniform float uRadius;
  uniform vec3 uBase;
  uniform vec3 uRock;

  void main() {
    float r = length(vWorld);
    float edgeFade = smoothstep(uRadius, uRadius - 30.0, r);
    vec2 g = abs(fract(vWorld / 20.0) - 0.5);
    float line = step(0.485, max(g.x, g.y));
    gl_FragColor = vec4(mix(uBase, uRock, line) * edgeFade, 1.0);
  }
`;

export const FORGE_VERMEILLE_THEME: Theme = {
  id: "forge-vermeille",
  displayName: "Forge Vermeille",
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
    baseDark: 0x1a0d08,         // fer noirci
    structureNeon: EMBER_GOLD,  // arches et pylônes chauffés à blanc doré (pas le rouge du mur)
    structureScreen: 0xff8a3e,  // écrans de braise
    structureLed: LAVA_BRIGHT,  // voyants de lave
  },

  ambient: {
    // Étincelles flottantes (réutilise le système wisps avec couleurs warm).
    // Counts modérés pour ne pas saturer un visuel déjà chargé.
    wisps: {
      counts: { high: 60, medium: 40, low: 25, ultra: 12 },
      // Étincelles orange et rouges : l'or et le blanc-chaud d'avant étaient
      // ceux des lames légendaires et communes (tâche 6.3).
      colors: [0xff8a3e, LAVA_BRIGHT, 0xff6a1f],
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
    colors: GROUND_COLORS_FORGE,
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
};
