import {
  LeaderboardEntry,
  LeaderboardPeriod,
  LeaderboardResponse,
  SEASON_REWARDS,
  periodBounds,
  seasonAt,
  seasonInfo,
} from "@bladeio/shared";
import { getAdminClient } from "./auth/supabase";

// Classements temporaires et saisons (tâche 5.4), côté serveur.

let lastWarnAt = 0;
function warn(message: string): void {
  const now = Date.now();
  if (now - lastWarnAt < 60_000) return;
  lastWarnAt = now;
  console.warn("[blade.io] leaderboard:", message);
}

// Classement d'une période, et le rang du joueur connecté s'il y a joué.
export async function getLeaderboard(period: LeaderboardPeriod, limit: number, userId: string | null, now: Date = new Date()): Promise<LeaderboardResponse> {
  const season = seasonAt(now);
  const res: LeaderboardResponse = {
    period,
    entries: [],
    season: { number: season.number, endsAt: season.endsAt.toISOString() },
    me: null,
  };
  const admin = getAdminClient();
  if (!admin) return res;
  const bounds = periodBounds(period, now);
  try {
    if (bounds) {
      const range = { p_since: bounds.since.toISOString(), p_until: bounds.until.toISOString() };
      const { data, error } = await admin.rpc("leaderboard_since", { ...range, p_limit: limit });
      if (error) throw new Error(error.message);
      res.entries = (data as LeaderboardEntry[] | null) ?? [];
      if (userId) {
        const rank = await admin.rpc("player_rank_since", { p_user: userId, ...range });
        const row = (rank.data as Array<{ rank: number; score: number }> | null)?.[0];
        if (!rank.error && row) res.me = { rank: Number(row.rank), score: Number(row.score) };
      }
    } else {
      const { data, error } = await admin
        .from("leaderboard_top")
        .select("user_id, username, score, kills, max_blades, survival_seconds, games_played")
        .limit(limit);
      if (error) throw new Error(error.message);
      res.entries = (data as LeaderboardEntry[] | null) ?? [];
      if (userId) {
        const mine = await admin.from("leaderboard_top").select("score").eq("user_id", userId).maybeSingle();
        const best = (mine.data as { score: number } | null)?.score;
        if (!mine.error && best !== undefined) {
          const better = await admin.from("leaderboard_top").select("user_id", { count: "exact", head: true }).gt("score", best);
          if (!better.error && better.count !== null) res.me = { rank: better.count + 1, score: best };
        }
      }
    }
  } catch (e) {
    warn((e as Error).message);
    throw e;
  }
  return res;
}

// Délai avant de clore une saison : laisse arriver les dernières parties
// (vie finie juste avant minuit, horloge de la base un peu en retard).
const CLOSE_GRACE_MS = 120_000;

// Clôture des saisons terminées : la base récompense les dix premiers une
// seule fois (close_season, migration 0009). Les deux dernières, au cas où
// le serveur était arrêté au changement de saison.
export async function closeFinishedSeasons(now: Date = new Date()): Promise<void> {
  const admin = getAdminClient();
  if (!admin) return;
  const current = seasonAt(now).number;
  for (const n of [current - 2, current - 1]) {
    if (n < 1) continue;
    const s = seasonInfo(n);
    if (now.getTime() - s.endsAt.getTime() < CLOSE_GRACE_MS) continue;
    const { data, error } = await admin.rpc("close_season", {
      p_season: n,
      p_start: s.startsAt.toISOString(),
      p_end: s.endsAt.toISOString(),
      p_rewards: SEASON_REWARDS,
    });
    if (error) warn(`close_season ${n}: ${error.message}`);
    else if (Number(data) > 0) console.log(`[blade.io] season ${n} closed: ${data} players rewarded`);
  }
}

// Au démarrage puis toutes les heures.
export function scheduleSeasonClosing(): void {
  const run = () => void closeFinishedSeasons().catch((e) => warn((e as Error).message));
  run();
  setInterval(run, 3_600_000).unref();
}
