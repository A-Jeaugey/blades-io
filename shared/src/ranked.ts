// Mode classé (retours du 2026-10-12) : des manches chronométrées comme
// « rounds », qui rapportent ou coûtent des points de rang (PR) selon le
// score de la manche. Fonctions pures, partagées : le serveur calcule le
// gain à la fin de chaque manche, le client affiche rangs et emblèmes.

import { ROUND_DURATION_MS } from "./modes";

// ─── Rangs ──────────────────────────────────────────────────────────────────
// Six rangs ; les cinq premiers ont trois divisions (III, la plus basse, à
// I) de 100 PR chacune ; Maître commence à 1 500 PR et n'a pas de plafond.
export const RANK_TIERS = ["bronze", "silver", "gold", "platinum", "diamond", "master"] as const;
export type RankTier = (typeof RANK_TIERS)[number];
export const RANK_DIVISIONS = 3;
export const RANK_DIVISION_PR = 100;
export const MASTER_PR = (RANK_TIERS.length - 1) * RANK_DIVISIONS * RANK_DIVISION_PR;

export interface RankInfo {
  tier: RankTier;
  // 0 (Bronze) à 5 (Maître).
  tierIndex: number;
  // 3, 2 ou 1 (I est la plus haute) ; 0 pour Maître.
  division: number;
  // PR du début de la division, et de la suivante (null en Maître).
  floor: number;
  next: number | null;
  // Avancée dans la division, de 0 à 1 (1 en Maître).
  progress: number;
}

export function rankOf(pr: number): RankInfo {
  const p = Number.isFinite(pr) ? Math.max(0, Math.floor(pr)) : 0;
  if (p >= MASTER_PR) {
    return { tier: "master", tierIndex: RANK_TIERS.length - 1, division: 0, floor: MASTER_PR, next: null, progress: 1 };
  }
  const step = Math.floor(p / RANK_DIVISION_PR);
  const tierIndex = Math.floor(step / RANK_DIVISIONS);
  const floor = step * RANK_DIVISION_PR;
  return {
    tier: RANK_TIERS[tierIndex],
    tierIndex,
    division: RANK_DIVISIONS - (step % RANK_DIVISIONS),
    floor,
    next: floor + RANK_DIVISION_PR,
    progress: (p - floor) / RANK_DIVISION_PR,
  };
}

// Même rang et même division : sinon, promotion ou rétrogradation.
export function sameRank(a: RankInfo, b: RankInfo): boolean {
  return a.tierIndex === b.tierIndex && a.division === b.division;
}

// ─── Points de rang d'une manche ────────────────────────────────────────────
// Score de manche attendu à un PR donné : plus on est haut, plus il faut
// marquer pour monter. Calibré sur des manches de 5 min avec bots (micro-
// mesure du 2026-10-12, six graines) : un joueur qui ne fait que ramasser
// les lames au sol finit à ~210 points (de 160 à 250), le plus souvent
// premier devant les bots ; les meilleurs bots d'une manche font 100 à 290.
// Avec la prime du podium, ce joueur passif plafonne vers Argent I (~520 PR,
// attente ~310) ; il faut ~450 points par manche pour approcher Maître, et
// un débutant qui meurt souvent (~100 points) reste en Bronze. À revoir sur
// les vraies manches classées.
export const RANKED_EXPECTED_BASE = 120;
// Points de plus attendus par division (100 PR).
export const RANKED_EXPECTED_PER_DIVISION = 36;
// Gain d'une manche : RANKED_PERF_PR × (score − attendu) / attendu, plus la
// prime du podium (1er, 2e, 3e, bots compris), borné. Une manche à zéro
// point coûte le maximum, -30 ; deux fois l'attendu rapporte +30.
export const RANKED_PERF_PR = 30;
export const RANKED_PODIUM_PR: readonly number[] = [10, 6, 3];
export const RANKED_DELTA_MIN = -30;
export const RANKED_DELTA_MAX = 50;
// Quitter une manche commencée depuis plus d'une minute (départ, onglet
// fermé, connexion perdue sans retour) : la pire défaite, pour qu'on ne
// gagne jamais à fuir une mauvaise manche.
export const RANKED_LEAVE_PR = RANKED_DELTA_MIN;
// Présence minimale dans une manche pour qu'elle compte (gain à la fin, ou
// pénalité de départ). Arrivé plus tard, on joue la manche sans PR ; arrivé
// en cours, l'attente est proportionnelle au temps joué.
export const RANKED_MIN_PRESENCE_MS = 60_000;
// Saison suivante (shared/src/seasons.ts, six semaines) : on repart de la
// moitié de ses PR de la dernière saison jouée.
export const RANKED_SEASON_CARRY = 0.5;
// Classement d'une saison : 50 premiers au plus.
export const RANKED_BOARD_LIMIT = 50;

export function expectedScore(pr: number): number {
  const p = Number.isFinite(pr) ? Math.max(0, pr) : 0;
  return RANKED_EXPECTED_BASE + (RANKED_EXPECTED_PER_DIVISION * p) / RANK_DIVISION_PR;
}

// Part de la manche jouée, de 0 à 1 (arrivé en cours de manche).
export function roundPresence(playedMs: number): number {
  return Math.min(1, Math.max(0, playedMs / ROUND_DURATION_MS));
}

export interface RankedRound {
  // PR avant la manche.
  pr: number;
  // Score de la manche (classement du mode, toutes les vies).
  score: number;
  // Rang à la fin de la manche, 0 = premier (bots compris).
  rank: number;
  // Part de la manche jouée (roundPresence), 1 par défaut.
  presence?: number;
}

export interface RankedDelta {
  // Gain (ou perte) de la manche, borné ; le total ne descend jamais sous 0
  // (applyDelta).
  delta: number;
  // Score attendu, au prorata du temps joué.
  expected: number;
  // Part du podium dans le gain.
  podium: number;
}

export function rankedDelta(r: RankedRound): RankedDelta {
  const presence = Math.min(1, Math.max(0.01, r.presence ?? 1));
  const expected = expectedScore(r.pr) * presence;
  const score = Number.isFinite(r.score) ? Math.max(0, r.score) : 0;
  const perf = Math.round((RANKED_PERF_PR * (score - expected)) / expected);
  const podium = RANKED_PODIUM_PR[r.rank] ?? 0;
  const delta = Math.min(RANKED_DELTA_MAX, Math.max(RANKED_DELTA_MIN, perf + podium));
  return { delta, expected: Math.round(expected), podium };
}

// Nouveau total : jamais sous 0.
export function applyDelta(pr: number, delta: number): number {
  return Math.max(0, Math.floor(pr) + Math.round(delta));
}

// PR de départ d'une saison, d'après le total de la dernière saison jouée
// (même calcul que la fonction SQL apply_ranked_delta, migration 0013).
export function seasonStartPr(previous: number): number {
  return Math.floor(Math.max(0, previous) * RANKED_SEASON_CARRY);
}

// ─── Messages et API ────────────────────────────────────────────────────────

// Fin d'une manche classée, serveur → le joueur concerné :
// - scored : PR avant et après (écrits en base), et le détail du calcul ;
// - guest : pas de compte, pas de PR (invitation à se connecter) ;
// - late : arrivé dans la dernière minute de jeu, manche non classée ;
// - unavailable : classement injoignable (base, migration absente).
export type RankedResultStatus = "scored" | "guest" | "late" | "unavailable";
export interface RankedResultEvent {
  status: RankedResultStatus;
  before?: number;
  after?: number;
  score?: number;
  expected?: number;
  podium?: number;
  season?: number;
}

// GET /api/ranked/me : rang du joueur connecté dans la saison en cours.
// Avant sa première manche de la saison, ses PR de départ (réinitialisation
// douce) et rank null.
export interface RankedMeResponse {
  season: { number: number; endsAt: string };
  pr: number;
  games: number;
  best: number;
  rank: number | null;
}

export interface RankedBoardEntry {
  user_id: string;
  username: string;
  pr: number;
  games: number;
}

// GET /api/ranked/leaderboard
export interface RankedBoardResponse {
  season: { number: number; endsAt: string };
  entries: RankedBoardEntry[];
  me: { rank: number; pr: number } | null;
}
