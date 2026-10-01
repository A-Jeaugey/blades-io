// Apparence des cosmétiques (tâches 6.1 et 6.2) : des données, comme les
// thèmes (les couleurs vivent ici ou dans themes/, cf. CLAUDE.md). Les
// identifiants sont ceux du catalogue partagé (shared/src/cosmetics.ts).
//
import { CosmeticId } from "@bladeio/shared";

// Garde-fous de lisibilité : un skin change le corps et la tête, jamais
// l'anneau au sol (soi / les autres, couleurs du thème) ni le halo de
// protection ; un style de lame module la luminosité, jamais la teinte de
// rareté ni la forme du palier.

export type Accessory = "none" | "headband" | "antenna" | "visor" | "horns" | "crest" | "hood" | "ears";
export type HeadShape = "sphere" | "box";

export interface SkinLook {
  // Corps et membres, tête, lueur (matériaux éclairés).
  body: number;
  head: number;
  emissive: number;
  emissiveIntensity: number;
  // Couleur unie des qualités sans éclairage (basse, potato).
  flat: number;
  headShape: HeadShape;
  accessory: Accessory;
  // Couleur de l'accessoire, lumineuse.
  accent: number;
}

// Une apparence par skin du catalogue (le compilateur l'exige).
export const SKIN_LOOKS: Readonly<Record<CosmeticId<"skin">, SkinLook>> = {
  recrue: {
    body: 0xb8c4d4, head: 0xc9d3e0, emissive: 0x5d7290, emissiveIntensity: 0.6, flat: 0x7d93ad,
    headShape: "sphere", accessory: "headband", accent: 0xff7a3d,
  },
  sentinelle: {
    body: 0x2f6b73, head: 0x3a7f88, emissive: 0x1aa6b7, emissiveIntensity: 0.5, flat: 0x2f8a96,
    headShape: "sphere", accessory: "visor", accent: 0x5ef6ff,
  },
  ninja: {
    body: 0x2c303a, head: 0x333845, emissive: 0x4a3656, emissiveIntensity: 0.55, flat: 0x454a59,
    headShape: "sphere", accessory: "headband", accent: 0xff2a3d,
  },
  astronaute: {
    body: 0xe9eef5, head: 0xf4f7fb, emissive: 0xb8c8de, emissiveIntensity: 0.6, flat: 0xd6deea,
    headShape: "sphere", accessory: "visor", accent: 0xffa53a,
  },
  spectre: {
    body: 0xd9ccff, head: 0xece4ff, emissive: 0x9d7bff, emissiveIntensity: 0.8, flat: 0xb8a5ff,
    headShape: "sphere", accessory: "hood", accent: 0x6c4cff,
  },
  robot: {
    body: 0xc3c9d3, head: 0xd7dce4, emissive: 0x3d5f99, emissiveIntensity: 0.45, flat: 0x9aa4b4,
    headShape: "box", accessory: "antenna", accent: 0xff3b3b,
  },
  renard: {
    body: 0xe8833a, head: 0xf09a52, emissive: 0x8a3c10, emissiveIntensity: 0.5, flat: 0xd9772f,
    headShape: "sphere", accessory: "ears", accent: 0xfff1e0,
  },
  chevalier: {
    body: 0xb9c2cf, head: 0xcfd6e0, emissive: 0x5c6b80, emissiveIntensity: 0.45, flat: 0x9eaabb,
    headShape: "box", accessory: "crest", accent: 0xd8283c,
  },
  demon: {
    body: 0xa3192f, head: 0xb8233a, emissive: 0x5a0a16, emissiveIntensity: 0.6, flat: 0x9c1a2e,
    headShape: "sphere", accessory: "horns", accent: 0xf0e2c0,
  },
};

// Motif des lames : indice lu par le shader des lames (STYLE_GLSL dans
// BladeView.ts), 0 = aucun.
export const BLADE_STYLES: Readonly<Record<CosmeticId<"bladeSkin">, number>> = {
  pulse: 1,
  stries: 2,
  etincelles: 3,
  noyau: 4,
  glitch: 5,
};

export interface TrailLook {
  // Dégradé de la tête (le joueur) au bout.
  head: number;
  tail: number;
  // Largeur et opacité relatives à la traînée de base.
  width: number;
  alpha: number;
}

export const TRAIL_LOOKS: Readonly<Record<CosmeticId<"trail">, TrailLook>> = {
  comete: { head: 0xfff0b8, tail: 0xff7a1a, width: 1.15, alpha: 1 },
  aurore: { head: 0x7dffb2, tail: 0x9b5cff, width: 1.1, alpha: 1 },
  plasma: { head: 0x5ef0ff, tail: 0xff4fd8, width: 1.3, alpha: 1 },
  braise: { head: 0xffd54a, tail: 0xff3b1f, width: 1.0, alpha: 1 },
};

export interface KillFxLook {
  colors: readonly number[];
  count: number;
  speed: number;
  // Vitesse verticale de départ, et part de la gravité (confettis qui
  // flottent, étincelles qui retombent).
  rise: number;
  gravity: number;
  life: number;
  size: number;
}

// Gravité négative : les âmes montent.
export const KILL_FX_LOOKS: Readonly<Record<CosmeticId<"killFx">, KillFxLook>> = {
  confettis: { colors: [0xff4d6d, 0xffd23f, 0x3ec1ff, 0x7cff6b, 0xb36bff], count: 48, speed: 4.5, rise: 3.5, gravity: 0.25, life: 1.3, size: 0.45 },
  ames: { colors: [0xbfeaff, 0xe8f6ff, 0x8fd3ff], count: 26, speed: 1.2, rise: 3, gravity: -0.15, life: 1.8, size: 0.7 },
  nova: { colors: [0xfff3b0, 0xffd34d, 0xffffff], count: 60, speed: 10, rise: 0.6, gravity: 0.1, life: 0.6, size: 0.4 },
};

// Apparence d'un identifiant venu du réseau (hasOwnProperty : pas de clé du
// prototype) ; null pour l'apparence de base.
export function lookOf<T>(table: Readonly<Record<string, T>>, id: string): T | null {
  return id !== "" && Object.prototype.hasOwnProperty.call(table, id) ? table[id] : null;
}
