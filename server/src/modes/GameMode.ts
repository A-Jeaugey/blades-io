import type { GameModeId, KillCause, MatchEndEvent, MatchStanding } from "@bladeio/shared";
import type { ArenaState } from "../state/ArenaState";
import type { Player } from "../state/Player";
import type { BotGoal } from "../systems/bots";

export interface Point {
  x: number;
  y: number;
}

// Ce que le classement retient d'un joueur (résumé de la room, podium).
export interface PlayerStanding {
  // Score du mode (arène : vie en cours ; manches : toute la manche).
  score: number;
  kills: number;
  deaths: number;
  bestBlades: number;
}

// Ce que la room met à la disposition d'un mode.
export interface ModeHost {
  readonly state: ArenaState;
  readonly isPrivate: boolean;
  // Termine la partie : classement figé et annoncé à tous (matchEnd), vies
  // en cours enregistrées, simulation à l'arrêt pendant l'entracte, puis
  // nouvelle partie (arène vidée, tout le monde réapparaît, onMatchStart).
  endMatch(intermissionMs: number): void;
  // Évènement de partie pour tous les clients, estampillé du tick courant
  // (cf. TickStamped) : à ne pas utiliser pour une position à cacher.
  emit(type: string, payload: object): void;
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
  // Ligne du classement (résumé de la room, podium d'un mode à fin).
  standing(p: Player): PlayerStanding;
  // Trophées du rang (0 = premier) à la fin d'une partie, crédités par la
  // room aux humains des parties publiques.
  rankBonus(rank: number): number;
  // Une fois par tick de jeu, simulation faite : minuteries, fin de partie
  // (host.endMatch). Pas appelé pendant l'entracte.
  tick(now: number): void;
  // Nouvelle partie : joueurs réapparus, phase de jeu.
  onMatchStart(now: number): void;

  // Hooks facultatifs (modes équipe, tâche 7.2).
  // Résultat d'équipe de la partie (scores, gagnante, MVP), ajouté à
  // l'évènement matchEnd.
  matchResult?(standings: MatchStanding[]): Pick<MatchEndEvent, "teams" | "mvp">;
  // Un joueur qui arrive en cours de partie apparaît-il tout de suite ?
  // (Dernière équipe en vie : non, il attend la manche suivante.)
  spawnsOnJoin?(p: Player): boolean;
  // Le remplissage par les bots peut-il en ajouter un maintenant ?
  botsMayJoin?(): boolean;
  // Les bots éliminés restent-ils dans la partie jusqu'à sa fin (classement,
  // podium) au lieu d'être retirés aussitôt ?
  keepsEliminatedBots?(): boolean;
  // Départ définitif d'un joueur (drapeau qu'il portait…).
  onLeave?(p: Player): void;
  // Objectif d'un bot propre au mode (aller chercher un drapeau…), mis en
  // balance avec ses autres envies (cf. BotController.setGoals).
  botGoal?(bot: Player): BotGoal | null;
}
