// Boutique V2 (tâche 6.4) : mise en avant du jour et prix d'un achat.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FEATURED_COUNT,
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

test("vitrine : trois cosmétiques, un skin et deux autres sortes, jamais ceux de la veille", () => {
  let prev = featuredItems("2026-10-01");
  const seen = new Set(prev);
  for (let i = 1; i <= 400; i++) {
    const day = dayAfter("2026-10-01", i);
    const f = featuredItems(day);
    assert.equal(f.length, FEATURED_COUNT, day);
    assert.equal(new Set(f).size, FEATURED_COUNT, day);
    const kinds = f.map((id) => getShopItem(id)!.kind);
    assert.ok(!kinds.includes("theme"), `${day} : pas de thème de carte`);
    assert.equal(kinds[0], "skin", day);
    assert.equal(new Set(kinds).size, FEATURED_COUNT, `${day} : sortes différentes`);
    for (const id of f) assert.ok(!prev.includes(id), `${day} : ${id} était déjà à la une la veille`);
    f.forEach((id) => seen.add(id));
    prev = f;
  }
  // Tout le catalogue cosmétique finit par passer en vitrine.
  assert.equal(seen.size, 9);
  // Mêmes articles pour tous, quel que soit l'ordre des appels (cache).
  assert.deepEqual(featuredItems("2026-11-15"), featuredItems("2026-11-15"));
  const late = featuredItems("2027-03-01");
  assert.deepEqual(featuredItems("2026-11-15"), featuredItems(dayAfter("2026-11-14", 1)));
  assert.deepEqual(featuredItems("2027-03-01"), late);
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
