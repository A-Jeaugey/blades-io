import * as THREE from "three";
import { BladeRarity, PowerUpType } from "@bladeio/shared";
import { Theme, computeRarityGlowComp } from "./Theme";

// ─────────────────────────────────────────────────────────────────────────────
// Theme : Sanctuaire des Esprits
// Mix mystique : violet profond + rose poudré + or sacré + crème lunaire.
// Décor en bosquets de champignons + lanternes 3 couches + brume mauve
// organique. Premier thème cosmétique, débloqué via la boutique.
// ─────────────────────────────────────────────────────────────────────────────

const NIGHT_DEEP = 0x0e0820;
const FOG_MID = 0x2a1f4a;
const GROUND_BASE = 0x140a26;
const GROUND_MID = 0x2a1d4a;
const GROUND_HIGHLIGHT = 0xe8d4f0;
const SACRED_GOLD = 0xf4d471;
const SHRINE_PRIMARY = 0xa685f4;
const SHRINE_ACCENT = 0xd8a4e8;
const MUSHROOM_GLOW = 0xa4f0d4;
const GROVE_FOLIAGE = 0x3a2a5a;
const GROVE_ACCENT = 0xc9a4ff;
const BOUNDARY = 0xff5d8a;

const RARITY_COLOR_SANCT: Record<BladeRarity, number> = {
  [BladeRarity.Common]: 0xf0e4f5,
  [BladeRarity.Rare]: 0xd8a4e8,
  [BladeRarity.Epic]: 0x9d7dff,
  [BladeRarity.Legendary]: 0xf4d471,
};

// Brume mauve organique (FBM) + wisps + cercles rituels diffus.
const FRAG_RICH_SANCT = /* glsl */ `
  precision highp float;
  varying vec2 vWorld;
  uniform float uTime;
  uniform float uRadius;
  uniform vec3 uBase;
  uniform vec3 uMid;
  uniform vec3 uHighlight;
  uniform vec3 uSacred;

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
  float fbm(vec2 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 3; i++) {
      v += a * vnoise(p);
      p *= 2.07; a *= 0.5;
    }
    return v;
  }

  void main() {
    float r = length(vWorld);
    float edgeFade = smoothstep(uRadius, uRadius - 60.0, r);
    // Drift global ralenti (×0.5 vs précédent) — quand le joueur bouge,
    // la motion de parallax doit DOMINER vs la motion intrinsèque du sol.
    // Sinon le sol "swim" sous nous (deux sources de mouvement qui se
    // contrarient).
    vec2 drift = vec2(uTime * 0.012, uTime * 0.009);

    // ─── 1. Brume de fond (FBM smooth, large échelle) ───
    float mistDeep = fbm(vWorld * 0.012 - drift * 0.6);

    // ─── 2. Bandes "soft-quantifiées" ───
    // Avant : floor(noise * 5) / 5 donnait des arêtes 1-pixel dures qui
    // rampent visiblement quand le joueur se déplace (chaque pixel
    // traverse les seuils → "scrolling lines" perçus comme sol qui bouge).
    // Maintenant : smoothstep entre niveaux → transitions de ~5 pixels
    // de large, perceptibles comme bandes mais sans aliasing crawl.
    float bandsRaw = fbm(vWorld * 0.025 + drift);
    float scaled = bandsRaw * 5.0;
    float bandFloor = floor(scaled);
    float bandFract = fract(scaled);
    float bands = (bandFloor + smoothstep(0.7, 1.0, bandFract)) / 5.0;

    // ─── 3. Edge contours (renforcés vs précédent) ───
    // Bandes moins contrastées → on compense en boostant les contours pour
    // garder le look "topo map / hand-painted" sans le "color blocks moving".
    float bandEdge = 1.0 - smoothstep(0.0, 0.08, abs(bandFract - 1.0));
    bandEdge = clamp(bandEdge, 0.0, 1.0);

    // ─── 4. Dust motes (drift très ralenti) ───
    // Avant : drift * 6.0 → motes glissent vite en world-space, perçues
    // comme "sable qui coule" quand on bouge. Maintenant drift * 1.0 →
    // motes quasi-fixes en world, ne concurrencent plus la parallax du
    // joueur.
    vec2 motePos = vWorld * 0.45 + drift * 1.0;
    float moteField = vnoise(motePos);
    float motesScint = 0.7 + 0.3 * sin(uTime * 1.2 + moteField * 12.0);
    float motes = smoothstep(0.84, 0.88, moteField) * motesScint;

    // ─── 5. Cercles rituels ───
    float rings = 0.5 + 0.5 * sin(r * 0.18 - uTime * 0.4);
    rings = pow(rings, 8.0) * 0.12;

    // Composition : bandes plus discrètes (0.55→0.32), edges plus marqués
    // (0.18→0.32). L'œil voit la structure via les contours fins, pas via
    // des grands blocs colorés qui bougent.
    vec3 col = uBase;
    col = mix(col, uMid, mistDeep * 0.7);
    col = mix(col, uMid * 1.35, bands * 0.32);
    col += uHighlight * bandEdge * 0.32;
    col += uHighlight * motes * 0.85;
    col += uSacred * rings;

    col *= edgeFade;
    float dither = (hash(gl_FragCoord.xy + uTime * 60.0) - 0.5) / 255.0;
    col += vec3(dither);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const FRAG_SIMPLE_SANCT = /* glsl */ `
  precision highp float;
  varying vec2 vWorld;
  uniform float uRadius;
  uniform vec3 uBase;
  uniform vec3 uMid;
  uniform vec3 uSacred;

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
    float mist = vnoise(vWorld * 0.025) * 0.6 + vnoise(vWorld * 0.05) * 0.4;
    float rings = 0.5 + 0.5 * sin(r * 0.18);
    rings = pow(rings, 8.0) * 0.1;
    vec3 col = mix(uBase, uMid, mist);
    col += uSacred * rings;
    col *= edgeFade;
    float dither = (hash(gl_FragCoord.xy) - 0.5) / 255.0;
    col += vec3(dither);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const FRAG_FLAT_SANCT = /* glsl */ `
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

function buildSanctuaireUniforms(detail: "rich" | "simple" | "flat"): Record<string, THREE.IUniform> {
  const baseCol = new THREE.Color(GROUND_BASE);
  const midCol = new THREE.Color(GROUND_MID);
  const highlightCol = new THREE.Color(GROUND_HIGHLIGHT);
  const sacredCol = new THREE.Color(SACRED_GOLD);
  const out: Record<string, THREE.IUniform> = {
    uBase: { value: new THREE.Vector3(baseCol.r, baseCol.g, baseCol.b) },
  };
  if (detail !== "flat") {
    out.uMid = { value: new THREE.Vector3(midCol.r, midCol.g, midCol.b) };
    out.uSacred = { value: new THREE.Vector3(sacredCol.r, sacredCol.g, sacredCol.b) };
  }
  if (detail === "rich") {
    out.uHighlight = { value: new THREE.Vector3(highlightCol.r, highlightCol.g, highlightCol.b) };
  }
  return out;
}

export const SANCTUAIRE_THEME: Theme = {
  id: "sanctuaire",
  displayName: "Sanctuaire des Esprits",
  price: 1500,
  tagline: "Mystic mauve, lanternes flottantes, brume féérique",

  palette: {
    clearColor: NIGHT_DEEP,
    fogColor: FOG_MID,
    boundary: BOUNDARY,
    playerLocal: { primary: 0xf5e8d8, accent: SHRINE_ACCENT, accentDim: 0x6e4d8a },
    playerRemote: { primary: 0xe8d4e0, accent: 0xa685f4, accentDim: 0x4a2f7a },
    crate: { primary: SHRINE_PRIMARY, emissive: SHRINE_ACCENT, edge: SACRED_GOLD },
    rarityColor: RARITY_COLOR_SANCT,
    rarityGlowComp: computeRarityGlowComp(RARITY_COLOR_SANCT),
    powerUpColor: {
      [PowerUpType.Speed]: 0xf9c74f,
      [PowerUpType.Spin]: 0x9d7dff,
      [PowerUpType.Magnet]: 0xff8eb5,
      [PowerUpType.Shield]: 0xf5e8d8,
      [PowerUpType.Blades]: 0xa4f0d4,
    },
    fx: {
      crateHitSpark: SHRINE_ACCENT,
      crateDestroyExplosion: SACRED_GOLD,
      deathExplosion: BOUNDARY,
      clashSpark: SHRINE_PRIMARY,
      tierUpHi: SACRED_GOLD,
      tierUpLo: SHRINE_ACCENT,
      powerUpFallback: 0xf5e8d8,
      bladeFallback: 0xf5e8d8,
    },
  },

  lighting: {
    // Clair de lune mauve doux.
    ambient: { color: 0xb4a4d8, intensity: 0.55 },
    key: { color: 0xf5e8d8, intensity: 0.4 },
    rim: { color: SHRINE_ACCENT, intensity: 0.3 },
  },

  blades: {
    shininess: 30,
    specularColor: 0x4a3a6e, // teinte mauve sur les highlights
    emissiveBoost: 1.15,
  },

  decor: {
    kind: "spirit",
    shrineCore: SACRED_GOLD,
    shrineHalo: SHRINE_ACCENT,
    obeliskInner: MUSHROOM_GLOW,
    obeliskOuter: SHRINE_PRIMARY,
    lanternCoreColor: 0xfff2c4,
    lanternEmissive: SACRED_GOLD,
    lanternCage: SACRED_GOLD,
    lanternHalo: SACRED_GOLD,
    mushroomStem: 0xe8d4f0,
    mushroomCap: GROVE_ACCENT,
    mushroomUnderglow: 0xffb4e0,
    mossColor: GROVE_FOLIAGE,
    groundPad: MUSHROOM_GLOW,
    ringHint: SHRINE_ACCENT,
  },

  ambient: {
    wisps: {
      counts: { high: 80, medium: 50, low: 30, ultra: 18 },
      colors: [0xf5e8d8, 0xf5e8d8, 0xf5e8d8, SHRINE_ACCENT, MUSHROOM_GLOW],
      drifSpeedMin: 0.6,
      drifSpeedMax: 1.2,
    },
  },

  music: {
    // Placeholders : à remplacer quand les Suno auront généré les .mp3.
    // Tant que les fichiers n'existent pas, le SoundManager fallback sur
    // les tracks neon (cf. wiring dans audio/SoundManager.ts).
    lobby: "lobby-sanctuaire.mp3",
    battle: "battle-sanctuaire.mp3",
  },

  ground: {
    fragRich: FRAG_RICH_SANCT,
    fragSimple: FRAG_SIMPLE_SANCT,
    fragFlat: FRAG_FLAT_SANCT,
    buildExtraUniforms: buildSanctuaireUniforms,
  },

  ui: {
    accentCool: "#d8a4e8",
    accentWarm: "#f4d471",
    purple: "#9d7dff",
    dark: "#0e0820",
    panelBg: "rgba(20, 10, 38, 0.82)",
    panelBorder: "rgba(216, 164, 232, 0.35)",
    fgBright: "#f5e8d8",
    fgMuted: "#b4a4d8",
    accentCoolRgb: "216, 164, 232",
    accentWarmRgb: "244, 212, 113",
  },

  cameraOffset: { x: 0, y: 19, z: 17 },
};
