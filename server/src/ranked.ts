import {
  RANKED_BOARD_LIMIT,
  RANKED_SEASON_CARRY,
  RankedBoardEntry,
  RankedBoardResponse,
  RankedMeResponse,
  nameProblem,
  seasonAt,
} from "@bladeio/shared";
import { getAdminClient } from "./auth/supabase";

// Mode classé, côté base (migration 0013_ranked.sql) : PR d'un compte dans
// la saison en cours, gain ou perte d'une manche, classement de la saison.
// Sans Supabase, ou sans la migration, rien ne casse : les lectures
// renvoient null (le client affiche le classement indisponible) et les
// écritures ne font rien.

// Un avertissement par minute au plus : sans la migration, chaque fin de
// manche et chaque lecture échouent de la même façon.
let lastWarnAt = 0;
function warn(message: string): void {
  const now = Date.now();
  if (now - lastWarnAt < 60_000) return;
  lastWarnAt = now;
  console.warn("[blade.io] ranked:", message);
}

function seasonOf(now: Date): { number: number; endsAt: string } {
  const s = seasonAt(now);
  return { number: s.number, endsAt: s.endsAt.toISOString() };
}

function int(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

// Rang du joueur dans la saison en cours (ses PR de départ avant sa première
// manche) ; null sans base ou si elle refuse.
export async function getRankedStatus(userId: string, now: Date = new Date()): Promise<RankedMeResponse | null> {
  const admin = getAdminClient();
  if (!admin) return null;
  const season = seasonOf(now);
  try {
    const { data, error } = await admin.rpc("ranked_status", { p_user: userId, p_season: season.number, p_carry: RANKED_SEASON_CARRY });
    if (error) {
      warn(`ranked_status failed: ${error.message}`);
      return null;
    }
    const row = (data ?? {}) as { pr?: unknown; games?: unknown; best?: unknown; rank?: unknown };
    return { season, pr: int(row.pr), games: int(row.games), best: int(row.best), rank: row.rank == null ? null : int(row.rank) };
  } catch (e) {
    warn(`ranked_status threw: ${(e as Error).message}`);
    return null;
  }
}

export interface RankedApplied {
  before: number;
  after: number;
  games: number;
  best: number;
  season: number;
}

// Gain (ou perte) d'une manche, ou pénalité d'un départ : appliqué par la
// base en une transaction (plancher à 0, réinitialisation douce à la
// première manche de la saison). Null si rien n'a été écrit.
export async function applyRankedDelta(userId: string, delta: number, now: Date = new Date()): Promise<RankedApplied | null> {
  const admin = getAdminClient();
  if (!admin) return null;
  const season = seasonAt(now).number;
  try {
    const { data, error } = await admin.rpc("apply_ranked_delta", {
      p_user: userId,
      p_season: season,
      p_delta: Math.round(delta),
      p_carry: RANKED_SEASON_CARRY,
    });
    if (error) {
      warn(`apply_ranked_delta failed: ${error.message}`);
      return null;
    }
    const row = (data ?? {}) as { before?: unknown; after?: unknown; games?: unknown; best?: unknown };
    return { before: int(row.before), after: int(row.after), games: int(row.games), best: int(row.best), season };
  } catch (e) {
    warn(`apply_ranked_delta threw: ${(e as Error).message}`);
    return null;
  }
}

// Classement de la saison en cours, et le rang du joueur connecté s'il y a
// joué. Null si la base refuse (migration absente) ; sans base, vide.
export async function getRankedLeaderboard(limit: number, userId: string | null, now: Date = new Date()): Promise<RankedBoardResponse | null> {
  const season = seasonOf(now);
  const res: RankedBoardResponse = { season, entries: [], me: null };
  const admin = getAdminClient();
  if (!admin) return res;
  const n = Math.min(Math.max(Math.floor(limit) || RANKED_BOARD_LIMIT, 1), RANKED_BOARD_LIMIT);
  try {
    const { data, error } = await admin.rpc("ranked_leaderboard", { p_season: season.number, p_limit: n });
    if (error) {
      warn(`ranked_leaderboard failed: ${error.message}`);
      return null;
    }
    // Pseudo insultant ou réservé (tâche 5.6) : masqué, comme les autres
    // classements.
    res.entries = ((data as RankedBoardEntry[] | null) ?? []).map((e) => ({
      user_id: e.user_id,
      username: e.username && nameProblem(e.username) !== null ? "***" : e.username,
      pr: int(e.pr),
      games: int(e.games),
    }));
  } catch (e) {
    warn(`ranked_leaderboard threw: ${(e as Error).message}`);
    return null;
  }
  if (userId) {
    const me = await getRankedStatus(userId, now);
    if (me && me.rank !== null) res.me = { rank: me.rank, pr: me.pr };
  }
  return res;
}
