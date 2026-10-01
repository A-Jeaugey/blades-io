import {
  ChallengeDef,
  ChallengeState,
  ChallengesResponse,
  LifeChallengeStats,
  METRIC_MODE,
  dailyChallenges,
  lifeValue,
  nextParisMidnight,
  nextParisWeek,
  parisDayKey,
  parisWeekKey,
  weeklyChallenge,
} from "@bladeio/shared";
import { getAdminClient } from "./auth/supabase";

// Défis quotidiens et hebdomadaires (tâche 5.3), côté serveur : progression
// à chaque fin de vie en room publique (fonction SQL advance_challenges,
// migration 0008, qui crédite aussi la récompense), et état pour
// GET /api/challenges.

export interface ChallengeOwner {
  id: string;
  kind: "user" | "guest";
}

export interface ChallengeItem {
  period: string;
  challenge: string;
  value: number;
  mode: "add" | "max";
  target: number;
  reward: number;
}

export interface CompletedChallenge {
  challenge: string;
  reward: number;
}

// Un avertissement par minute au plus : sans la migration 0008, chaque fin
// de vie échoue de la même façon.
let lastWarnAt = 0;
function warn(message: string): void {
  const now = Date.now();
  if (now - lastWarnAt < 60_000) return;
  lastWarnAt = now;
  console.warn("[blade.io] challenges:", message);
}

export function activeChallenges(now: Date): { day: string; week: string; daily: ChallengeDef[]; weekly: ChallengeDef } {
  const day = parisDayKey(now);
  const week = parisWeekKey(now);
  return { day, week, daily: dailyChallenges(day), weekly: weeklyChallenge(week) };
}

// Ce qu'une vie apporte aux défis en cours (rien pour une valeur nulle).
export function challengeItems(life: LifeChallengeStats, now: Date): ChallengeItem[] {
  const { day, week, daily, weekly } = activeChallenges(now);
  const items: ChallengeItem[] = [];
  const add = (period: string, c: ChallengeDef) => {
    const value = lifeValue(c.metric, life);
    if (value <= 0) return;
    items.push({ period, challenge: c.id, value, mode: METRIC_MODE[c.metric], target: c.target, reward: c.reward });
  };
  for (const c of daily) add(day, c);
  add(week, weekly);
  return items;
}

// Fin de vie : progression enregistrée et récompenses créditées par la
// base, en une transaction. Renvoie les défis que cette vie a fait réussir.
export async function advanceChallenges(owner: ChallengeOwner, life: LifeChallengeStats, now: Date = new Date()): Promise<CompletedChallenge[]> {
  const admin = getAdminClient();
  if (!admin) return [];
  const items = challengeItems(life, now);
  if (items.length === 0) return [];
  try {
    const { data, error } = await admin.rpc("advance_challenges", { p_owner: owner.id, p_kind: owner.kind, p_items: items });
    if (error) {
      warn(`advance_challenges failed: ${error.message}`);
      return [];
    }
    return Array.isArray(data) ? (data as CompletedChallenge[]) : [];
  } catch (e) {
    warn(`advance_challenges threw: ${(e as Error).message}`);
    return [];
  }
}

export interface ProgressRow {
  period: string;
  challenge: string;
  progress: number;
  completed_at: string | null;
}

export function toChallengesResponse(rows: ProgressRow[], now: Date): ChallengesResponse {
  const { day, week, daily, weekly } = activeChallenges(now);
  const state = (period: string, c: ChallengeDef): ChallengeState => {
    const row = rows.find((r) => r.period === period && r.challenge === c.id);
    return { ...c, progress: Math.min(c.target, row?.progress ?? 0), completed: !!row?.completed_at };
  };
  return {
    day: { key: day, resetsAt: nextParisMidnight(now).toISOString(), challenges: daily.map((c) => state(day, c)) },
    week: { key: week, resetsAt: nextParisWeek(now).toISOString(), challenge: state(week, weekly) },
  };
}

// État des défis en cours pour un joueur ; sans base, tout à zéro.
export async function getChallenges(owner: ChallengeOwner | null, now: Date = new Date()): Promise<ChallengesResponse> {
  const admin = getAdminClient();
  if (!admin || !owner) return toChallengesResponse([], now);
  const { day, week } = activeChallenges(now);
  try {
    const { data, error } = await admin
      .from("challenge_progress")
      .select("period, challenge, progress, completed_at")
      .eq("owner_id", owner.id)
      .in("period", [day, week]);
    if (error) {
      warn(`fetch failed: ${error.message}`);
      return toChallengesResponse([], now);
    }
    return toChallengesResponse((data as ProgressRow[] | null) ?? [], now);
  } catch (e) {
    warn(`fetch threw: ${(e as Error).message}`);
    return toChallengesResponse([], now);
  }
}
