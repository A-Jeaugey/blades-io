import { getAdminClient } from "./supabase";

export interface Wallet {
  balance: number;
  totalEarned: number;
}

// Fetch the persistent wallet for an authed user. Returns { balance: 0,
// totalEarned: 0 } if the row doesn't exist yet (signup trigger seeds it,
// but pre-migration accounts get a zero-fallback here too).
export async function getWallet(userId: string): Promise<Wallet> {
  const admin = getAdminClient();
  if (!admin) return { balance: 0, totalEarned: 0 };
  try {
    const { data, error } = await admin
      .from("wallets")
      .select("balance, total_earned")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      console.warn("[blade.io] getWallet failed", error.message);
      return { balance: 0, totalEarned: 0 };
    }
    if (!data) return { balance: 0, totalEarned: 0 };
    return {
      balance: Number(data.balance ?? 0),
      totalEarned: Number(data.total_earned ?? 0),
    };
  } catch (e) {
    console.warn("[blade.io] getWallet threw", (e as Error).message);
    return { balance: 0, totalEarned: 0 };
  }
}

// Atomically credit a wallet via the credit_wallet RPC. Returns the new
// balance, or null on failure. Amounts <= 0 are silently ignored — guest
// players with no kills still call into here.
export async function creditWallet(
  userId: string,
  amount: number,
  kind: "match_reward" | "guest_claim" | "grant" | "refund",
  refId?: string,
): Promise<number | null> {
  if (amount <= 0) return null;
  const admin = getAdminClient();
  if (!admin) return null;
  try {
    const { data, error } = await admin.rpc("credit_wallet", {
      p_user_id: userId,
      p_amount: Math.floor(amount),
      p_kind: kind,
      p_ref_id: refId ?? null,
    });
    if (error) {
      console.warn("[blade.io] creditWallet RPC failed", error.message);
      return null;
    }
    return Number(data ?? 0);
  } catch (e) {
    console.warn("[blade.io] creditWallet threw", (e as Error).message);
    return null;
  }
}

// Atomically debit a wallet via the spend_wallet RPC. Returns the new
// balance, or null if the wallet has insufficient funds / on RPC failure.
// Wired up now so the rest of the codebase can rely on it for future
// purchase flows (skins, blade cosmetics) without a second migration.
export async function spendWallet(
  userId: string,
  amount: number,
  kind: "purchase" | "refund",
  refId?: string,
): Promise<number | null> {
  if (amount <= 0) return null;
  const admin = getAdminClient();
  if (!admin) return null;
  try {
    const { data, error } = await admin.rpc("spend_wallet", {
      p_user_id: userId,
      p_amount: Math.floor(amount),
      p_kind: kind,
      p_ref_id: refId ?? null,
    });
    if (error) {
      console.warn("[blade.io] spendWallet RPC failed", error.message);
      return null;
    }
    const next = Number(data ?? -1);
    if (next < 0) return null; // insufficient funds
    return next;
  } catch (e) {
    console.warn("[blade.io] spendWallet threw", (e as Error).message);
    return null;
  }
}
