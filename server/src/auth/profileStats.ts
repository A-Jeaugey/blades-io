import { PROFILE_RECENT_GAMES, ProfileGame, ProfileStats } from "@bladeio/shared";
import { getAdminClient } from "./supabase";

// Ligne de la vue player_stats (migration 0007). PostgREST renvoie les
// bigint en nombres.
export interface PlayerStatsRow {
  games: number;
  kills: number;
  best_score: number;
  best_kills: number;
  best_blades: number;
  survival_seconds: number;
  best_survival_seconds: number;
  crates: number;
  powerups: number;
  first_played_at: string | null;
}

export interface MatchRow {
  score: number;
  kills: number;
  max_blades: number;
  survival_seconds: number;
  created_at: string;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Réponse de GET /api/profile/stats. betterPlayers : nombre de joueurs au
// meilleur score strictement supérieur (null si inconnu).
export function toProfileStats(row: PlayerStatsRow | null, recent: MatchRow[], betterPlayers: number | null): ProfileStats {
  const games = num(row?.games);
  const recentGames: ProfileGame[] = recent.slice(0, PROFILE_RECENT_GAMES).map((m) => ({
    score: num(m.score),
    kills: num(m.kills),
    maxBlades: num(m.max_blades),
    survivalSeconds: num(m.survival_seconds),
    at: m.created_at,
  }));
  return {
    games,
    kills: num(row?.kills),
    bestScore: num(row?.best_score),
    bestKills: num(row?.best_kills),
    bestBlades: num(row?.best_blades),
    avgSurvivalSeconds: games > 0 ? Math.round(num(row?.survival_seconds) / games) : 0,
    bestSurvivalSeconds: num(row?.best_survival_seconds),
    crates: num(row?.crates),
    powerups: num(row?.powerups),
    firstPlayedAt: games > 0 ? row?.first_played_at ?? null : null,
    rank: games > 0 && betterPlayers !== null ? betterPlayers + 1 : null,
    recent: recentGames,
  };
}

// Statistiques d'un compte, parties publiques seulement (comme le
// classement). null si la base ne répond pas.
export async function getProfileStats(userId: string): Promise<ProfileStats | null> {
  const admin = getAdminClient();
  if (!admin) return null;
  try {
    const [statsRes, recentRes] = await Promise.all([
      admin.from("player_stats").select("*").eq("user_id", userId).maybeSingle(),
      admin
        .from("matches")
        .select("score, kills, max_blades, survival_seconds, created_at")
        .eq("user_id", userId)
        .is("room_code", null)
        .order("created_at", { ascending: false })
        .limit(PROFILE_RECENT_GAMES),
    ]);
    if (statsRes.error || recentRes.error) {
      console.warn("[blade.io] profile stats failed", (statsRes.error ?? recentRes.error)?.message);
      return null;
    }
    const row = (statsRes.data as PlayerStatsRow | null) ?? null;
    let better: number | null = null;
    if (row && num(row.games) > 0) {
      // Rang : joueurs dont le meilleur score dépasse strictement le sien.
      const rankRes = await admin
        .from("leaderboard_top")
        .select("user_id", { count: "exact", head: true })
        .gt("score", num(row.best_score));
      if (!rankRes.error && rankRes.count !== null) better = rankRes.count;
    }
    return toProfileStats(row, (recentRes.data as MatchRow[] | null) ?? [], better);
  } catch (e) {
    console.warn("[blade.io] profile stats threw", (e as Error).message);
    return null;
  }
}
