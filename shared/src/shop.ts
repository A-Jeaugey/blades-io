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

export type ShopItemKind = "theme";

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
