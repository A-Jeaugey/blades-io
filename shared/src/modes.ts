// Modes de jeu (tâche 7.3) : le registre partagé. Le serveur y lit les modes
// valides et leurs files d'attente, le client son sélecteur du lobby. Les
// règles de chaque mode (apparition, score, fin de partie) vivent côté
// serveur, dans server/src/modes/.

export type GameModeId = "ffa";

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

// Fin de partie : classement de tous les joueurs, du premier au dernier, et
// heure du serveur où la suivante commence.
export interface MatchEndEvent {
  standings: Array<[id: string, name: string, score: number, isBot: boolean]>;
  nextAt: number;
}
