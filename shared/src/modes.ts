// Modes de jeu (tâche 7.3) : le registre partagé. Le serveur y lit les modes
// valides et leurs files d'attente, le client son sélecteur du lobby. Les
// règles de chaque mode (apparition, score, fin de partie) vivent côté
// serveur, dans server/src/modes/.

export type GameModeId = "ffa" | "rounds";

export interface GameModeInfo {
  id: GameModeId;
  // Proposé en partie rapide, dans une file publique à lui : on ne tombe
  // jamais dans une partie d'un autre mode que celui choisi.
  quickPlay: boolean;
  // Proposé à la création d'un salon privé.
  privateRoom: boolean;
}

// L'arène sans fin, le jeu d'origine.
export const DEFAULT_GAME_MODE: GameModeId = "ffa";

export const GAME_MODES: readonly GameModeInfo[] = [
  { id: "ffa", quickPlay: true, privateRoom: true },
  // Manches chronométrées (tâche 7.1). Décision D5 : en salon privé et dans
  // une file publique à part, en attendant la télémétrie
  // (life_stats_by_mode, migration 0011).
  { id: "rounds", quickPlay: true, privateRoom: true },
];

export function isGameMode(v: unknown): v is GameModeId {
  return typeof v === "string" && GAME_MODES.some((m) => m.id === v);
}

// Mode demandé par un client : absent (client d'avant 7.3) ou inconnu,
// c'est l'arène sans fin.
export function gameModeOf(v: unknown): GameModeId {
  return isGameMode(v) ? v : DEFAULT_GAME_MODE;
}

// Phase de la partie (ArenaState.phase). Un mode qui a une fin passe en
// entracte, classement figé, avant la partie suivante.
export const MatchPhase = {
  Playing: 0,
  Over: 1,
} as const;
export type MatchPhase = (typeof MatchPhase)[keyof typeof MatchPhase];

// Ligne du classement d'une partie. score : celui du mode (manches : points
// de toute la manche). bonus : trophées du podium crédités à la fin (partie
// publique, joueurs avec un portefeuille), 0 sinon.
export interface MatchStanding {
  id: string;
  name: string;
  bot: boolean;
  score: number;
  kills: number;
  deaths: number;
  bestBlades: number;
  bonus: number;
}

// Fin de partie : classement de tous les joueurs, du premier au dernier, et
// heure du serveur où la suivante commence.
export interface MatchEndEvent {
  standings: MatchStanding[];
  nextAt: number;
}

// ─── Manches chronométrées (tâche 7.1) ──────────────────────────────────────

export const ROUND_DURATION_MS = 5 * 60_000;
// L'arène se resserre pendant la dernière minute, du rayon de la carte
// (MAP_RADIUS) à celui-ci : le dénouement se joue au centre.
export const ROUND_SHRINK_MS = 60_000;
export const ROUND_FINAL_RADIUS = 80;
// Podium, puis manche suivante.
export const ROUND_INTERMISSION_MS = 15_000;
// Trophées du podium (1er, 2e, 3e, bots compris dans le classement),
// parties publiques seulement, comme tous les trophées.
export const ROUND_PODIUM_BONUS: readonly number[] = [150, 100, 50];

// Rayon de l'arène à l'instant now d'une manche qui finit à endsAt : plein
// jusqu'à la dernière minute, puis linéaire jusqu'à ROUND_FINAL_RADIUS.
export function roundArenaRadius(fullRadius: number, now: number, endsAt: number): number {
  const left = endsAt - now;
  if (left >= ROUND_SHRINK_MS) return fullRadius;
  const t = Math.min(1, Math.max(0, 1 - left / ROUND_SHRINK_MS));
  return fullRadius + (ROUND_FINAL_RADIUS - fullRadius) * t;
}
