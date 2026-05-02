// Wallet client : helpers pour lire le solde de l'user authed et déclencher
// le claim depuis localStorage. Le solde est cached et exposé via un
// listener (pour que LoginScreen / DeathScreen rafraîchissent leur badge
// sans refetch chaque fois).

import { auth } from "./supabase";
import { clearGuestToken, getGuestToken } from "./guestToken";

export interface Wallet {
  balance: number;
  total_earned: number;
}

type Listener = (w: Wallet | null) => void;

class WalletService {
  private current: Wallet | null = null;
  private listeners: Set<Listener> = new Set();
  private fetchInflight: Promise<Wallet | null> | null = null;

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    try { l(this.current); } catch { /* noop */ }
    return () => this.listeners.delete(l);
  }

  get(): Wallet | null {
    return this.current;
  }

  private setState(w: Wallet | null): void {
    this.current = w;
    for (const l of this.listeners) {
      try { l(w); } catch { /* noop */ }
    }
  }

  async refresh(): Promise<Wallet | null> {
    const token = auth.getAccessToken();
    if (!token) {
      this.setState(null);
      return null;
    }
    if (this.fetchInflight) return this.fetchInflight;
    this.fetchInflight = (async () => {
      try {
        const r = await fetch("/api/wallet", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) return null;
        const j = await r.json();
        const w: Wallet = {
          balance: Number(j?.balance ?? 0),
          total_earned: Number(j?.total_earned ?? 0),
        };
        this.setState(w);
        return w;
      } catch {
        return null;
      } finally {
        this.fetchInflight = null;
      }
    })();
    return this.fetchInflight;
  }

  // Tente de transférer le solde guest courant vers le wallet de l'user
  // authed. No-op si pas de guest token ou pas authed. Idempotent : si déjà
  // claimé, le serveur retourne transferred=0 et on efface le token quand
  // même (rien à faire avec).
  async claimGuestIfAny(): Promise<{ transferred: number; new_balance: number } | null> {
    const accessToken = auth.getAccessToken();
    const guestToken = getGuestToken();
    if (!accessToken || !guestToken) return null;
    try {
      const r = await fetch("/api/wallet/claim", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ guest_token: guestToken }),
      });
      if (r.status === 409) {
        // Token réutilisé (claimé par un autre user) → on le jette.
        clearGuestToken();
        return null;
      }
      if (!r.ok) return null;
      const j = await r.json();
      const result = {
        transferred: Number(j?.transferred ?? 0),
        new_balance: Number(j?.new_balance ?? 0),
      };
      // Une fois claimé, le token n'a plus aucune valeur : on l'efface pour
      // que la prochaine session guest (sign-out) reparte avec un nouvel id.
      clearGuestToken();
      this.setState({ balance: result.new_balance, total_earned: Math.max(this.current?.total_earned ?? 0, result.new_balance) });
      // Un refresh derrière pour récupérer le total_earned exact côté serveur.
      void this.refresh();
      return result;
    } catch {
      return null;
    }
  }
}

export const wallet = new WalletService();
