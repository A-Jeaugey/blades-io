import type { GameModeId, KillCause } from "@bladeio/shared";
import type { ArenaState } from "../state/ArenaState";
import type { Player } from "../state/Player";

export interface Point {
  x: number;
  y: number;
}

// Ce que la room met à la disposition d'un mode.
export interface ModeHost {
  readonly state: ArenaState;
  readonly isPrivate: boolean;
  // Termine la partie : classement figé et annoncé à tous (matchEnd), vies
  // en cours enregistrées, simulation à l'arrêt pendant l'entracte, puis
  // nouvelle partie (arène vidée, tout le monde réapparaît, onMatchStart).
  endMatch(intermissionMs: number): void;
}

// Règles d'un mode de jeu (tâche 7.3). La room appelle ces hooks aux moments
// clés ; le reste de la simulation (combat, ramassage, lancers, butin) est
// commun à tous les modes.
export interface GameMode {
  readonly id: GameModeId;
  // Arrivée d'un joueur, humain ou bot, avant sa première apparition (pas
  // encore dans state.players).
  onJoin(p: Player): void;
  // Point d'apparition : arrivée, réapparition, nouvelle partie.
  spawnPoint(p: Player): Point;
  // Un joueur mort peut-il réapparaître maintenant ?
  canRespawn(p: Player): boolean;
  // Élimination, une fois le butin et le score du tueur réglés.
  onKill(victim: Player, killer: Player | null, cause: KillCause): void;
  // Score du classement (résumé de la room, podium d'un mode à fin).
  standingScore(p: Player): number;
  // Une fois par tick de jeu, simulation faite : minuteries, fin de partie
  // (host.endMatch). Pas appelé pendant l'entracte.
  tick(now: number): void;
  // Nouvelle partie : joueurs réapparus, phase de jeu.
  onMatchStart(now: number): void;
}
