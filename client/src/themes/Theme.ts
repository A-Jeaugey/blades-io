import * as THREE from "three";
import { BladeRarity, PowerUpType } from "@bladeio/shared";

// ─────────────────────────────────────────────────────────────────────────────
// Theme — package cosmétique complet d'un match.
//
// Un thème encapsule tout ce qui change quand on passe d'une ambiance à une
// autre : palette, shader du sol, lumières, matériaux des entités, particules
// ambient, musique. Les positions de collision (obstacles, bushes…) restent
// définies dans @bladeio/shared et sont identiques entre tous les thèmes —
// seul leur visuel change. Garantit l'équité gameplay.
//
// Pour ajouter un thème : créer un fichier dans themes/, exporter un objet
// Theme satisfaisant cette interface, l'enregistrer dans themes/index.ts.
// ─────────────────────────────────────────────────────────────────────────────

export type DecorVariant =
  // Cyberpunk d'origine : pilier central rose/cyan, cubes flottants émissifs,
  // bushes cylindre + sphères vertes.
  | {
      kind: "cyber";
      shrineCore: number;       // pilier central (couleur émissive)
      shrineHalo: number;       // anneau au sol
      obeliskInner: number;
      obeliskOuter: number;
      cubeColor: number;        // cubes flottants
      bushFoliage: number;      // mauve cyber
      bushAccent: number;       // halo
      groundPad: number;        // sceaux au sol (cyan d'origine)
      ringHint: number;         // anneaux concentriques
    }
  // Spirit world : sanctuaire doré, lanternes 3 couches, bosquets de
  // champignons + mousse au sol.
  | {
      kind: "spirit";
      shrineCore: number;       // pilier central (or sacré)
      shrineHalo: number;       // cercle rituel rose poudré
      obeliskInner: number;     // pierres dressées proches (mint)
      obeliskOuter: number;     // pierres dressées extérieures (violet)
      lanternCoreColor: number; // crème de la "flamme"
      lanternEmissive: number;  // glow doré
      lanternCage: number;      // anneau équatorial
      lanternHalo: number;      // halo additif
      mushroomStem: number;
      mushroomCap: number;
      mushroomUnderglow: number;
      mossColor: number;
      groundPad: number;
      ringHint: number;
    };

export interface ThemePalette {
  // Atmosphère
  clearColor: number;     // background renderer
  fogColor: number;
  // Boundary wall (mur de mort)
  boundary: number;
  // Joueurs
  playerLocal: { primary: number; accent: number; accentDim: number };
  playerRemote: { primary: number; accent: number; accentDim: number };
  // Reliquaire / crate
  crate: { primary: number; emissive: number; edge: number };
  // Raretés
  rarityColor: Record<BladeRarity, number>;
  rarityGlowComp: Record<BladeRarity, number>;
  // Power-ups (par type, pas par rareté)
  powerUpColor: Record<PowerUpType, number>;
  // FX bursts (utilisés par main.ts)
  fx: {
    crateHitSpark: number;
    crateDestroyExplosion: number;
    deathExplosion: number;
    clashSpark: number;
    tierUpHi: number;       // pour tier >= 2
    tierUpLo: number;       // pour tier 0/1
    powerUpFallback: number;
    bladeFallback: number;
  };
}

export interface ThemeLighting {
  ambient: { color: number; intensity: number };
  // Lights ajoutées seulement si simpleMaterials = false (pas en low/ultra).
  key: { color: number; intensity: number };
  rim: { color: number; intensity: number };
}

export interface ThemeBladeStyle {
  shininess: number;
  specularColor: number;  // teinte du highlight spéculaire
  emissiveBoost: number;  // multiplier sur top de la compensation glow
}

export interface ThemeAmbient {
  // Particules ambient flottantes. null = pas de particules (cas neon).
  wisps: {
    counts: { high: number; medium: number; low: number; ultra: number };
    colors: number[];           // pool de couleurs piochées au spawn
    drifSpeedMin: number;       // u/s
    drifSpeedMax: number;
  } | null;
}

export interface ThemeMusic {
  // Chemins relatifs au BASE_URL Vite. Servis depuis client/public/.
  lobby: string;
  battle: string;
}

export interface ThemeGround {
  // Sources GLSL pour les 3 niveaux de qualité.
  fragRich: string;
  fragSimple: string;
  fragFlat: string;
  // Uniforms additionnels (couleurs par exemple) à injecter dans le matériau.
  // uRadius et uTime sont gérés par Ground.ts — ce hook fournit le reste.
  buildExtraUniforms: (groundDetail: "rich" | "simple" | "flat") => Record<string, THREE.IUniform>;
}

export interface ThemeUiPalette {
  accentCool: string;     // ex --cyan, hex string "#rrggbb"
  accentWarm: string;     // ex --pink
  purple: string;
  dark: string;
  panelBg: string;        // rgba(...) css string
  panelBorder: string;
  fgBright: string;
  fgMuted: string;
  // Pour les box-shadow / hover rgba constructs : composantes RGB du
  // accent froid sans alpha (ex "0, 229, 255" ou "216, 164, 232")
  // — plus utilisé directement, gardé pour compat future.
}

export interface Theme {
  id: string;
  displayName: string;
  palette: ThemePalette;
  lighting: ThemeLighting;
  blades: ThemeBladeStyle;
  decor: DecorVariant;
  ambient: ThemeAmbient;
  music: ThemeMusic;
  ground: ThemeGround;
  ui: ThemeUiPalette;
  // Position offset de la caméra (vector3 components). Permet à chaque
  // thème d'ajuster l'inclinaison/distance.
  cameraOffset: { x: number; y: number; z: number };
}

// Calcule la compensation de luminance par rareté à partir d'un mapping de
// couleurs. Voir BladeView.ts : équilibre le bloom entre couleurs claires
// (qui franchissent facilement le threshold) et sombres (qui peinent).
export function computeRarityGlowComp(rarityColor: Record<BladeRarity, number>): Record<BladeRarity, number> {
  const lum = (hex: number): number => {
    const r = ((hex >> 16) & 0xff) / 255;
    const g = ((hex >> 8) & 0xff) / 255;
    const b = (hex & 0xff) / 255;
    return Math.max(0.2, 0.299 * r + 0.587 * g + 0.114 * b);
  };
  return {
    [BladeRarity.Common]: 1 / lum(rarityColor[BladeRarity.Common]),
    [BladeRarity.Rare]: 1 / lum(rarityColor[BladeRarity.Rare]),
    [BladeRarity.Epic]: 1 / lum(rarityColor[BladeRarity.Epic]),
    [BladeRarity.Legendary]: 1 / lum(rarityColor[BladeRarity.Legendary]),
  };
}
