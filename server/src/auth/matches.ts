import { getAdminClient } from "./supabase";

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

// Persist a finished match for an authenticated user. No-op if Supabase
// isn't configured (guest-only deployment) — we never want a missing env to
// break the gameplay loop.
export async function recordMatch(rec: MatchRecord): Promise<void> {
  const admin = getAdminClient();
  if (!admin) return;
  // Don't pollute the table with single-second griefer rows.
  if (rec.score <= 0 && rec.kills === 0 && rec.maxBlades <= 3) return;
  try {
    const { error } = await admin.from("matches").insert({
      user_id: rec.userId,
      score: Math.floor(rec.score),
      kills: Math.floor(rec.kills),
      max_blades: Math.floor(rec.maxBlades),
      survival_seconds: Math.floor(rec.survivalSeconds),
      crates_destroyed: Math.floor(rec.cratesDestroyed),
      powerups_collected: Math.floor(rec.powerupsCollected),
      room_code: rec.roomCode || null,
    });
    if (error) {
      console.warn("[blade.io] recordMatch failed", error.message);
    }
  } catch (e) {
    console.warn("[blade.io] recordMatch threw", (e as Error).message);
  }
}
