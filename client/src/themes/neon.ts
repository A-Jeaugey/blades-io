import { BladeRarity, PowerUpType } from "@bladeio/shared";
import { Theme, computeRarityGlowComp } from "./Theme";

// ─────────────────────────────────────────────────────────────────────────────
// Theme : Néon Originel
// L'ambiance cyberpunk d'origine, restaurée à l'identique d'avant le pivot
// vers les thèmes cosmétiques. C'est le thème par défaut, gratuit, donné à
// tous les joueurs.
// ─────────────────────────────────────────────────────────────────────────────

// Raretés dans les familles universelles (tâche 6.3, décision D4 : blanc,
// bleu, violet, or). Épique violet-bleu (tâche 3.8) : le pourpre d'avant
// (0xb14bff), poussé par la compensation de glow, sortait magenta comme le
// rose légendaire. Légendaire en or : le rose d'avant était celui de la
// zone mortelle, des caisses et des autres joueurs.
const RARITY_COLOR_NEON: Record<BladeRarity, number> = {
  [BladeRarity.Common]: 0xffffff,
  [BladeRarity.Rare]: 0x00e5ff,
  [BladeRarity.Epic]: 0x7c5cff,
  [BladeRarity.Legendary]: 0xffc83d,
};

// Grille néon double échelle (4 u et 20 u) qui pulse. Couleurs du sol telles
// qu'affichées en qualité haute avant la tâche 6.3, lignes fines un peu
// moins vives (lisibilité, cf. readability.ts).
const GROUND_COLORS_NEON = {
  base: 0x272b3f,
  grid: 0x1f6878,
  gridMajor: 0x5a3a8a,
};

const FRAG_RICH_NEON = /* glsl */ `
  precision highp float;
  varying vec2 vWorld;
  uniform float uTime;
  uniform float uRadius;
  uniform vec3 uBase;
  uniform vec3 uGrid;
  uniform vec3 uGridMajor;

  float grid(vec2 p, float scale, float width) {
    vec2 g = abs(fract(p / scale - 0.5) - 0.5) / fwidth(p / scale);
    float line = min(g.x, g.y);
    return 1.0 - smoothstep(0.0, width, line);
  }

  void main() {
    float r = length(vWorld);
    float edgeFade = smoothstep(uRadius, uRadius - 60.0, r);
    float g1 = grid(vWorld, 4.0, 1.2);
    float g2 = grid(vWorld, 20.0, 1.4);
    // Pulsation lente des lignes fines.
    float pulse = 0.85 + 0.15 * sin(uTime * 1.5 + r * 0.05);
    vec3 col = mix(uBase, uGrid, g1 * pulse);
    col = mix(col, uGridMajor, g2);
    col *= edgeFade;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const FRAG_SIMPLE_NEON = /* glsl */ `
  precision mediump float;
  varying vec2 vWorld;
  uniform float uRadius;
  uniform vec3 uBase;
  uniform vec3 uGrid;

  float grid(vec2 p, float scale, float width) {
    vec2 f = abs(fract(p / scale - 0.5) - 0.5);
    float d = min(f.x, f.y);
    return 1.0 - smoothstep(0.0, width, d);
  }

  void main() {
    float r = length(vWorld);
    float edgeFade = smoothstep(uRadius, uRadius - 40.0, r);
    float g = grid(vWorld, 20.0, 0.04);
    vec3 col = mix(uBase, uGrid, g);
    col *= edgeFade;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Potato : couleur unie et grille de 20 u, le repère minimal pour sentir
// sa vitesse (tâche 4.7) ; une comparaison par pixel, sans dérivée.
const FRAG_FLAT_NEON = /* glsl */ `
  precision mediump float;
  varying vec2 vWorld;
  uniform float uRadius;
  uniform vec3 uBase;
  uniform vec3 uGrid;

  void main() {
    float r = length(vWorld);
    float edgeFade = smoothstep(uRadius, uRadius - 30.0, r);
    vec2 g = abs(fract(vWorld / 20.0) - 0.5);
    float line = step(0.485, max(g.x, g.y));
    gl_FragColor = vec4(mix(uBase, uGrid, line) * edgeFade, 1.0);
  }
`;

export const NEON_THEME: Theme = {
  id: "neon",
  displayName: "Néon Originel",
  tagline: "Cyberpunk d'origine — gratuit",

  palette: {
    clearColor: 0x05060c,
    fogColor: 0x1a0033,
    boundary: 0xff2ea8,
    playerLocal: { primary: 0xffffff, accent: 0x00e5ff, accentDim: 0x0077aa },
    playerRemote: { primary: 0xffd0e8, accent: 0xff2ea8, accentDim: 0x8a1a5e },
    crate: { primary: 0xff2ea8, emissive: 0xff2ea8, edge: 0x00e5ff },
    rarityColor: RARITY_COLOR_NEON,
    rarityGlowComp: computeRarityGlowComp(RARITY_COLOR_NEON),
    powerUpColor: {
      [PowerUpType.Speed]: 0xffd700,
      [PowerUpType.Spin]: 0x00e5ff,
      [PowerUpType.Magnet]: 0xb14bff,
      [PowerUpType.Shield]: 0xffffff,
      [PowerUpType.Blades]: 0x22ff88,
    },
    fx: {
      crateHitSpark: 0x00e5ff,
      crateDestroyExplosion: 0xff2ea8,
      deathExplosion: 0xff2ea8,
      clashSpark: 0xb14bff,
      tierUpHi: 0xff2ea8,
      tierUpLo: 0x00e5ff,
      powerUpFallback: 0xffffff,
      bladeFallback: 0xffffff,
    },
  },

  lighting: {
    ambient: { color: 0x9ad1ff, intensity: 0.55 },
    key: { color: 0xffffff, intensity: 0.4 },
    rim: { color: 0xff2ea8, intensity: 0.25 },
  },

  blades: {
    shininess: 80,
    specularColor: 0xffffff, // blanc d'origine (reflets durs)
    emissiveBoost: 1.0,
  },

  decor: {
    kind: "cyber",
    shrineCore: 0xff2ea8,
    shrineHalo: 0x00e5ff,
    obeliskInner: 0x00e5ff,
    obeliskOuter: 0xb14bff,
    cubeColor: 0xff2ea8,
    bushFoliage: 0x1a4d2e,
    bushAccent: 0x4ad277,
    groundPad: 0x00e5ff,
    ringHint: 0xff2ea8,
    // Arches violettes, écrans cyan, LED vertes : pas de rose, celui du mur.
    baseDark: 0x111122,
    structureNeon: 0xb14bff,
    structureScreen: 0x00e5ff,
    structureLed: 0x4ad277,
  },

  ambient: {
    // Pas de wisps pour le neon : l'ambiance cyberpunk d'origine n'en avait
    // pas et ça matche la grille géométrique froide.
    wisps: null,
  },

  music: {
    lobby: "lobby-neon.mp3",
    battle: "battle-neon.mp3",
  },

  ground: {
    fragRich: FRAG_RICH_NEON,
    fragSimple: FRAG_SIMPLE_NEON,
    fragFlat: FRAG_FLAT_NEON,
    colors: GROUND_COLORS_NEON,
  },

  ui: {
    accentCool: "#00e5ff",
    accentWarm: "#ff2ea8",
    purple: "#b14bff",
    dark: "#05060c",
    panelBg: "rgba(10, 12, 24, 0.82)",
    panelBorder: "rgba(0, 229, 255, 0.35)",
    fgBright: "#e8f7ff",
    fgMuted: "#89bacf",
    accentCoolRgb: "0, 229, 255",
    accentWarmRgb: "255, 46, 168",
  },
};
