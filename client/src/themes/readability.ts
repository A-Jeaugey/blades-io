import { BladeRarity } from "@bladeio/shared";
import { DANGER_COLOR, PREY_COLOR, Theme } from "./Theme";

// ─────────────────────────────────────────────────────────────────────────────
// Garde-fous de lisibilité des thèmes (tâche 6.3, décision D4).
//
// Un thème vendu ne doit jamais rendre le jeu plus dur à lire : raretés de la
// même famille de teinte sur toutes les cartes, sol sombre et calme, aucune
// couleur du sol qui ressemble à une lame ou à une menace. Ce module porte le
// contrat et sa vérification :
// - tools/check-themes.mjs (CI) appelle checkTheme() sur chaque thème du
//   registre et checkColorblindPalette() sur la palette daltonienne ;
// - Ground.ts plafonne en plus la luminance du sol au rendu
//   (READABILITY.groundMaxLuma), quel que soit le shader du thème.
//
// Couleurs comparées telles qu'affichées (hex sRGB) : luminance relative et
// rapport de contraste du WCAG, écart CIEDE2000 (≈ 2 : à peine visible ; 20 :
// deux couleurs qu'on ne confond pas), teinte et chroma en OKLCH.
// ─────────────────────────────────────────────────────────────────────────────

export const READABILITY = {
  // Luminance relative (0 à 1) des couleurs du sol, et plafond appliqué au
  // rendu : un sol plus clair noie les lames (Profondeurs Glacées, audit).
  groundMaxLuma: 0.12,
  // Fond du sol (sa couleur dominante), brouillard et fond de scène.
  groundBaseMaxLuma: 0.03,
  atmosphereMaxLuma: 0.04,
  // Deux raretés ne se confondent pas.
  rarityMinDeltaE: 20,
  // Une lame ressort sur le fond du sol (contraste des éléments d'interface
  // du WCAG)…
  rarityOnBaseMinContrast: 3,
  // … et sur chaque motif du sol, par la luminance ou par la couleur.
  rarityOnGroundMinContrast: 1.5,
  rarityOnGroundMinDeltaE: 20,
  // Couleurs de gameplay (menace, zone mortelle) : aucune couleur du sol ni
  // aucune rareté ne leur ressemble.
  reservedMinDeltaE: 20,
  // Palette daltonienne : raretés distinctes sous chaque dichromasie.
  colorblindMinDeltaE: 12,
} as const;

// Famille de teinte d'une rareté (OKLCH : clarté L de 0 à 1, chroma C, teinte
// H en degrés). Un thème choisit sa nuance dans la famille : la rareté se lit
// pareil sur toutes les cartes.
export interface HueFamily {
  name: string;
  hue?: readonly [number, number];
  minChroma?: number;
  maxChroma?: number;
  minLightness: number;
}

export const RARITY_FAMILIES: Readonly<Record<BladeRarity, HueFamily>> = {
  [BladeRarity.Common]: { name: "blanc", maxChroma: 0.05, minLightness: 0.88 },
  [BladeRarity.Rare]: { name: "bleu", hue: [200, 265], minChroma: 0.11, minLightness: 0.6 },
  [BladeRarity.Epic]: { name: "violet", hue: [280, 320], minChroma: 0.14, minLightness: 0.55 },
  [BladeRarity.Legendary]: { name: "or", hue: [55, 100], minChroma: 0.11, minLightness: 0.78 },
};

// Zone mortelle : un rouge franc (du rose-rouge au rouge orangé).
export const DANGER_FAMILY: HueFamily = { name: "rouge", hue: [345, 40], minChroma: 0.15, minLightness: 0.5 };

const RARITY_NAMES: Readonly<Record<BladeRarity, string>> = {
  [BladeRarity.Common]: "commune",
  [BladeRarity.Rare]: "rare",
  [BladeRarity.Epic]: "épique",
  [BladeRarity.Legendary]: "légendaire",
};
const RARITIES = [BladeRarity.Common, BladeRarity.Rare, BladeRarity.Epic, BladeRarity.Legendary] as const;

// ─── Calculs de couleur ──────────────────────────────────────────────────────

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function linearRgb(hex: number): [number, number, number] {
  return [srgbToLinear((hex >> 16) & 255), srgbToLinear((hex >> 8) & 255), srgbToLinear(hex & 255)];
}

export function relativeLuminance(hex: number): number {
  const [r, g, b] = linearRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: number, b: number): number {
  const ya = relativeLuminance(a);
  const yb = relativeLuminance(b);
  return (Math.max(ya, yb) + 0.05) / (Math.min(ya, yb) + 0.05);
}

export function oklch(hex: number): { l: number; c: number; h: number } {
  const [r, g, b] = linearRgb(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

type Lab = [number, number, number];

// CIE L*a*b* (D65) depuis du RGB linéaire.
function labFromLinear([r, g, b]: [number, number, number]): Lab {
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

// Écart CIEDE2000 (Sharma, Wu, Dalal 2005).
function deltaE2000Lab([L1, a1, b1]: Lab, [L2, a2, b2]: Lab): number {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (a: number, b: number) => {
    if (a === 0 && b === 0) return 0;
    const h = Math.atan2(b, a) / rad;
    return h >= 0 ? h : h + 360;
  };
  const h1p = hue(a1p, b1);
  const h2p = hue(a2p, b2);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbp = h1p + h2p < 360 ? hbp + 360 : hbp - 360;
    hbp /= 2;
  }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad)
    + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

export function deltaE2000(a: number, b: number): number {
  return deltaE2000Lab(labFromLinear(linearRgb(a)), labFromLinear(linearRgb(b)));
}

// Dichromasies (Machado, Oliveira, Fernandes 2009, sévérité maximale), en RGB
// linéaire : la même simulation que les mesures de la tâche 3.8.
export type Vision = "protanopie" | "deutéranopie" | "tritanopie";
const CVD: Readonly<Record<Vision, readonly (readonly number[])[]>> = {
  protanopie: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutéranopie: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopie: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};

function simulatedLab(hex: number, vision: Vision): Lab {
  const lin = linearRgb(hex);
  const m = CVD[vision];
  const out = m.map((row) => Math.min(1, Math.max(0, row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2])));
  return labFromLinear(out as [number, number, number]);
}

export function inFamily(hex: number, f: HueFamily): boolean {
  const { l, c, h } = oklch(hex);
  if (l < f.minLightness) return false;
  if (f.minChroma !== undefined && c < f.minChroma) return false;
  if (f.maxChroma !== undefined && c > f.maxChroma) return false;
  if (f.hue) {
    const [from, to] = f.hue;
    // Une plage qui passe par 0° (rouge) s'écrit [345, 40].
    const ok = from <= to ? h >= from && h <= to : h >= from || h <= to;
    if (!ok) return false;
  }
  return true;
}

// ─── Vérifications ───────────────────────────────────────────────────────────

const hexStr = (n: number) => "#" + n.toString(16).padStart(6, "0");

function describe(hex: number): string {
  const { l, c, h } = oklch(hex);
  return `${hexStr(hex)} (L ${l.toFixed(2)}, C ${c.toFixed(3)}, H ${h.toFixed(0)}°, luminance ${relativeLuminance(hex).toFixed(3)})`;
}

function familyText(f: HueFamily): string {
  const parts = [`L ≥ ${f.minLightness}`];
  if (f.hue) parts.push(`H ${f.hue[0]}° à ${f.hue[1]}°`);
  if (f.minChroma !== undefined) parts.push(`C ≥ ${f.minChroma}`);
  if (f.maxChroma !== undefined) parts.push(`C ≤ ${f.maxChroma}`);
  return `${f.name} : ${parts.join(", ")}`;
}

// Couleur codée en dur dans un shader du sol (vec3 de littéraux autres que 0
// et 1) : elle échapperait aux vérifications de ground.colors.
const VEC3_LITERAL = /vec3\(\s*(-?[\d.]+)\s*(?:,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*)?\)/g;

function hardcodedColors(src: string): string[] {
  const found: string[] = [];
  for (const m of src.matchAll(VEC3_LITERAL)) {
    const values = [m[1], m[2], m[3]].filter((v): v is string => v !== undefined).map(Number);
    if (values.some((v) => v !== 0 && v !== 1)) found.push(m[0]);
  }
  return found;
}

// Uniforms de couleur que Ground.ts fournit d'après ground.colors : uBase pour
// base, uCrack pour crack, etc.
export function groundUniformName(key: string): string {
  return "u" + key.charAt(0).toUpperCase() + key.slice(1);
}

export interface CheckResult {
  errors: string[];
}

export function checkTheme(theme: Theme): CheckResult {
  const errors: string[] = [];
  const p = theme.palette;
  const R = READABILITY;
  const ground = theme.ground.colors;

  // 1. Raretés : famille universelle, et distinctes entre elles.
  for (const r of RARITIES) {
    const f = RARITY_FAMILIES[r];
    if (!inFamily(p.rarityColor[r], f)) {
      errors.push(`rareté ${RARITY_NAMES[r]} ${describe(p.rarityColor[r])} hors de sa famille (${familyText(f)})`);
    }
  }
  for (let i = 0; i < RARITIES.length; i++) {
    for (let j = i + 1; j < RARITIES.length; j++) {
      const a = RARITIES[i], b = RARITIES[j];
      const d = deltaE2000(p.rarityColor[a], p.rarityColor[b]);
      if (d < R.rarityMinDeltaE) {
        errors.push(`raretés ${RARITY_NAMES[a]} et ${RARITY_NAMES[b]} trop proches (écart ${d.toFixed(1)} < ${R.rarityMinDeltaE})`);
      }
    }
  }

  // 2. Sol sombre : le fond, et chaque couleur qu'il affiche.
  if (relativeLuminance(ground.base) > R.groundBaseMaxLuma) {
    errors.push(`fond du sol ${describe(ground.base)} trop clair (luminance max ${R.groundBaseMaxLuma})`);
  }
  for (const [key, color] of Object.entries(ground)) {
    if (relativeLuminance(color) > R.groundMaxLuma) {
      errors.push(`couleur du sol « ${key} » ${describe(color)} trop claire (luminance max ${R.groundMaxLuma})`);
    }
  }
  for (const [key, color] of [["brouillard", p.fogColor], ["fond de scène", p.clearColor]] as const) {
    if (relativeLuminance(color) > R.atmosphereMaxLuma) {
      errors.push(`${key} ${describe(color)} trop clair (luminance max ${R.atmosphereMaxLuma})`);
    }
  }

  // 3. Chaque rareté ressort sur le sol.
  for (const r of RARITIES) {
    const c = p.rarityColor[r];
    const onBase = contrastRatio(c, ground.base);
    if (onBase < R.rarityOnBaseMinContrast) {
      errors.push(`rareté ${RARITY_NAMES[r]} sur le fond du sol : contraste ${onBase.toFixed(2)} < ${R.rarityOnBaseMinContrast}`);
    }
    for (const [key, color] of Object.entries(ground)) {
      if (key === "base") continue;
      const cr = contrastRatio(c, color);
      const d = deltaE2000(c, color);
      if (cr < R.rarityOnGroundMinContrast && d < R.rarityOnGroundMinDeltaE) {
        errors.push(`rareté ${RARITY_NAMES[r]} se confond avec la couleur du sol « ${key} » (contraste ${cr.toFixed(2)}, écart ${d.toFixed(1)})`);
      }
    }
  }

  // 4. Couleurs réservées au gameplay : la zone mortelle est rouge et ne
  // ressemble à aucune rareté ; ni le sol ni les raretés ne ressemblent aux
  // couleurs de menace.
  if (!inFamily(p.boundary, DANGER_FAMILY)) {
    errors.push(`zone mortelle ${describe(p.boundary)} hors de la famille ${familyText(DANGER_FAMILY)}`);
  }
  if (contrastRatio(p.boundary, ground.base) < R.rarityOnBaseMinContrast) {
    errors.push(`zone mortelle peu visible sur le fond du sol (contraste ${contrastRatio(p.boundary, ground.base).toFixed(2)})`);
  }
  for (const r of RARITIES) {
    const d = deltaE2000(p.rarityColor[r], p.boundary);
    if (d < R.reservedMinDeltaE) errors.push(`rareté ${RARITY_NAMES[r]} trop proche de la zone mortelle (écart ${d.toFixed(1)})`);
  }
  const reserved = [["danger", DANGER_COLOR], ["proie", PREY_COLOR]] as const;
  for (const [name, color] of reserved) {
    for (const r of RARITIES) {
      const d = deltaE2000(p.rarityColor[r], color);
      if (d < R.reservedMinDeltaE) errors.push(`rareté ${RARITY_NAMES[r]} trop proche de la couleur de menace « ${name} » (écart ${d.toFixed(1)})`);
    }
    for (const [key, g] of Object.entries(ground)) {
      const d = deltaE2000(g, color);
      if (d < R.reservedMinDeltaE) errors.push(`couleur du sol « ${key} » trop proche de la couleur de menace « ${name} » (écart ${d.toFixed(1)})`);
    }
  }

  // 5. Particules d'ambiance : petites lueurs qui flottent au-dessus du sol,
  // elles ne prennent pas la couleur d'une lame.
  for (const w of new Set(theme.ambient.wisps?.colors ?? [])) {
    for (const r of RARITIES) {
      const d = deltaE2000(w, p.rarityColor[r]);
      if (d < R.rarityOnGroundMinDeltaE) {
        errors.push(`particule d'ambiance ${hexStr(w)} trop proche de la rareté ${RARITY_NAMES[r]} (écart ${d.toFixed(1)})`);
      }
    }
  }

  // 6. Les shaders du sol ne prennent leurs couleurs que dans ground.colors.
  const provided = new Set(Object.keys(ground).map(groundUniformName));
  for (const [level, src] of [["rich", theme.ground.fragRich], ["simple", theme.ground.fragSimple], ["flat", theme.ground.fragFlat]] as const) {
    for (const lit of hardcodedColors(src)) {
      errors.push(`shader du sol (${level}) : couleur en dur ${lit}, à déclarer dans ground.colors`);
    }
    for (const m of src.matchAll(/uniform\s+vec3\s+(\w+)\s*;/g)) {
      if (!provided.has(m[1])) errors.push(`shader du sol (${level}) : ${m[1]} ne vient d'aucune couleur de ground.colors`);
    }
    // Uniform utilisé sans être déclaré : le shader ne compilerait pas à ce
    // niveau de qualité (les autres niveaux ne le montreraient pas).
    const declared = new Set([...src.matchAll(/uniform\s+\w+\s+(\w+)\s*;/g)].map((m) => m[1]));
    for (const name of new Set([...src.matchAll(/\bu[A-Z]\w*/g)].map((m) => m[0]))) {
      if (!declared.has(name)) errors.push(`shader du sol (${level}) : ${name} utilisé sans être déclaré`);
    }
  }
  return { errors };
}

// Palette daltonienne : elle remplace les raretés de tous les thèmes, donc
// elle doit ressortir sur chaque sol, et rester distincte sous chaque
// dichromasie (les familles de teinte ne la concernent pas : son épique rose
// est voulu, un violet se lit bleu pour un deutéranope).
export function checkColorblindPalette(rarityColor: Record<BladeRarity, number>, themes: readonly Theme[]): CheckResult {
  const errors: string[] = [];
  const R = READABILITY;
  for (const vision of Object.keys(CVD) as Vision[]) {
    for (let i = 0; i < RARITIES.length; i++) {
      for (let j = i + 1; j < RARITIES.length; j++) {
        const a = RARITIES[i], b = RARITIES[j];
        const d = deltaE2000Lab(simulatedLab(rarityColor[a], vision), simulatedLab(rarityColor[b], vision));
        if (d < R.colorblindMinDeltaE) {
          errors.push(`${vision} : raretés ${RARITY_NAMES[a]} et ${RARITY_NAMES[b]} trop proches (écart ${d.toFixed(1)} < ${R.colorblindMinDeltaE})`);
        }
      }
    }
  }
  for (const theme of themes) {
    const base = theme.ground.colors.base;
    for (const r of RARITIES) {
      const cr = contrastRatio(rarityColor[r], base);
      if (cr < R.rarityOnBaseMinContrast) {
        errors.push(`${theme.id} : rareté ${RARITY_NAMES[r]} sur le fond du sol, contraste ${cr.toFixed(2)} < ${R.rarityOnBaseMinContrast}`);
      }
      for (const [key, color] of Object.entries(theme.ground.colors)) {
        if (key === "base") continue;
        const c2 = contrastRatio(rarityColor[r], color);
        const d = deltaE2000(rarityColor[r], color);
        if (c2 < R.rarityOnGroundMinContrast && d < R.rarityOnGroundMinDeltaE) {
          errors.push(`${theme.id} : rareté ${RARITY_NAMES[r]} se confond avec la couleur du sol « ${key} »`);
        }
      }
    }
  }
  return { errors };
}
