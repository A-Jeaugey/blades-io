// Apparence des cosmétiques (tâches 6.1 et 6.2) : des données, comme les
// thèmes (les couleurs vivent ici ou dans themes/, cf. CLAUDE.md). Les
// identifiants sont ceux du catalogue partagé (shared/src/cosmetics.ts).
//
import { CosmeticId } from "@bladeio/shared";

// Garde-fous de lisibilité : un skin change le corps et la tête, jamais
// l'anneau au sol (soi / les autres, couleurs du thème) ni le halo de
// protection ; un style de lame module la luminosité, jamais la teinte de
// rareté ni la forme du palier.

export type Accessory =
  | "none" | "headband" | "antenna" | "visor" | "horns" | "crest" | "hood" | "ears"
  // Deuxième vague (retours du 2026-10-12) : tout reste sur la tête, au-dessus
  // de 1,3 u. Vu de la caméra (54°), rien ne se projette sur l'anneau au sol,
  // à la différence d'une cape, qui le masquait de profil.
  | "cap" | "wizard" | "headphones" | "beak" | "twinAntenna" | "topHat" | "crescent" | "goggles" | "sprout";
// gem : tête de cristal à facettes (icosaèdre).
export type HeadShape = "sphere" | "box" | "gem";

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
  skateur: {
    body: 0xf2c230, head: 0xf5cf50, emissive: 0x8a6a10, emissiveIntensity: 0.5, flat: 0xd9ad2a,
    headShape: "sphere", accessory: "cap", accent: 0x3d6bff,
  },
  pousse: {
    body: 0x4f9a52, head: 0x63b066, emissive: 0x1f5a2a, emissiveIntensity: 0.5, flat: 0x4a8f4d,
    headShape: "sphere", accessory: "sprout", accent: 0xc6ff5a,
  },
  martien: {
    body: 0x56d6c4, head: 0x6fe8d6, emissive: 0x1a8f80, emissiveIntensity: 0.55, flat: 0x4cc2b2,
    headShape: "sphere", accessory: "twinAntenna", accent: 0xff5ad1,
  },
  pilote: {
    body: 0x7a5534, head: 0x8a6440, emissive: 0x4a2c14, emissiveIntensity: 0.45, flat: 0x7a5534,
    headShape: "sphere", accessory: "goggles", accent: 0xffb347,
  },
  dj: {
    body: 0x26203a, head: 0x2e2747, emissive: 0x8a2070, emissiveIntensity: 0.35, flat: 0x4a2f63,
    headShape: "sphere", accessory: "headphones", accent: 0x5ef6ff,
  },
  corbeau: {
    body: 0x1a2233, head: 0x222c40, emissive: 0x2a3f73, emissiveIntensity: 0.55, flat: 0x2c3954,
    headShape: "sphere", accessory: "beak", accent: 0xffc23a,
  },
  dandy: {
    body: 0x353a48, head: 0xe9dccb, emissive: 0x5a6280, emissiveIntensity: 0.45, flat: 0x5a6070,
    headShape: "sphere", accessory: "topHat", accent: 0xd6a84a,
  },
  samourai: {
    body: 0xb02a36, head: 0x4a3a42, emissive: 0x6a1420, emissiveIntensity: 0.5, flat: 0x9a2430,
    headShape: "box", accessory: "crescent", accent: 0xffd34d,
  },
  sorcier: {
    body: 0x4a2a8a, head: 0xd8c8f0, emissive: 0x6a3fd0, emissiveIntensity: 0.55, flat: 0x5b37a3,
    headShape: "sphere", accessory: "wizard", accent: 0xffcf4a,
  },
  golem: {
    body: 0x4a505c, head: 0xb8f2ff, emissive: 0x2a8ab8, emissiveIntensity: 0.55, flat: 0x5f7a90,
    headShape: "gem", accessory: "none", accent: 0x9fe8ff,
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
  eclat: 6,
  battement: 7,
  charge: 8,
  damas: 9,
};

export interface TrailLook {
  // Dégradé de la tête (le joueur) au bout, par le milieu s'il est donné.
  head: number;
  mid?: number;
  tail: number;
  // Largeur et opacité relatives à la traînée de base.
  width: number;
  alpha: number;
  // Forme du ruban : il ondule de part et d'autre de la course (wave), ou se
  // torsade en perles (helix). Même maillage et même matériau : seuls les
  // sommets changent, aucun shader de plus.
  pattern?: "wave" | "helix";
}

export const TRAIL_LOOKS: Readonly<Record<CosmeticId<"trail">, TrailLook>> = {
  comete: { head: 0xfff0b8, tail: 0xff7a1a, width: 1.15, alpha: 1 },
  aurore: { head: 0x7dffb2, tail: 0x9b5cff, width: 1.1, alpha: 1 },
  plasma: { head: 0x5ef0ff, tail: 0xff4fd8, width: 1.3, alpha: 1 },
  braise: { head: 0xffd54a, tail: 0xff3b1f, width: 1.0, alpha: 1 },
  prisme: { head: 0xffef7a, mid: 0x5dffb0, tail: 0x6a7dff, width: 1.15, alpha: 1 },
  onde: { head: 0xbaf7ff, tail: 0x3a6bff, width: 0.85, alpha: 1, pattern: "wave" },
  helice: { head: 0xffe9a8, mid: 0xff8fd8, tail: 0x9a6bff, width: 1.3, alpha: 1, pattern: "helix" },
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
  // Figure de la salve (sinon une gerbe au hasard) : rayons d'étoile,
  // spirale qui s'élève, cœur dessiné à plat (lisible sous la caméra).
  shape?: BurstShape;
}

export type BurstShape = "star" | "whirl" | "heart";

// Gravité négative : les âmes montent.
export const KILL_FX_LOOKS: Readonly<Record<CosmeticId<"killFx">, KillFxLook>> = {
  confettis: { colors: [0xff4d6d, 0xffd23f, 0x3ec1ff, 0x7cff6b, 0xb36bff], count: 48, speed: 4.5, rise: 3.5, gravity: 0.25, life: 1.3, size: 0.45 },
  ames: { colors: [0xbfeaff, 0xe8f6ff, 0x8fd3ff], count: 26, speed: 1.2, rise: 3, gravity: -0.15, life: 1.8, size: 0.7 },
  nova: { colors: [0xfff3b0, 0xffd34d, 0xffffff], count: 60, speed: 10, rise: 0.6, gravity: 0.1, life: 0.6, size: 0.4 },
  etoile: { colors: [0xfff6d0, 0x9fe4ff, 0xffffff], count: 48, speed: 9, rise: 0.4, gravity: 0, life: 0.9, size: 0.42, shape: "star" },
  coeur: { colors: [0xff5c9a, 0xff9ec4, 0xffd1e3], count: 44, speed: 4.2, rise: 0.5, gravity: -0.06, life: 1.1, size: 0.5, shape: "heart" },
  tourbillon: { colors: [0x7df9ff, 0xb38cff, 0xe9fbff], count: 54, speed: 4.5, rise: 3.2, gravity: -0.1, life: 1.2, size: 0.42, shape: "whirl" },
};

// Départ d'une particule de salve en figure : direction au sol (x, z ; -z est
// le haut de l'écran), vitesse et montée relatives, décalage du point de
// départ (ox, oz, en u). i de 0 à n - 1 ; spin : rotation de la figure (au
// hasard en jeu, fixe en aperçu). Partagé par la salve en jeu (Particles.ts)
// et son aperçu CSS (boutique). Écrit dans out : pas d'allocation par
// particule.
export interface BurstStart { x: number; z: number; speed: number; rise: number; ox: number; oz: number }

function setStart(out: BurstStart, x: number, z: number, speed: number, rise: number, ox: number, oz: number): BurstStart {
  out.x = x; out.z = z; out.speed = speed; out.rise = rise; out.ox = ox; out.oz = oz;
  return out;
}

export function burstStart(shape: BurstShape, i: number, n: number, spin: number, out: BurstStart): BurstStart {
  if (shape === "star") {
    // Cinq rayons : chaque particule sur l'un d'eux, à sa vitesse, d'où
    // des branches nettes au lieu d'un nuage.
    const arms = 5;
    const a = spin + ((i % arms) / arms) * Math.PI * 2;
    const k = Math.floor(i / arms) / Math.max(1, Math.ceil(n / arms) - 1);
    return setStart(out, Math.cos(a), Math.sin(a), 0.25 + 0.75 * k, 0.3, 0, 0);
  }
  if (shape === "heart") {
    // Courbe du cœur (hauteur ~1,7), pointe vers la caméra (+z) : vue
    // d'en haut, il se lit à l'endroit.
    const t = (i / n) * Math.PI * 2;
    const st = Math.sin(t);
    const hx = (16 * st * st * st) / 17;
    const hy = (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17;
    return setStart(out, hx, -hy, 1, 0.4, 0, 0);
  }
  // Spirale à trois bras : départs le long des bras, chacun lancé selon la
  // tangente (un peu vers l'extérieur), d'où un moulinet qui s'ouvre ; la
  // montée croît vers le bout des bras. Partie d'un même point, la tangente
  // ne voudrait rien dire.
  const arms = 3;
  const k = Math.floor(i / arms) / Math.max(1, Math.ceil(n / arms) - 1);
  const a = spin + ((i % arms) / arms) * Math.PI * 2 + k * 2.2;
  const r = 0.25 + 0.9 * k;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return setStart(out, -s + c * 0.25, c + s * 0.25, 0.4 + 0.6 * k, k, c * r, s * r);
}

// Apparence d'un identifiant venu du réseau (hasOwnProperty : pas de clé du
// prototype) ; null pour l'apparence de base.
export function lookOf<T>(table: Readonly<Record<string, T>>, id: string): T | null {
  return id !== "" && Object.prototype.hasOwnProperty.call(table, id) ? table[id] : null;
}
