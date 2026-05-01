// Persistent storage for the most recent guest-coin token issued by the
// server. The token encapsulates the coins earned across the current guest
// session ; if the player later signs up / logs in we replay it against
// /api/wallet/claim-guest to credit the freshly-created wallet.
//
// Only one token at a time : each new server message overwrites the
// previous one (the server already accumulates the running total).

const KEY = "blade.guestCoinsToken";

export function setGuestCoinsToken(token: string): void {
  try { localStorage.setItem(KEY, token); } catch { /* noop */ }
}

export function getGuestCoinsToken(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function clearGuestCoinsToken(): void {
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
}

// POST the stored guest token to the server. Returns the credited amount
// (0 if the user had nothing pending), or null on hard failure.
export async function claimGuestCoins(accessToken: string): Promise<{ credited: number; balance: number } | null> {
  const token = getGuestCoinsToken();
  if (!token) return { credited: 0, balance: 0 };
  try {
    const r = await fetch("/api/wallet/claim-guest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ token }),
    });
    if (!r.ok) {
      // 400 = invalid_token (expired or wrong secret) → drop it.
      if (r.status === 400) clearGuestCoinsToken();
      return null;
    }
    const j = await r.json();
    // Successfully credited (even if amount was 0) → drop the token so we
    // never replay it.
    clearGuestCoinsToken();
    return { credited: Number(j.credited ?? 0), balance: Number(j.balance ?? 0) };
  } catch {
    return null;
  }
}
