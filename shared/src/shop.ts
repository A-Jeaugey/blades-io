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
import { upgradeShopItems } from "./upgrades";

// Thème de carte (vu par son acheteur seul) ou cosmétique visible par tous
// (cf. cosmetics.ts, dont les emplacements donnent les autres sortes), ou
// niveau d'amélioration d'un power-up (cf. upgrades.ts).
export type ShopItemKind = "theme" | "skin" | "bladeSkin" | "trail" | "killFx" | "upgrade";

export interface ShopItem {
  id: string;
  kind: ShopItemKind;
  // Prix en trophées, strictement positif (un item gratuit n'a pas sa place
  // dans le catalogue).
  price: number;
}

export const SHOP_ITEMS: Readonly<Record<string, ShopItem>> = {
  // Améliorations des power-ups : bloc généré (upgrades.ts), un article par
  // niveau et par power-up, jamais à la une ni remisé.
  ...upgradeShopItems(),
  sanctuaire: { id: "sanctuaire", kind: "theme", price: 1500 },
  "forge-vermeille": { id: "forge-vermeille", kind: "theme", price: 3500 },
  "profondeurs-glacees": { id: "profondeurs-glacees", kind: "theme", price: 6000 },
  // Cosmétiques visibles par tous (tâche 6.2, cf. cosmetics.ts).
  robot: { id: "robot", kind: "skin", price: 1500 },
  renard: { id: "renard", kind: "skin", price: 2000 },
  chevalier: { id: "chevalier", kind: "skin", price: 2500 },
  demon: { id: "demon", kind: "skin", price: 3500 },
  // Deuxième vague (retours du 2026-10-12) : même échelle de prix que la
  // première, par pas de 500, selon le travail de la silhouette (un
  // accessoire simple au bas de l'échelle ; chapeau en trois pièces ou tête
  // de cristal en haut).
  skateur: { id: "skateur", kind: "skin", price: 1500 },
  pousse: { id: "pousse", kind: "skin", price: 1500 },
  martien: { id: "martien", kind: "skin", price: 2000 },
  pilote: { id: "pilote", kind: "skin", price: 2000 },
  dj: { id: "dj", kind: "skin", price: 2000 },
  corbeau: { id: "corbeau", kind: "skin", price: 2500 },
  dandy: { id: "dandy", kind: "skin", price: 2500 },
  samourai: { id: "samourai", kind: "skin", price: 2500 },
  sorcier: { id: "sorcier", kind: "skin", price: 3000 },
  golem: { id: "golem", kind: "skin", price: 3500 },
  noyau: { id: "noyau", kind: "bladeSkin", price: 1200 },
  glitch: { id: "glitch", kind: "bladeSkin", price: 2500 },
  eclat: { id: "eclat", kind: "bladeSkin", price: 1500 },
  battement: { id: "battement", kind: "bladeSkin", price: 2000 },
  charge: { id: "charge", kind: "bladeSkin", price: 2000 },
  damas: { id: "damas", kind: "bladeSkin", price: 2500 },
  plasma: { id: "plasma", kind: "trail", price: 1500 },
  braise: { id: "braise", kind: "trail", price: 2500 },
  prisme: { id: "prisme", kind: "trail", price: 2000 },
  onde: { id: "onde", kind: "trail", price: 2500 },
  helice: { id: "helice", kind: "trail", price: 3000 },
  etoile: { id: "etoile", kind: "killFx", price: 2500 },
  coeur: { id: "coeur", kind: "killFx", price: 3000 },
  tourbillon: { id: "tourbillon", kind: "killFx", price: 3500 },
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
// veille, et chaque article d'une sorte une fois avant qu'un autre revienne.
// Remise de 20 %, arrondie à 50 trophées. Le serveur applique la même
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

// Sortes de la vitrine : les quatre emplacements cosmétiques, jamais les
// thèmes de carte ni une autre sorte d'article du catalogue.
const FEATURED_KINDS: readonly ShopItemKind[] = ["skin", "bladeSkin", "trail", "killFx"];
// Sortes des deux articles qui accompagnent le skin : une reste dehors.
const SIDE_KINDS: readonly ShopItemKind[] = ["bladeSkin", "trail", "killFx"];

// Vitrine d'un jour et ses pioches. Chaque sorte tire ses articles d'un
// paquet mélangé, sans remise, rebattu une fois vide ; la sorte laissée
// dehors aussi. Tous les articles d'une sorte passent donc à la une avant
// qu'un seul revienne. Avec un tirage libre (tout sauf la veille), sur deux
// ans et quatorze skins, un skin restait jusqu'à 83 jours sans passer et les
// passages allaient de 38 à 63 selon le skin.
interface FeaturedDay {
  day: string;
  featured: string[];
  // Sorte laissée dehors ce jour-là.
  out: string | undefined;
  // Articles restants de chaque paquet (et "out" : sortes restantes).
  decks: Readonly<Record<string, readonly string[]>>;
}

function idsOfKind(kind: ShopItemKind): string[] {
  return Object.values(SHOP_ITEMS).filter((i) => i.kind === kind).map((i) => i.id);
}

function shuffled(items: readonly string[], next: () => number): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function featuredDay(day: string, prev: FeaturedDay | null): FeaturedDay {
  const next = seededRandom(`shop:${day}`);
  const yesterday = new Set(prev?.featured ?? []);
  const decks: Record<string, readonly string[]> = { ...prev?.decks };
  // Prochain article d'un paquet. Un paquet neuf ne commence pas par ce qui
  // était à la une la veille (la fin du paquet précédent) : jamais deux
  // jours de suite, même d'un cycle à l'autre.
  const take = (name: string, pool: readonly string[], avoid: ReadonlySet<string>): string | undefined => {
    let deck = decks[name] ?? [];
    if (deck.length === 0) {
      const fresh = shuffled(pool, next);
      const i = fresh.findIndex((id) => !avoid.has(id));
      if (i > 0) [fresh[0], fresh[i]] = [fresh[i], fresh[0]];
      deck = fresh;
    }
    decks[name] = deck.slice(1);
    return deck[0];
  };
  const picked: string[] = [];
  const skin = take("skin", idsOfKind("skin"), yesterday);
  if (skin) picked.push(skin);
  const out = take("out", SIDE_KINDS, new Set(prev?.out ? [prev.out] : []));
  const sides = SIDE_KINDS.filter((k) => k !== out);
  if (next() < 0.5) sides.reverse();
  for (const kind of sides) {
    const id = take(kind, idsOfKind(kind), yesterday);
    if (id && picked.length < FEATURED_COUNT) picked.push(id);
  }
  // Catalogue trop petit pour tout respecter : on complète sans la règle de
  // la veille, jamais avec un doublon.
  for (const kind of FEATURED_KINDS) {
    for (const id of idsOfKind(kind)) {
      if (picked.length < FEATURED_COUNT && !picked.includes(id)) picked.push(id);
    }
  }
  return { day, featured: picked, out, decks };
}

// « Jamais ceux de la veille » et les pioches demandent la vitrine réelle de
// la veille, qui dépend elle-même de l'avant-veille : chaîne depuis le
// premier jour de la vitrine, avec le dernier jour calculé en cache (un pas
// par jour ensuite).
const FEATURED_EPOCH = "2026-10-01";
let lastFeatured: FeaturedDay | null = null;

export function featuredItems(dayKey: string): string[] {
  if (dayKey <= FEATURED_EPOCH) return [...featuredDay(dayKey, null).featured];
  let current = lastFeatured && lastFeatured.day <= dayKey ? lastFeatured : featuredDay(FEATURED_EPOCH, null);
  while (current.day < dayKey) current = featuredDay(nextDay(current.day), current);
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
// vendu. Une amélioration n'est jamais remisée, même glissée dans une
// vitrine : son prix suit sa courbe (upgrades.ts).
export function priceToday(id: string, offer: ShopOffer): number {
  const item = getShopItem(id);
  if (!item) return 0;
  if (item.kind === "upgrade") return item.price;
  return offer.featured.includes(id) ? featuredPrice(item.price) : item.price;
}
