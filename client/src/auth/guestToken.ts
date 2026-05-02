// Token guest signé HMAC côté serveur. On le persiste en localStorage pour
// que la même "identité guest" survive aux refresh de page → un joueur qui
// joue 5 parties en mode invité accumule ses trophées sur la même ligne
// guest_wallets, et au sign-in tout est transféré d'un coup.
//
// Si fetch /api/guest/init échoue (Supabase down, env manquante), on retourne
// null : le joueur joue quand même, simplement ses trophées ne sont pas
// trackés (graceful degradation).

const KEY = "blade.guest_token";

let inflight: Promise<string | null> | null = null;

export function getGuestToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setGuestToken(token: string): void {
  try {
    localStorage.setItem(KEY, token);
  } catch { /* noop */ }
}

export function clearGuestToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch { /* noop */ }
}

// Provisionne un token guest si aucun n'est en cache. Idempotent : un seul
// fetch en vol à la fois (debounce simple via inflight).
export async function ensureGuestToken(): Promise<string | null> {
  const cached = getGuestToken();
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await fetch("/api/guest/init", { method: "POST" });
      if (!r.ok) return null;
      const j = await r.json();
      const token = typeof j?.token === "string" ? j.token : null;
      if (token) setGuestToken(token);
      return token;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export interface GuestWallet {
  balance: number;
  claimed: boolean;
}

export async function fetchGuestWallet(): Promise<GuestWallet | null> {
  const token = getGuestToken();
  if (!token) return null;
  try {
    const r = await fetch(`/api/guest/wallet?token=${encodeURIComponent(token)}`);
    if (!r.ok) return null;
    const j = await r.json();
    return {
      balance: Number(j?.balance ?? 0),
      claimed: Boolean(j?.claimed),
    };
  } catch {
    return null;
  }
}
