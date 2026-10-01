import { getShopItem } from "./shop";

// Cosmétiques visibles par tous (tâche 6.1) : skin du personnage, style des
// lames, traînée et effet d'élimination. Le client propose son équipement
// en entrant en partie, le serveur le valide (possession vérifiée) et le
// synchronise sur le Player. Aucun ne touche au gameplay : formes de lames
// (tiers), couleurs de rareté, anneau au sol (soi / les autres) et halo de
// protection restent ceux de tout le monde.

export type CosmeticSlot = "skin" | "bladeSkin" | "trail" | "killFx";
export const COSMETIC_SLOTS: readonly CosmeticSlot[] = ["skin", "bladeSkin", "trail", "killFx"];

export interface CosmeticDef {
  id: string;
  slot: CosmeticSlot;
  // Débloqué gratuitement à ce niveau de compte (tâche 5.2). Sans niveau,
  // l'item est vendu en boutique (SHOP_ITEMS).
  level?: number;
}

// Emplacement → identifiant équipé ; "" = l'apparence de base.
export type Loadout = Record<CosmeticSlot, string>;
export const DEFAULT_LOADOUT: Readonly<Loadout> = { skin: "", bladeSkin: "", trail: "", killFx: "" };

// Premiers cosmétiques (tâche 6.2) : la moitié se débloque en jouant (les
// récompenses de niveau promises en 5.2), l'autre s'achète. Prix dans
// SHOP_ITEMS (shop.ts), seule source de vérité.
const DEFS = [
  // Skins du personnage.
  { id: "recrue", slot: "skin", level: 2 },
  { id: "sentinelle", slot: "skin", level: 5 },
  { id: "ninja", slot: "skin", level: 10 },
  { id: "astronaute", slot: "skin", level: 20 },
  { id: "spectre", slot: "skin", level: 30 },
  { id: "robot", slot: "skin" },
  { id: "renard", slot: "skin" },
  { id: "chevalier", slot: "skin" },
  { id: "demon", slot: "skin" },
  // Styles de lames.
  { id: "pulse", slot: "bladeSkin", level: 2 },
  { id: "stries", slot: "bladeSkin", level: 8 },
  { id: "etincelles", slot: "bladeSkin", level: 15 },
  { id: "noyau", slot: "bladeSkin" },
  { id: "glitch", slot: "bladeSkin" },
  // Traînées.
  { id: "comete", slot: "trail", level: 2 },
  { id: "aurore", slot: "trail", level: 12 },
  { id: "plasma", slot: "trail" },
  { id: "braise", slot: "trail" },
  // Effets d'élimination.
  { id: "confettis", slot: "killFx", level: 2 },
  { id: "ames", slot: "killFx", level: 25 },
  { id: "nova", slot: "killFx" },
] as const satisfies readonly CosmeticDef[];

// Identifiants d'un emplacement : le client s'en sert pour exiger une
// apparence par item (cosmetics/looks.ts ne compile pas s'il en manque).
export type CosmeticId<S extends CosmeticSlot = CosmeticSlot> = Extract<(typeof DEFS)[number], { slot: S }>["id"];

export const COSMETICS: Readonly<Record<string, CosmeticDef>> = Object.fromEntries(DEFS.map((d) => [d.id, d]));

// Ordre d'affichage d'un emplacement (débloqués par niveau croissant, puis
// les items vendus).
export function cosmeticsOf(slot: CosmeticSlot): CosmeticDef[] {
  return DEFS.filter((d) => d.slot === slot);
}

// Items débloqués en passant du niveau `from` au niveau `to` (carte de fin
// de vie).
export function cosmeticsUnlocked(from: number, to: number): CosmeticDef[] {
  return DEFS.filter((d: CosmeticDef) => d.level !== undefined && d.level > from && d.level <= to);
}

// hasOwnProperty : l'id vient du client (cf. getShopItem).
export function getCosmetic(id: string): CosmeticDef | undefined {
  return Object.prototype.hasOwnProperty.call(COSMETICS, id) ? COSMETICS[id] : undefined;
}

export interface CosmeticAccess {
  level: number;
  // Item acheté (inventaire du compte).
  owns: (id: string) => boolean;
}

// Débloqué par le niveau, ou vendu et possédé.
export function hasCosmetic(def: CosmeticDef, access: CosmeticAccess): boolean {
  if (def.level !== undefined) return access.level >= def.level;
  return getShopItem(def.id) !== undefined && access.owns(def.id);
}

// Équipement demandé par le client → équipement retenu : chaque emplacement
// garde son item s'il existe, va bien là et appartient au joueur, sinon il
// revient à l'apparence de base.
export function validateLoadout(raw: unknown, access: CosmeticAccess): Loadout {
  const out: Loadout = { ...DEFAULT_LOADOUT };
  if (!raw || typeof raw !== "object") return out;
  for (const slot of COSMETIC_SLOTS) {
    const id = (raw as Record<string, unknown>)[slot];
    if (typeof id !== "string" || id === "") continue;
    const def = getCosmetic(id);
    if (def && def.slot === slot && hasCosmetic(def, access)) out[slot] = id;
  }
  return out;
}
