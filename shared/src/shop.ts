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

import { nextParisMidnight, parisDayKey, seededRandom } from "./challenges";

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

// ─── Mise en avant du jour (tâche 6.4) ──────────────────────────────────────
// Trois cosmétiques vendus, les mêmes pour tous, renouvelés à minuit (heure de
// Paris) : un skin et deux articles de sortes différentes, jamais ceux de la
// veille. Remise de 20 %, arrondie à 50 trophées. Le serveur applique la même
// règle au moment de l'achat (prix du jour) ; le client ne fait que l'afficher.
// Les thèmes de carte n'y passent pas : la vitrine sert les cosmétiques que
// les autres voient.

export const FEATURED_COUNT = 3;
export const FEATURED_DISCOUNT = 0.2;

export interface ShopOffer {
  // Jour de Paris (« 2026-10-01 ») et articles à la une.
  day: string;
  featured: string[];
  // Prochaine rotation (ms depuis l'epoch).
  endsAt: number;
}

function nextDay(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function drawFeatured(dayKey: string, exclude: ReadonlySet<string>): string[] {
  const next = seededRandom(`shop:${dayKey}`);
  const cosmetics = Object.values(SHOP_ITEMS).filter((i) => i.kind !== "theme");
  const pickFrom = (pool: ShopItem[]): ShopItem | undefined => pool[Math.floor(next() * pool.length)];
  const fresh = (i: ShopItem) => !exclude.has(i.id);
  const picked: ShopItem[] = [];
  const skin = pickFrom(cosmetics.filter((i) => i.kind === "skin" && fresh(i)))
    ?? pickFrom(cosmetics.filter((i) => i.kind === "skin"));
  if (skin) picked.push(skin);
  // Les autres sortes dans un ordre tiré au sort, une par article.
  const kinds: ShopItemKind[] = ["bladeSkin", "trail", "killFx"];
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
  }
  for (const kind of kinds) {
    if (picked.length >= FEATURED_COUNT) break;
    const item = pickFrom(cosmetics.filter((i) => i.kind === kind && fresh(i)));
    if (item) picked.push(item);
  }
  // Catalogue trop petit pour tout respecter : on complète sans la règle de
  // la veille, jamais avec un doublon.
  for (const item of cosmetics) {
    if (picked.length >= FEATURED_COUNT) break;
    if (!picked.includes(item)) picked.push(item);
  }
  return picked.map((i) => i.id);
}

// « Jamais ceux de la veille » demande la vitrine réelle de la veille, qui
// dépend elle-même de l'avant-veille : chaîne depuis le premier jour de la
// vitrine, avec le dernier jour calculé en cache (un pas par jour ensuite).
const FEATURED_EPOCH = "2026-10-01";
let lastFeatured: { day: string; featured: string[] } | null = null;

export function featuredItems(dayKey: string): string[] {
  if (dayKey <= FEATURED_EPOCH) return drawFeatured(dayKey, new Set());
  let current = lastFeatured && lastFeatured.day <= dayKey
    ? lastFeatured
    : { day: FEATURED_EPOCH, featured: drawFeatured(FEATURED_EPOCH, new Set()) };
  while (current.day < dayKey) {
    const day = nextDay(current.day);
    current = { day, featured: drawFeatured(day, new Set(current.featured)) };
  }
  lastFeatured = current;
  return [...current.featured];
}

export function shopOffer(now: Date): ShopOffer {
  const day = parisDayKey(now);
  return { day, featured: featuredItems(day), endsAt: nextParisMidnight(now).getTime() };
}

export function featuredPrice(price: number): number {
  return Math.round((price * (1 - FEATURED_DISCOUNT)) / 50) * 50;
}

// Prix d'un article ce jour-là (remise s'il est à la une) ; 0 s'il n'est pas
// vendu.
export function priceToday(id: string, offer: ShopOffer): number {
  const item = getShopItem(id);
  if (!item) return 0;
  return offer.featured.includes(id) ? featuredPrice(item.price) : item.price;
}
