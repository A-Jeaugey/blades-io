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

const defs: CosmeticDef[] = [
  { id: "recrue", slot: "skin", level: 2 },
  { id: "robot", slot: "skin" },
  { id: "pulse", slot: "bladeSkin", level: 2 },
  { id: "comete", slot: "trail", level: 2 },
  { id: "confettis", slot: "killFx", level: 2 },
];

export const COSMETICS: Readonly<Record<string, CosmeticDef>> = Object.fromEntries(defs.map((d) => [d.id, d]));

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
