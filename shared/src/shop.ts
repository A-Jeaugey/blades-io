// Catalogue de la boutique : source de vérité des prix, partagée entre le
// serveur (validation d'un achat) et le client (affichage). Le client
// n'envoie jamais de prix : il envoie un identifiant d'item, le serveur
// retrouve le prix ici. Avant ce catalogue, /api/wallet/purchase débitait
// le prix fourni par le client, donc n'importe quel compte pouvait tout
// acheter pour 0 trophée.
//
// Un cosmétique absent du catalogue est gratuit et possédé par tous (cas du
// thème neon). Pour rendre un nouveau thème payant, il faut donc l'ajouter
// ici, sinon il sera distribué gratuitement.

// Thème de carte (vu par son acheteur seul) ou cosmétique visible par tous
// (cf. cosmetics.ts, dont les emplacements donnent les autres sortes).
export type ShopItemKind = "theme" | "skin" | "bladeSkin" | "trail" | "killFx";

export interface ShopItem {
  id: string;
  kind: ShopItemKind;
  // Prix en trophées, strictement positif (un item gratuit n'a pas sa place
  // dans le catalogue).
  price: number;
}

export const SHOP_ITEMS: Readonly<Record<string, ShopItem>> = {
  sanctuaire: { id: "sanctuaire", kind: "theme", price: 1500 },
  "forge-vermeille": { id: "forge-vermeille", kind: "theme", price: 3500 },
  "profondeurs-glacees": { id: "profondeurs-glacees", kind: "theme", price: 6000 },
  // Cosmétiques visibles par tous (tâche 6.2, cf. cosmetics.ts).
  robot: { id: "robot", kind: "skin", price: 1500 },
  renard: { id: "renard", kind: "skin", price: 2000 },
  chevalier: { id: "chevalier", kind: "skin", price: 2500 },
  demon: { id: "demon", kind: "skin", price: 3500 },
  noyau: { id: "noyau", kind: "bladeSkin", price: 1200 },
  glitch: { id: "glitch", kind: "bladeSkin", price: 2500 },
  plasma: { id: "plasma", kind: "trail", price: 1500 },
  braise: { id: "braise", kind: "trail", price: 2500 },
  nova: { id: "nova", kind: "killFx", price: 3000 },
};

// hasOwnProperty et non SHOP_ITEMS[id] seul : l'id vient d'une requête HTTP,
// et "constructor" ou "__proto__" résoudraient sinon vers le prototype
// d'Object (valeur truthy sans prix).
export function getShopItem(id: string): ShopItem | undefined {
  return Object.prototype.hasOwnProperty.call(SHOP_ITEMS, id) ? SHOP_ITEMS[id] : undefined;
}

// Prix affiché d'un cosmétique : 0 s'il n'est pas vendu.
export function shopPrice(id: string): number {
  return getShopItem(id)?.price ?? 0;
}
