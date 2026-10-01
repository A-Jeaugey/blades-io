import { ShopOffer, getShopItem, priceToday, shopOffer } from "@bladeio/shared";

// Vitrine du jour (tâche 6.4) : celle du serveur (GET /api/shop), dont
// l'heure fait foi ; à défaut (serveur injoignable), calculée sur l'appareil.
// Le prix affiché part avec l'achat (expected_price) : si la vitrine a
// tourné entre-temps, le serveur refuse sans débiter.

let offer: ShopOffer = shopOffer(new Date());
// Fin de la vitrine sur l'horloge de l'appareil (décalage avec le serveur
// corrigé).
let localEndsAt = offer.endsAt;
let rotation = 0;
const listeners = new Set<() => void>();

function isOffer(j: unknown): j is ShopOffer & { now: number } {
  const o = j as Partial<ShopOffer & { now: number }> | null;
  return !!o && typeof o.day === "string" && Array.isArray(o.featured)
    && o.featured.every((id) => typeof id === "string")
    && typeof o.endsAt === "number" && typeof o.now === "number";
}

export async function refreshOffer(): Promise<void> {
  let next: ShopOffer = shopOffer(new Date());
  let ends = next.endsAt;
  try {
    const r = await fetch("/api/shop");
    const j = r.ok ? await r.json() : null;
    if (isOffer(j)) {
      next = { day: j.day, featured: j.featured.filter((id) => getShopItem(id) !== undefined), endsAt: j.endsAt };
      ends = Date.now() + (j.endsAt - j.now);
    }
  } catch { /* réseau : vitrine calculée sur l'appareil */ }
  offer = next;
  localEndsAt = ends;
  // Nouvelle vitrine à minuit (heure de Paris), boutique ouverte ou non.
  window.clearTimeout(rotation);
  rotation = window.setTimeout(() => void refreshOffer(), Math.max(5000, localEndsAt - Date.now() + 2000));
  for (const l of listeners) l();
}

export function getOffer(): ShopOffer {
  return offer;
}

export function msUntilRotation(): number {
  return Math.max(0, localEndsAt - Date.now());
}

export function isFeatured(id: string): boolean {
  return offer.featured.includes(id);
}

// Prix du jour, et prix barré s'il est remisé.
export function priceOf(id: string): { price: number; was?: number } {
  const base = getShopItem(id)?.price ?? 0;
  const price = priceToday(id, offer);
  return price < base ? { price, was: base } : { price };
}

export function subscribeOffer(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
