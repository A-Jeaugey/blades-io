import { getAdminClient } from "./supabase";
import { creditWallet } from "./wallet";

export interface MatchRecord {
  userId: string;
  score: number;
  kills: number;
  maxBlades: number;
  survivalSeconds: number;
  cratesDestroyed: number;
  powerupsCollected: number;
  roomCode?: string;
}

// Persist a finished match for an authenticated user, then credit the
// wallet with the score (1 point = 1 coin). No-op if Supabase isn't
// configured (guest-only deployment) — we never want a missing env to
// break the gameplay loop.
//
// Returns the new wallet balance after the credit (or null if the credit
// didn't happen, e.g. score == 0). The caller can use that to push a
// fresh balance to the live Player.coins field.
export async function recordMatch(rec: MatchRecord): Promise<number | null> {
  const admin = getAdminClient();
  if (!admin) return null;
  // Don't pollute the table with single-second griefer rows.
  if (rec.score <= 0 && rec.kills === 0 && rec.maxBlades <= 3) return null;
  let matchId: string | null = null;
  try {
    const { data, error } = await admin
      .from("matches")
      .insert({
        user_id: rec.userId,
        score: Math.floor(rec.score),
        kills: Math.floor(rec.kills),
        max_blades: Math.floor(rec.maxBlades),
        survival_seconds: Math.floor(rec.survivalSeconds),
        crates_destroyed: Math.floor(rec.cratesDestroyed),
        powerups_collected: Math.floor(rec.powerupsCollected),
        room_code: rec.roomCode || null,
      })
      .select("id")
      .maybeSingle();
    if (error) {
      console.warn("[blade.io] recordMatch failed", error.message);
      return null;
    }
    matchId = (data?.id as string | undefined) ?? null;
  } catch (e) {
    console.warn("[blade.io] recordMatch threw", (e as Error).message);
    return null;
  }
  // Credit the wallet : 1 point = 1 coin. Score==0 short-circuits inside
  // creditWallet, so no need to gate here.
  if (rec.score > 0) {
    const newBalance = await creditWallet(
      rec.userId,
      Math.floor(rec.score),
      "match_reward",
      matchId ?? undefined,
    );
    if (newBalance == null) {
      console.warn(
        `[blade.io] match credit returned null (score=${rec.score}, user=${rec.userId})`,
      );
    }
    return newBalance;
  }
  return null;
}
