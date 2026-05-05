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
    vec2 drift = vec2(uTime * 0.025, uTime * 0.018);

    // ─── 1. Brume de fond (FBM smooth, large échelle) ───
    // Garde le gradient mauve organique pour la profondeur. C'est
    // l'élément qui donne le "monde des esprits", on ne touche pas.
    float mistDeep = fbm(vWorld * 0.012 - drift * 0.6);

    // ─── 2. Bandes quantifiées (cell-shading) ───
    // Au lieu d'un dégradé continu, on quantifie le bruit en 5 niveaux
    // discrets → bandes de couleur avec des transitions FRANCHES. Donne
    // l'aspect "stylisé peinture" plutôt que "blur uniforme".
    float bandsRaw = fbm(vWorld * 0.025 + drift);
    float bands = floor(bandsRaw * 5.0) / 5.0;

    // ─── 3. Edge contours entre bandes ───
    // Détecte les frontières entre deux niveaux de bands → fines lignes
    // lumineuses qui soulignent la silhouette de chaque "couche" de
    // brume. Look topo map / hand-painted.
    float bandFract = fract(bandsRaw * 5.0);
    float bandEdge = 1.0 - smoothstep(0.0, 0.06, abs(bandFract - 0.0));
    bandEdge += 1.0 - smoothstep(0.0, 0.06, abs(bandFract - 1.0));
    bandEdge = clamp(bandEdge * 0.8, 0.0, 1.0);

    // ─── 4. Dust motes (haute fréquence, points discrets) ───
    // Avant : un seul wispField smoothstep → grosses taches floues. Maintenant
    // un bruit haute fréquence threshold serré → multitude de petits points
    // brillants comme des lucioles ou de la poussière magique. Sharp edges,
    // ne baveent pas avec le bloom.
    vec2 motePos = vWorld * 0.45 + drift * 6.0;
    float moteField = vnoise(motePos);
    float motesScint = 0.7 + 0.3 * sin(uTime * 1.2 + moteField * 12.0);
    float motes = smoothstep(0.84, 0.88, moteField) * motesScint;

    // ─── 5. Cercles rituels (déjà discrets) ───
    float rings = 0.5 + 0.5 * sin(r * 0.18 - uTime * 0.4);
    rings = pow(rings, 8.0) * 0.12;

    // Composition finale.
    vec3 col = uBase;
    col = mix(col, uMid, mistDeep * 0.7);                  // brume profonde
    col = mix(col, uMid * 1.45, bands * 0.55);             // bandes quantifiées
    col += uHighlight * bandEdge * 0.18;                   // contours fins
    col += uHighlight * motes * 0.85;                      // dust motes
    col += uSacred * rings;                                // cercles rituels

    col *= edgeFade;
    // Dithering anti-banding (sur les gradients restants — la brume profonde
    // et l'edgeFade sont encore continus).
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
