// Boutique V2 (tâche 6.4) : mise en avant du jour et prix d'un achat.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FEATURED_COUNT,
  SHOP_ITEMS,
  ShopItemKind,
  featuredItems,
  featuredPrice,
  getShopItem,
  priceToday,
  shopOffer,
} from "@bladeio/shared";
import { quotePurchase, shopOfferResponse } from "../src/auth/shopQuote";

const dayAfter = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

// Sortes que la vitrine met en avant : les cosmétiques visibles par tous.
const COSMETIC_KINDS: readonly ShopItemKind[] = ["skin", "bladeSkin", "trail", "killFx"];

test("vitrine : trois cosmétiques, un skin et deux autres sortes, jamais ceux de la veille", () => {
  let prev = featuredItems("2026-10-01");
  const seen = new Set(prev);
  for (let i = 1; i <= 400; i++) {
    const day = dayAfter("2026-10-01", i);
    const f = featuredItems(day);
    assert.equal(f.length, FEATURED_COUNT, day);
    assert.equal(new Set(f).size, FEATURED_COUNT, day);
    const kinds = f.map((id) => getShopItem(id)!.kind);
    assert.ok(kinds.every((k) => COSMETIC_KINDS.includes(k)), `${day} : que des cosmétiques (${kinds})`);
    assert.equal(kinds[0], "skin", day);
    assert.equal(new Set(kinds).size, FEATURED_COUNT, `${day} : sortes différentes`);
    for (const id of f) assert.ok(!prev.includes(id), `${day} : ${id} était déjà à la une la veille`);
    f.forEach((id) => seen.add(id));
    prev = f;
  }
  // Tout le catalogue cosmétique finit par passer en vitrine.
  const sold = Object.values(SHOP_ITEMS).filter((i) => COSMETIC_KINDS.includes(i.kind));
  assert.equal(seen.size, sold.length);
  // Mêmes articles pour tous, quel que soit l'ordre des appels (cache).
  assert.deepEqual(featuredItems("2026-11-15"), featuredItems("2026-11-15"));
  const late = featuredItems("2027-03-01");
  assert.deepEqual(featuredItems("2026-11-15"), featuredItems(dayAfter("2026-11-14", 1)));
  assert.deepEqual(featuredItems("2027-03-01"), late);
});

test("vitrine : sur deux ans, chaque article revient vite et aussi souvent que les autres", () => {
  // Pioche sans remise par sorte (shop.ts) : un article ne revient qu'une
  // fois tous ceux de sa sorte passés. Pour une sorte de n articles, deux
  // passages d'un même article sont séparés d'au plus 2n - 2 autres de la
  // sorte ; le skin est là chaque jour, les autres sortes au moins un jour
  // sur deux (la sorte laissée dehors change chaque jour).
  const DAYS = 730;
  const sold = Object.values(SHOP_ITEMS).filter((i) => COSMETIC_KINDS.includes(i.kind));
  const size = (kind: ShopItemKind) => sold.filter((i) => i.kind === kind).length;
  const last = new Map(sold.map((i) => [i.id, -1]));
  const gap = new Map(sold.map((i) => [i.id, 0]));
  const count = new Map(sold.map((i) => [i.id, 0]));
  const skins: string[] = [];
  let prevOut: ShopItemKind | undefined;
  for (let n = 0; n < DAYS; n++) {
    const f = featuredItems(dayAfter("2026-10-01", n));
    skins.push(f[0]);
    const kinds = f.map((id) => getShopItem(id)!.kind);
    const out = COSMETIC_KINDS.slice(1).find((k) => !kinds.includes(k));
    assert.notEqual(out, prevOut, `jour ${n} : la même sorte dehors deux jours de suite`);
    prevOut = out;
    for (const id of f) {
      gap.set(id, Math.max(gap.get(id)!, n - last.get(id)!));
      last.set(id, n);
      count.set(id, count.get(id)! + 1);
    }
  }
  for (const item of sold) {
    const n = size(item.kind);
    const bound = item.kind === "skin" ? 2 * n - 1 : 2 * (2 * n - 1);
    const worst = Math.max(gap.get(item.id)!, DAYS - last.get(item.id)!);
    assert.ok(worst <= bound, `${item.id} : ${worst} jours sans passer à la une (au plus ${bound})`);
  }
  // Mêmes chances pour tous : les skins passent chacun DAYS / n fois, à un
  // près (un paquet entamé).
  const perSkin = DAYS / size("skin");
  for (const item of sold.filter((i) => i.kind === "skin")) {
    assert.ok(Math.abs(count.get(item.id)! - perSkin) <= 1, `${item.id} : ${count.get(item.id)} passages pour ${perSkin.toFixed(1)}`);
  }
  // Tous les skins dans les n premiers jours (premier paquet), et pas dans
  // le même ordre d'un paquet à l'autre : la vitrine ne se devine pas.
  const n = size("skin");
  assert.equal(new Set(skins.slice(0, n)).size, n);
  assert.notDeepEqual(skins.slice(0, n), skins.slice(n, 2 * n));
});

test("vitrine : jour et rotation à l'heure de Paris, remise de 20 % arrondie à 50", () => {
  // 23 h 59 à Paris (heure d'été) le 1er octobre, puis minuit.
  const before = shopOffer(new Date("2026-10-01T21:59:00Z"));
  const after = shopOffer(new Date("2026-10-01T22:00:00Z"));
  assert.equal(before.day, "2026-10-01");
  assert.equal(after.day, "2026-10-02");
  assert.equal(before.endsAt, Date.parse("2026-10-01T22:00:00Z"));
  assert.equal(featuredPrice(1500), 1200);
  assert.equal(featuredPrice(1200), 950);
  assert.equal(featuredPrice(3500), 2800);
  for (const id of before.featured) assert.equal(priceToday(id, before), featuredPrice(getShopItem(id)!.price));
  assert.equal(priceToday("sanctuaire", before), 1500);
  assert.equal(priceToday("recrue", before), 0);
  const res = shopOfferResponse(new Date("2026-10-01T12:00:00Z"));
  assert.deepEqual(Object.keys(res.prices), res.featured);
});

test("achat : prix du jour, prix affiché périmé refusé sans débit", () => {
  const now = new Date("2026-10-05T10:00:00Z");
  const offer = shopOffer(now);
  const featured = offer.featured[0];
  const notFeatured = ["robot", "renard", "chevalier", "demon"].find((id) => !offer.featured.includes(id))!;
  // Le prix débité est celui du jour, remise comprise ; un champ price est ignoré.
  const q1 = quotePurchase({ item_id: featured, price: 0 }, now);
  assert.ok(q1.ok && q1.price === featuredPrice(getShopItem(featured)!.price));
  const q2 = quotePurchase({ item_id: notFeatured }, now);
  assert.ok(q2.ok && q2.price === getShopItem(notFeatured)!.price);
  // Prix affiché égal : accepté ; différent (vitrine d'hier, horloge fausse) : refusé.
  assert.ok(quotePurchase({ item_id: notFeatured, expected_price: getShopItem(notFeatured)!.price }, now).ok);
  const stale = quotePurchase({ item_id: featured, expected_price: getShopItem(featured)!.price }, now);
  assert.deepEqual(stale, { ok: false, status: 409, error: "price_changed", price: featuredPrice(getShopItem(featured)!.price) });
  // Article inconnu, clé du prototype, item gratuit (débloqué au niveau).
  for (const item_id of ["nope", "__proto__", "constructor", "recrue", 42, undefined]) {
    assert.deepEqual(quotePurchase({ item_id }, now), { ok: false, status: 400, error: "invalid_item" });
  }
  assert.deepEqual(quotePurchase(null, now), { ok: false, status: 400, error: "invalid_item" });
});
