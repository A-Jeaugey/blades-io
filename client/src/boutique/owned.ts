// ─────────────────────────────────────────────────────────────────────────────
// Ownership — qui possède quoi côté client.
//
// État courant : stockage 100 % localStorage. Suffisant pour la V1 boutique
// (l'achat fonctionne UI-side, le joueur voit ses thèmes possédés persister
// entre sessions sur le même device).
//
// Plan V2 quand le serveur sera prêt : ce module gardera la même API
// publique (isOwned / grantOwnership / listOwned) mais sera adossé à un
// endpoint /api/wallet/inventory côté Supabase. Le localStorage deviendra
// alors un cache lecture, plus la source de vérité.
//
// Les thèmes "système" gratuits (price = 0) sont auto-owned au boot, peu
// importe ce qu'il y a en localStorage. Évite le cas de figure où un user
// efface son storage et perd l'accès au thème par défaut.
// ─────────────────────────────────────────────────────────────────────────────

import { THEMES } from "../themes";

const STORAGE_KEY = "blade.owned";

function autoOwned(): string[] {
  // Tous les thèmes price <= 0 ou sans price (= legacy gratuit).
  return Object.values(THEMES)
    .filter((t) => (t.price ?? 0) <= 0)
    .map((t) => t.id);
}

function loadFromStorage(): Set<string> {
  const owned = new Set<string>(autoOwned());
  if (typeof localStorage === "undefined") return owned;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return owned;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const id of parsed) {
        if (typeof id === "string") owned.add(id);
      }
    }
  } catch {
    // localStorage corrompu — on revient sur les auto-owned only.
  }
  return owned;
}

let ownedSet = loadFromStorage();
const listeners = new Set<() => void>();

function persist(): void {
  if (typeof localStorage === "undefined") return;
  // On stocke seulement les NON auto-owned : les gratuits sont toujours
  // récupérés via autoOwned() au boot, pas la peine de les écrire.
  const auto = new Set(autoOwned());
  const toStore = [...ownedSet].filter((id) => !auto.has(id));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
}

export function isOwned(themeId: string): boolean {
  return ownedSet.has(themeId);
}

export function grantOwnership(themeId: string): void {
  if (ownedSet.has(themeId)) return;
  ownedSet.add(themeId);
  persist();
  for (const l of listeners) {
    try { l(); } catch { /* noop */ }
  }
}

export function listOwned(): string[] {
  return [...ownedSet];
}

// Permet à l'UI (boutique, settings) de se rafraîchir quand le set change.
export function subscribeOwnership(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
