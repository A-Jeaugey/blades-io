import { parisDayKey } from "./challenges";

// Saisons (tâche 5.4) : six semaines, du lundi minuit (heure de Paris) au
// lundi minuit six semaines plus tard. Le classement de saison repart de
// zéro à chaque saison ; à la fin, les dix premiers reçoivent des trophées.
export const SEASON_WEEKS = 6;
// Premier jour de la saison 1 (un lundi).
export const SEASON_ONE_START = "2026-09-28";
// Récompenses de fin de saison, du 1er au 10e (trophées, donc XP).
export const SEASON_REWARDS: readonly number[] = [1000, 750, 500, 250, 250, 250, 250, 250, 250, 250];

const DAY_MS = 86400000;

// Jours entiers entre deux dates du calendrier (« 2026-09-28 »).
function dayIndex(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function keyOfIndex(index: number): string {
  return new Date(index * DAY_MS).toISOString().slice(0, 10);
}

// Instant de minuit, heure de Paris, au début du jour donné.
export function parisMidnight(dayKey: string): Date {
  // Paris est à UTC+1 ou UTC+2 : minuit tombe la veille à 22 h ou 23 h UTC.
  let t = dayIndex(dayKey) * DAY_MS - 2 * 3600000;
  while (parisDayKey(new Date(t)) !== dayKey) t += 60000;
  return new Date(t);
}

export interface SeasonInfo {
  // 1, 2, 3… ; 0 avant la première saison.
  number: number;
  startsAt: Date;
  endsAt: Date;
}

export function seasonAt(date: Date): SeasonInfo {
  const days = dayIndex(parisDayKey(date)) - dayIndex(SEASON_ONE_START);
  const length = SEASON_WEEKS * 7;
  const number = Math.floor(days / length) + 1;
  return seasonInfo(Math.max(0, number));
}

export function seasonInfo(number: number): SeasonInfo {
  const length = SEASON_WEEKS * 7;
  const first = dayIndex(SEASON_ONE_START);
  const start = number <= 0 ? first - length : first + (number - 1) * length;
  return {
    number,
    startsAt: parisMidnight(keyOfIndex(start)),
    endsAt: parisMidnight(keyOfIndex(start + length)),
  };
}

// Classements (tâche 5.4) : du jour, de la semaine, de la saison, de tous
// les temps. Parties publiques seulement.
export type LeaderboardPeriod = "day" | "week" | "season" | "all";
export const LEADERBOARD_PERIODS: readonly LeaderboardPeriod[] = ["day", "week", "season", "all"];

// Période en cours [since, until) ; null pour « tous les temps ».
export function periodBounds(period: LeaderboardPeriod, now: Date): { since: Date; until: Date } | null {
  if (period === "all") return null;
  if (period === "season") {
    const s = seasonAt(now);
    return { since: s.startsAt, until: s.endsAt };
  }
  const today = dayIndex(parisDayKey(now));
  if (period === "day") {
    return { since: parisMidnight(keyOfIndex(today)), until: parisMidnight(keyOfIndex(today + 1)) };
  }
  // Semaine ISO : du lundi au lundi suivant (getUTCDay : 0 = dimanche).
  const monday = today - ((new Date(today * DAY_MS).getUTCDay() + 6) % 7);
  return { since: parisMidnight(keyOfIndex(monday)), until: parisMidnight(keyOfIndex(monday + 7)) };
}

export interface LeaderboardEntry {
  user_id: string;
  username: string;
  score: number;
  kills: number;
  max_blades: number;
  survival_seconds: number;
  games_played: number;
}

// GET /api/leaderboard?period=…
export interface LeaderboardResponse {
  period: LeaderboardPeriod;
  entries: LeaderboardEntry[];
  season: { number: number; endsAt: string };
  // Rang du joueur connecté sur la période, s'il y a joué.
  me: { rank: number; score: number } | null;
}
