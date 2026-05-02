import { getAdminClient } from "./supabase";

export interface Wallet {
  balance: number;
  totalEarned: number;
}

// Cached schema status. Filled by ensureWalletSchemaReady() at boot and
// re-checked on demand. null = unknown (not checked yet).
let schemaStatus: {
  walletsTable: boolean;
  txTable: boolean;
  creditRpc: boolean;
  checkedAt: number;
} | null = null;

export function getSchemaStatus() { return schemaStatus; }

// Probe Supabase for the presence of every dependency we need to credit
// coins. Logs a CLEAR actionable message if anything is missing. Idempotent
// and safe to call repeatedly.
export async function ensureWalletSchemaReady(): Promise<void> {
  const admin = getAdminClient();
  if (!admin) {
    console.warn(
      "[blade.io] ⚠ Supabase admin client not configured — coin persistence disabled. " +
        "Set SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in the server env.",
    );
    schemaStatus = { walletsTable: false, txTable: false, creditRpc: false, checkedAt: Date.now() };
    return;
  }
  // wallets table
  let walletsTable = true;
  {
    const { error } = await admin.from("wallets").select("user_id").limit(1);
    if (error) {
      walletsTable = false;
      console.error(
        `[blade.io] ⚠ wallets table unreachable (${error.message}). ` +
          "Apply supabase/migrations/0002_currency.sql to enable coin persistence.",
      );
    }
  }
  // wallet_transactions table
  let txTable = true;
  {
    const { error } = await admin.from("wallet_transactions").select("id").limit(1);
    if (error) {
      txTable = false;
      console.warn(
        `[blade.io] wallet_transactions unreachable (${error.message}) — ledger writes will be skipped.`,
      );
    }
  }
  // credit_wallet RPC : harmless probe with amount=0 will throw (we
  // require > 0), but the error code tells us if the function exists.
  let creditRpc = true;
  {
    const { error } = await admin.rpc("credit_wallet", {
      p_user_id: "00000000-0000-0000-0000-000000000000",
      p_amount: 0,
      p_kind: "match_reward",
      p_ref_id: null,
    });
    // PGRST202 = function not found. Anything else (incl. our own
    // "amount must be > 0" raise) means the function exists.
    if (error && (error as any).code === "PGRST202") {
      creditRpc = false;
      console.warn(
        `[blade.io] credit_wallet RPC missing (${error.message}) — falling back to direct table writes. ` +
          "Apply supabase/migrations/0002_currency.sql + 0003_grant_rpc_execute.sql to enable atomic credits.",
      );
    } else if (error && /permission denied/i.test(error.message)) {
      creditRpc = false;
      console.warn(
        `[blade.io] credit_wallet RPC permission denied (${error.message}) — falling back to direct writes. ` +
          "Apply supabase/migrations/0003_grant_rpc_execute.sql.",
      );
    }
  }
  schemaStatus = { walletsTable, txTable, creditRpc, checkedAt: Date.now() };
  if (walletsTable) {
    console.log(
      `[blade.io] wallet schema OK (rpc=${creditRpc ? "yes" : "fallback"}, ledger=${txTable ? "yes" : "skip"})`,
    );
  }
}

// Fetch the persistent wallet for an authed user. Auto-creates the row
// (insert on conflict do nothing) so a freshly-authenticated player
// always has a wallet to read from, even if the signup trigger from
// migration 0002 never fired (account predates migration).
export async function getWallet(userId: string): Promise<Wallet> {
  const admin = getAdminClient();
  if (!admin) return { balance: 0, totalEarned: 0 };
  try {
    // Lazy seed : harmless if the row already exists.
    if (schemaStatus?.walletsTable !== false) {
      await admin
        .from("wallets")
        .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true })
        .then(() => undefined, () => undefined);
    }
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
// RPC is missing, unauthorized, or otherwise unavailable.
//
// Returns the new balance, or null on hard failure (no wallets table at
// all, missing service role key, etc.).
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

  // 1) Preferred path : the RPC handles atomicity in a single statement.
  if (schemaStatus?.creditRpc !== false) {
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
  }

  // 2) Fallback : direct upsert + ledger insert. NOT atomic, but each
  // statement still goes through the service role so RLS doesn't matter.
  // Lazy-creates the wallet row if missing.
  try {
    // Seed (no-op if row already exists).
    await admin
      .from("wallets")
      .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true })
      .then(() => undefined, () => undefined);

    // Read current balance to compute the new totals + balance_after.
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

    const { error: updErr } = await admin
      .from("wallets")
      .update({
        balance: newBalance,
        total_earned: newTotal,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
    if (updErr) {
      console.error(
        "[blade.io] credit fallback: update wallet FAILED",
        updErr.message,
        "— check that public.wallets table exists (apply 0002_currency.sql).",
      );
      return null;
    }

    // Ledger row : best-effort. If the table doesn't exist we still
    // return the new balance — credits are visible via wallets.balance.
    if (schemaStatus?.txTable !== false) {
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
// to a read-then-update for the insufficient-funds check. Returns the new
// balance, or null on insufficient funds / failure.
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

  if (schemaStatus?.creditRpc !== false) {
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
  }

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
    if (schemaStatus?.txTable !== false) {
      await admin.from("wallet_transactions").insert({
        user_id: userId,
        delta: -intAmount,
        kind,
        ref_id: refId ?? null,
        balance_after: next,
      });
    }
    return next;
  } catch (e) {
    console.warn("[blade.io] spend fallback threw", (e as Error).message);
    return null;
  }
}
