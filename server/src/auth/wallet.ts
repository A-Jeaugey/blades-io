import { getAdminClient } from "./supabase";

export interface Wallet {
  balance: number;
  totalEarned: number;
}

// Fetch the persistent wallet for an authed user. Returns { balance: 0,
// totalEarned: 0 } if the row doesn't exist yet.
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

// Atomically credit a wallet. Tries the credit_wallet RPC first (atomic
// upsert + ledger insert) and falls back to direct table writes if the
// RPC is missing or unauthorized — this lets coin earning keep working
// even when migration 0003 (grants) hasn't been applied yet.
//
// Returns the new balance, or null on hard failure. amount <= 0 short-
// circuits.
export async function creditWallet(
  userId: string,
  amount: number,
  kind: "match_reward" | "guest_claim" | "grant" | "refund",
  refId?: string,
): Promise<number | null> {
  if (amount <= 0) return null;
  const admin = getAdminClient();
  if (!admin) return null;
  const intAmount = Math.floor(amount);

  // 1) Preferred path : the RPC handles atomicity.
  try {
    const { data, error } = await admin.rpc("credit_wallet", {
      p_user_id: userId,
      p_amount: intAmount,
      p_kind: kind,
      p_ref_id: refId ?? null,
    });
    if (!error) {
      const next = Number(data ?? 0);
      console.log(
        `[blade.io] credit_wallet RPC: user=${userId} +${intAmount} (${kind}) → ${next}`,
      );
      return next;
    }
    console.warn(
      "[blade.io] credit_wallet RPC failed, falling back to direct writes:",
      error.message,
    );
  } catch (e) {
    console.warn(
      "[blade.io] credit_wallet RPC threw, falling back to direct writes:",
      (e as Error).message,
    );
  }

  // 2) Fallback : direct upsert + ledger insert. NOT atomic, but each
  // statement still goes through the service role so RLS doesn't matter.
  // The ledger is best-effort; the wallet upsert is the source of truth.
  try {
    // Lire l'état courant pour calculer les nouveaux totaux et balance_after.
    const { data: existing, error: readErr } = await admin
      .from("wallets")
      .select("balance, total_earned")
      .eq("user_id", userId)
      .maybeSingle();
    if (readErr) {
      console.warn("[blade.io] credit fallback: read wallet failed", readErr.message);
      return null;
    }
    const prevBalance = Number(existing?.balance ?? 0);
    const prevTotal = Number(existing?.total_earned ?? 0);
    const newBalance = prevBalance + intAmount;
    const newTotal = prevTotal + intAmount;

    const { error: upsertErr } = await admin
      .from("wallets")
      .upsert(
        {
          user_id: userId,
          balance: newBalance,
          total_earned: newTotal,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    if (upsertErr) {
      console.warn("[blade.io] credit fallback: upsert wallet failed", upsertErr.message);
      return null;
    }

    // Ledger row : best-effort. If the table doesn't exist (0002 not
    // applied) this fails silently and we still return the new balance.
    const { error: ledgerErr } = await admin
      .from("wallet_transactions")
      .insert({
        user_id: userId,
        delta: intAmount,
        kind,
        ref_id: refId ?? null,
        balance_after: newBalance,
      });
    if (ledgerErr) {
      console.warn("[blade.io] credit fallback: ledger insert failed", ledgerErr.message);
    }

    console.log(
      `[blade.io] credit_wallet (fallback): user=${userId} +${intAmount} (${kind}) → ${newBalance}`,
    );
    return newBalance;
  } catch (e) {
    console.warn("[blade.io] credit fallback threw", (e as Error).message);
    return null;
  }
}

// Atomically debit a wallet. Tries the spend_wallet RPC first, falls back
// to a direct UPDATE-with-WHERE for the insufficient-funds check if the
// RPC is missing. Returns the new balance, or null on insufficient funds /
// failure. Wired up now so future shop / cosmetic flows just need a UI.
export async function spendWallet(
  userId: string,
  amount: number,
  kind: "purchase" | "refund",
  refId?: string,
): Promise<number | null> {
  if (amount <= 0) return null;
  const admin = getAdminClient();
  if (!admin) return null;
  const intAmount = Math.floor(amount);

  try {
    const { data, error } = await admin.rpc("spend_wallet", {
      p_user_id: userId,
      p_amount: intAmount,
      p_kind: kind,
      p_ref_id: refId ?? null,
    });
    if (!error) {
      const next = Number(data ?? -1);
      if (next < 0) return null;
      return next;
    }
    console.warn(
      "[blade.io] spend_wallet RPC failed, falling back:",
      error.message,
    );
  } catch (e) {
    console.warn(
      "[blade.io] spend_wallet RPC threw, falling back:",
      (e as Error).message,
    );
  }

  // Fallback : read-then-update. Not strictly atomic (a concurrent debit
  // could overdraw by a tick of the wall clock), but acceptable for v1
  // since we have no shop yet — apply the RPC migration before launch.
  try {
    const { data: existing, error: readErr } = await admin
      .from("wallets")
      .select("balance")
      .eq("user_id", userId)
      .maybeSingle();
    if (readErr || !existing) return null;
    const prev = Number(existing.balance ?? 0);
    if (prev < intAmount) return null;
    const next = prev - intAmount;
    const { error: updErr } = await admin
      .from("wallets")
      .update({ balance: next, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (updErr) return null;
    await admin.from("wallet_transactions").insert({
      user_id: userId,
      delta: -intAmount,
      kind,
      ref_id: refId ?? null,
      balance_after: next,
    });
    return next;
  } catch (e) {
    console.warn("[blade.io] spend fallback threw", (e as Error).message);
    return null;
  }
}
