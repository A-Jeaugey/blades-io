import { ShopItem, ShopOffer, getShopItem, priceToday, shopOffer } from "@bladeio/shared";

// Prix d'un achat (tâches 0.1 et 6.4) : l'article vient du catalogue partagé
// (SHOP_ITEMS), le prix est celui du jour (remise s'il est à la une), jamais
// celui de la requête. Le client envoie en plus le prix qu'il affichait
// (expected_price) : s'il diffère, rien n'est débité (rotation à minuit
// pendant l'achat, horloge de l'appareil fausse) et le client reçoit le prix
// du jour. Le prix envoyé ne sert qu'à comparer, jamais à débiter.
export type PurchaseQuote =
  | { ok: true; item: ShopItem; price: number }
  | { ok: false; status: 400 | 409; error: "invalid_item" | "price_changed"; price?: number };

export function quotePurchase(body: unknown, now: Date): PurchaseQuote {
  const b = (body ?? {}) as { item_id?: unknown; expected_price?: unknown };
  const item = getShopItem(typeof b.item_id === "string" ? b.item_id : "");
  if (!item) return { ok: false, status: 400, error: "invalid_item" };
  const price = priceToday(item.id, shopOffer(now));
  if (typeof b.expected_price === "number" && b.expected_price !== price) {
    return { ok: false, status: 409, error: "price_changed", price };
  }
  return { ok: true, item, price };
}

// Vitrine du jour pour GET /api/shop : l'heure du serveur fait foi (celle de
// l'appareil peut être fausse ; now lui permet de caler le compte à rebours).
export function shopOfferResponse(now: Date): ShopOffer & { now: number; prices: Record<string, number> } {
  const offer = shopOffer(now);
  return {
    ...offer,
    now: now.getTime(),
    prices: Object.fromEntries(offer.featured.map((id) => [id, priceToday(id, offer)])),
  };
}
