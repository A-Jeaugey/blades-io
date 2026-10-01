// Apparence des cosmétiques (tâches 6.1 et 6.2) : des données, comme les
// thèmes (les couleurs vivent ici ou dans themes/, cf. CLAUDE.md). Les
// identifiants sont ceux du catalogue partagé (shared/src/cosmetics.ts).
//
// Garde-fous de lisibilité : un skin change le corps et la tête, jamais
// l'anneau au sol (soi / les autres, couleurs du thème) ni le halo de
// protection ; un style de lame module la luminosité, jamais la teinte de
// rareté ni la forme du palier.

export type Accessory = "none" | "headband" | "antenna" | "visor";
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

export const SKIN_LOOKS: Readonly<Record<string, SkinLook>> = {
  recrue: {
    body: 0xb8c4d4, head: 0xc9d3e0, emissive: 0x5d7290, emissiveIntensity: 0.6, flat: 0x7d93ad,
    headShape: "sphere", accessory: "headband", accent: 0xff7a3d,
  },
  robot: {
    body: 0xc3c9d3, head: 0xd7dce4, emissive: 0x3d5f99, emissiveIntensity: 0.45, flat: 0x9aa4b4,
    headShape: "box", accessory: "antenna", accent: 0xff3b3b,
  },
};

// Motif des lames : indice lu par le shader des lames (BladeView), 0 = aucun.
export const BLADE_STYLES: Readonly<Record<string, number>> = {
  pulse: 1,
};

export interface TrailLook {
  // Dégradé de la tête (le joueur) au bout.
  head: number;
  tail: number;
  // Largeur et opacité relatives à la traînée de base.
  width: number;
  alpha: number;
}

export const TRAIL_LOOKS: Readonly<Record<string, TrailLook>> = {
  comete: { head: 0xfff0b8, tail: 0xff7a1a, width: 1.15, alpha: 1 },
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

export const KILL_FX_LOOKS: Readonly<Record<string, KillFxLook>> = {
  confettis: { colors: [0xff4d6d, 0xffd23f, 0x3ec1ff, 0x7cff6b, 0xb36bff], count: 48, speed: 4.5, rise: 3.5, gravity: 0.25, life: 1.3, size: 0.45 },
};

// Apparence d'un identifiant venu du réseau (hasOwnProperty : pas de clé du
// prototype) ; null pour l'apparence de base.
export function lookOf<T>(table: Readonly<Record<string, T>>, id: string): T | null {
  return id !== "" && Object.prototype.hasOwnProperty.call(table, id) ? table[id] : null;
}
