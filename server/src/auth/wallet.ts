import { getAdminClient } from "./supabase";

// Ces wrappers appellent les RPC Postgres (security definer) via le client
// service_role. Ils sont best-effort : en cas d'erreur on log et on
// retourne une valeur neutre — la gameplay loop ne doit jamais bloquer
// sur une indisponibilité Supabase.

export interface WalletSnapshot {
  balance: number;
  total_earned: number;
}

export async function creditWallet(userId: string, amount: number): Promise<void> {
  const admin = getAdminClient();
  if (!admin || amount <= 0) return;
  try {
    const { error } = await admin.rpc("credit_wallet", {
      p_user_id: userId,
      p_amount: Math.floor(amount),
    });
    if (error) console.warn("[blade.io] credit_wallet failed", error.message);
  } catch (e) {
    console.warn("[blade.io] credit_wallet threw", (e as Error).message);
  }
}

export async function creditGuestWallet(guestId: string, amount: number): Promise<void> {
  const admin = getAdminClient();
  if (!admin || amount <= 0) return;
  try {
    const { error } = await admin.rpc("credit_guest_wallet", {
      p_guest_id: guestId,
      p_amount: Math.floor(amount),
    });
    if (error) console.warn("[blade.io] credit_guest_wallet failed", error.message);
  } catch (e) {
    console.warn("[blade.io] credit_guest_wallet threw", (e as Error).message);
  }
}

export async function getWallet(userId: string): Promise<WalletSnapshot | null> {
  const admin = getAdminClient();
  if (!admin) return null;
  try {
    const { data, error } = await admin
      .from("wallets")
      .select("balance, total_earned")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      console.warn("[blade.io] getWallet failed", error.message);
      return null;
    }
    if (!data) return { balance: 0, total_earned: 0 };
    return {
      balance: Number(data.balance ?? 0),
      total_earned: Number(data.total_earned ?? 0),
    };
  } catch (e) {
    console.warn("[blade.io] getWallet threw", (e as Error).message);
    return null;
  }
}

export async function getGuestWalletBalance(guestId: string): Promise<{ balance: number; claimed: boolean } | null> {
  const admin = getAdminClient();
  if (!admin) return null;
  try {
    const { data, error } = await admin
      .from("guest_wallets")
      .select("balance, claimed_by")
      .eq("guest_id", guestId)
      .maybeSingle();
    if (error) {
      console.warn("[blade.io] getGuestWalletBalance failed", error.message);
      return null;
    }
    if (!data) return null;
    return {
      balance: Number(data.balance ?? 0),
      claimed: data.claimed_by !== null,
    };
  } catch (e) {
    console.warn("[blade.io] getGuestWalletBalance threw", (e as Error).message);
    return null;
  }
}

export async function createGuestWallet(): Promise<string | null> {
  const admin = getAdminClient();
  if (!admin) return null;
  try {
    const { data, error } = await admin
      .from("guest_wallets")
      .insert({})
      .select("guest_id")
      .single();
    if (error || !data) {
      console.warn("[blade.io] createGuestWallet failed", error?.message);
      return null;
    }
    return String(data.guest_id);
  } catch (e) {
    console.warn("[blade.io] createGuestWallet threw", (e as Error).message);
    return null;
  }
}

export interface ClaimResult {
  transferred: number;
  new_balance: number;
}

export async function claimGuestWallet(userId: string, guestId: string): Promise<ClaimResult | { error: string }> {
  const admin = getAdminClient();
  if (!admin) return { error: "supabase_not_configured" };
  try {
    const { data, error } = await admin.rpc("claim_guest_wallet", {
      p_user_id: userId,
      p_guest_id: guestId,
    });
    if (error) {
      const msg = (error as any).message ?? "";
      if (msg.includes("guest_already_claimed")) {
        return { error: "guest_already_claimed" };
      }
      console.warn("[blade.io] claim_guest_wallet failed", msg);
      return { error: "claim_failed" };
    }
    const obj = (data ?? {}) as { transferred?: number; new_balance?: number };
    return {
      transferred: Number(obj.transferred ?? 0),
      new_balance: Number(obj.new_balance ?? 0),
    };
  } catch (e) {
    console.warn("[blade.io] claim_guest_wallet threw", (e as Error).message);
    return { error: "claim_failed" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Boutique : achat atomique d'un item + lecture de l'inventaire.
// ─────────────────────────────────────────────────────────────────────────────

export interface PurchaseResult {
  ok: boolean;
  error?: string;
  new_balance?: number;
}

export async function purchaseItem(
  userId: string,
  itemId: string,
  price: number,
): Promise<PurchaseResult> {
  const admin = getAdminClient();
  if (!admin) return { ok: false, error: "supabase_not_configured" };
  try {
    const { data, error } = await admin.rpc("purchase_item", {
      p_user_id: userId,
      p_item_id: itemId,
      p_price: Math.floor(price),
    });
    if (error) {
      console.warn("[blade.io] purchase_item failed", error.message);
      return { ok: false, error: "rpc_failed" };
    }
    const obj = (data ?? {}) as { ok?: boolean; error?: string; new_balance?: number };
    return {
      ok: !!obj.ok,
      error: obj.error,
      new_balance: obj.new_balance != null ? Number(obj.new_balance) : undefined,
    };
  } catch (e) {
    console.warn("[blade.io] purchase_item threw", (e as Error).message);
    return { ok: false, error: "purchase_failed" };
  }
}

export async function getInventory(userId: string): Promise<string[]> {
  const admin = getAdminClient();
  if (!admin) return [];
  try {
    const { data, error } = await admin
      .from("inventory")
      .select("item_id")
      .eq("user_id", userId);
    if (error) {
      console.warn("[blade.io] getInventory failed", error.message);
      return [];
    }
    return (data ?? []).map((r) => String((r as { item_id: unknown }).item_id));
  } catch (e) {
    console.warn("[blade.io] getInventory threw", (e as Error).message);
    return [];
  }
}
