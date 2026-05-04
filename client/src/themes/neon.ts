import { BladeRarity, PowerUpType } from "@bladeio/shared";
import { Theme, computeRarityGlowComp } from "./Theme";

// ─────────────────────────────────────────────────────────────────────────────
// Theme : Néon Originel
// L'ambiance cyberpunk d'origine, restaurée à l'identique d'avant le pivot
// vers les thèmes cosmétiques. C'est le thème par défaut, gratuit, donné à
// tous les joueurs.
// ─────────────────────────────────────────────────────────────────────────────

const RARITY_COLOR_NEON: Record<BladeRarity, number> = {
  [BladeRarity.Common]: 0xffffff,
  [BladeRarity.Rare]: 0x00e5ff,
  [BladeRarity.Epic]: 0xb14bff,
  [BladeRarity.Legendary]: 0xff2ea8,
};

// Grid shader d'origine : grille néon double échelle (4u + 20u) avec pulse.
const FRAG_RICH_NEON = /* glsl */ `
  precision highp float;
  varying vec2 vWorld;
  uniform float uTime;
  uniform float uRadius;

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
    float pulse = 0.85 + 0.15 * sin(uTime * 1.5 + r * 0.05);
    vec3 base = vec3(0.02, 0.024, 0.05);
    vec3 minor = vec3(0.0, 0.8, 1.0) * 0.22;
    vec3 major = vec3(0.4, 0.1, 0.9) * 0.4;
    vec3 col = base + g1 * minor * pulse + g2 * major;
    col *= edgeFade;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const FRAG_SIMPLE_NEON = /* glsl */ `
  precision mediump float;
  varying vec2 vWorld;
  uniform float uRadius;

  float grid(vec2 p, float scale, float width) {
    vec2 f = abs(fract(p / scale - 0.5) - 0.5);
    float d = min(f.x, f.y);
    return 1.0 - smoothstep(0.0, width, d);
  }

  void main() {
    float r = length(vWorld);
    float edgeFade = smoothstep(uRadius, uRadius - 40.0, r);
    float g = grid(vWorld, 20.0, 0.04);
    vec3 base = vec3(0.02, 0.024, 0.05);
    vec3 line = vec3(0.0, 0.65, 0.9) * 0.25;
    vec3 col = base + g * line;
    col *= edgeFade;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const FRAG_FLAT_NEON = /* glsl */ `
  precision lowp float;
  varying vec2 vWorld;
  uniform float uRadius;

  void main() {
    float r = length(vWorld);
    float edgeFade = smoothstep(uRadius, uRadius - 30.0, r);
    vec3 base = vec3(0.04, 0.05, 0.10);
    gl_FragColor = vec4(base * edgeFade, 1.0);
  }
`;

export const NEON_THEME: Theme = {
  id: "neon",
  displayName: "Néon Originel",
  price: 0, // gratuit, donné à tous les joueurs au boot
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
    buildExtraUniforms: () => ({}), // Pas d'uniforms custom — couleurs baked.
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

  cameraOffset: { x: 0, y: 22, z: 16 },
};
