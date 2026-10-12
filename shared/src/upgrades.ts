import { PowerUpType } from "./constants";
import { POWERUP_UPGRADE_MAX_LEVEL, UPGRADABLE_POWERUPS } from "./powerups";
import type { ShopItem } from "./shop";

// Améliorations des power-ups vendues en trophées (QUÊTES › AMÉLIORATIONS,
// retour de jeu du 2026-10-12). Chaque niveau est un article du catalogue
// (SHOP_ITEMS, sorte « upgrade ») : l'achat passe par la même route, le même
// débit atomique et le même inventaire que les cosmétiques, donc sans
// migration (inventory accepte tout identifiant). Le niveau d'un joueur se
// déduit de son inventaire : la plus longue suite de niveaux possédés depuis
// le premier. Ce que fait un niveau (durée) vit dans powerups.ts.

// Identifiant d'article : « upgrade.speed.3 » = 3e niveau de Vitesse. Ne
// jamais renommer un slug : l'inventaire des comptes garde ces chaînes.
export const UPGRADE_SLUGS: Readonly<Record<PowerUpType, string>> = {
  [PowerUpType.Speed]: "speed",
  [PowerUpType.Spin]: "spin",
  [PowerUpType.Magnet]: "magnet",
  [PowerUpType.Shield]: "shield",
  [PowerUpType.Blades]: "blades",
};

// Prix du niveau n (index n − 1), en trophées : 30 × 1,18^(n − 1), arrondi
// à 5. Écrit en clair plutôt que calculé : serveur et client lisent les
// mêmes entiers, sans écart d'arrondi possible entre deux moteurs JS (un
// écart refuserait l'achat, expected_price ≠ prix du catalogue).
// - Les premiers niveaux coûtent une vie correcte (une trentaine de
//   trophées) : on sent le système dès la première session.
// - Chaque niveau apporte autant (+2,5 % de durée) mais coûte 18 % de plus
//   que le précédent : les dix premiers (+25 %) font 710 trophées, une
//   petite heure de jeu (~1 000 trophées par heure, cf. levels.ts) ; les
//   dix suivants, 3 695. L'écart entre un habitué et un joueur régulier
//   reste donc faible, et le maximum se mérite.
// - 4 405 trophées pour un power-up au niveau 20, entre Forge Vermeille
//   (3 500) et Profondeurs Glacées (6 000) ; 17 620 pour les quatre, une
//   quinzaine d'heures de jeu : un objectif de long terme, qui ne vide pas
//   le portefeuille au détriment des cosmétiques (que les autres voient).
export const UPGRADE_PRICES: readonly number[] = [
  30, 35, 40, 50, 60, 70, 80, 95, 115, 135,
  155, 185, 220, 260, 305, 360, 425, 500, 590, 695,
];

export function upgradeItemId(type: PowerUpType, level: number): string {
  return `upgrade.${UPGRADE_SLUGS[type]}.${level}`;
}

// Prix du niveau `level` (1 à 20) ; 0 hors bornes.
export function upgradePrice(level: number): number {
  return Number.isInteger(level) ? UPGRADE_PRICES[level - 1] ?? 0 : 0;
}

// Article d'amélioration → power-up et niveau ; null sinon (id venu d'une
// requête : rien n'est supposé sur sa forme).
export function parseUpgradeItem(id: string): { type: PowerUpType; level: number } | null {
  const m = /^upgrade\.([a-z]+)\.([1-9]\d?)$/.exec(id);
  if (!m) return null;
  const type = UPGRADABLE_POWERUPS.find((t) => UPGRADE_SLUGS[t] === m[1]);
  const level = Number(m[2]);
  if (type === undefined || level > POWERUP_UPGRADE_MAX_LEVEL) return null;
  return { type, level };
}

// Niveau d'un power-up d'après l'inventaire : 1, 2… tant qu'ils se suivent.
// Le serveur vend dans l'ordre (upgradeOrderProblem) ; un trou ne viendrait
// que d'une retouche de la base, et ne donne rien au-delà.
export function upgradeLevelOf(owned: ReadonlySet<string>, type: PowerUpType): number {
  if (!UPGRADABLE_POWERUPS.includes(type)) return 0;
  let level = 0;
  while (level < POWERUP_UPGRADE_MAX_LEVEL && owned.has(upgradeItemId(type, level + 1))) level++;
  return level;
}

// Niveaux de tous les power-ups (index PowerUpType, comme
// Player.powerUpLevels) ; 0 pour ceux qui ne s'améliorent pas.
export function upgradeLevelsFromInventory(owned: Iterable<string>): number[] {
  const set = owned instanceof Set ? (owned as ReadonlySet<string>) : new Set(owned);
  const levels = [0, 0, 0, 0, 0];
  for (const type of UPGRADABLE_POWERUPS) levels[type] = upgradeLevelOf(set, type);
  return levels;
}

// Achat du niveau n : refusé tant que le n − 1 n'est pas possédé. Un niveau
// déjà possédé passe (purchase_item répond already_owned, sans débit).
export function upgradeOrderProblem(itemId: string, owned: Iterable<string>): "upgrade_order" | null {
  const ref = parseUpgradeItem(itemId);
  if (!ref) return null;
  const set = owned instanceof Set ? (owned as ReadonlySet<string>) : new Set(owned);
  return ref.level > upgradeLevelOf(set, ref.type) + 1 ? "upgrade_order" : null;
}

// Bloc généré du catalogue (SHOP_ITEMS) : un article par niveau et par
// power-up améliorable.
export function upgradeShopItems(): Record<string, ShopItem> {
  const items: Record<string, ShopItem> = {};
  for (const type of UPGRADABLE_POWERUPS) {
    for (let level = 1; level <= POWERUP_UPGRADE_MAX_LEVEL; level++) {
      const id = upgradeItemId(type, level);
      items[id] = { id, kind: "upgrade", price: upgradePrice(level) };
    }
  }
  return items;
}
