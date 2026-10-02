// Modes de jeu (tâche 7.3) : le registre partagé. Le serveur y lit les modes
// valides et leurs files d'attente, le client son sélecteur du lobby. Les
// règles de chaque mode (apparition, score, fin de partie) vivent côté
// serveur, dans server/src/modes/.

export type GameModeId = "ffa" | "rounds" | "tdm" | "lts" | "ctf";

export interface GameModeInfo {
  id: GameModeId;
  // Proposé en partie rapide, dans une file publique à lui : on ne tombe
  // jamais dans une partie d'un autre mode que celui choisi.
  quickPlay: boolean;
  // Proposé à la création d'un salon privé.
  privateRoom: boolean;
  // L'arène se resserre pendant la dernière minute (roundArenaRadius).
  shrinks: boolean;
  // On réapparaît après une élimination (dernière équipe en vie : non,
  // on regarde la fin de la manche).
  respawns: boolean;
  // Évènements de carte (tâche 4.4) : pas dans les modes à objectif
  // (dernière équipe en vie, drapeau), qu'ils détourneraient.
  mapEvents: boolean;
  // Arène dont la taille suit la population (tâche 4.5) ; les modes équipe
  // gardent la carte entière, pour leurs camps à 160 u du centre.
  adaptiveArena: boolean;
}

// L'arène sans fin, le jeu d'origine.
export const DEFAULT_GAME_MODE: GameModeId = "ffa";

export const GAME_MODES: readonly GameModeInfo[] = [
  { id: "ffa", quickPlay: true, privateRoom: true, shrinks: false, respawns: true, mapEvents: true, adaptiveArena: true },
  // Manches chronométrées (tâche 7.1). Décision D5 : en salon privé et dans
  // une file publique à part, en attendant la télémétrie
  // (life_stats_by_mode, migration 0011).
  { id: "rounds", quickPlay: true, privateRoom: true, shrinks: true, respawns: true, mapEvents: true, adaptiveArena: true },
  // Modes équipe (tâche 7.2) : en salon privé, entre amis, bots en option
  // (le remplissage par des bots rééquilibre les équipes). La partie rapide
  // garde l'arène et les manches, pour ne pas disperser les joueurs.
  { id: "tdm", quickPlay: false, privateRoom: true, shrinks: false, respawns: true, mapEvents: true, adaptiveArena: false },
  { id: "lts", quickPlay: false, privateRoom: true, shrinks: true, respawns: false, mapEvents: false, adaptiveArena: false },
  { id: "ctf", quickPlay: false, privateRoom: true, shrinks: false, respawns: true, mapEvents: false, adaptiveArena: false },
];

export function modeShrinks(id: string): boolean {
  return GAME_MODES.some((m) => m.id === id && m.shrinks);
}

export function modeHasAdaptiveArena(id: string): boolean {
  return GAME_MODES.some((m) => m.id === id && m.adaptiveArena);
}

export function modeHasMapEvents(id: string): boolean {
  return GAME_MODES.some((m) => m.id === id && m.mapEvents);
}

export function modeRespawns(id: string): boolean {
  return !GAME_MODES.some((m) => m.id === id && !m.respawns);
}

export function isTeamMode(id: string): boolean {
  return id === "tdm" || id === "lts" || id === "ctf";
}

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
  // Équipe (TEAM_NONE hors modes équipe).
  team: number;
  score: number;
  kills: number;
  deaths: number;
  bestBlades: number;
  bonus: number;
}

// Fin de partie : classement de tous les joueurs, du premier au dernier, et
// heure du serveur où la suivante commence. Modes équipe : le score de
// chaque équipe, l'équipe gagnante (0 : égalité) et le meilleur joueur.
export interface MatchEndEvent {
  standings: MatchStanding[];
  nextAt: number;
  teams?: { scores: [number, number]; winner: number };
  mvp?: string;
}

// ─── Équipes (tâche 7.2) ────────────────────────────────────────────────────
// Player.team : 0 hors équipe (arène, manches), 1 ou 2. Les deux équipes
// partent de côtés opposés de l'arène, sur l'axe x.

export const TEAM_NONE = 0;
export const TEAMS = [1, 2] as const;
export type TeamId = (typeof TEAMS)[number];
// Centre du camp de chaque équipe : apparitions (et bases du drapeau).
export const TEAM_BASE_X = 160;
export const TEAM_SPAWN_RADIUS = 55;

export function teamBase(team: number): { x: number; y: number } {
  return { x: team === 1 ? -TEAM_BASE_X : TEAM_BASE_X, y: 0 };
}

// Deux joueurs de la même équipe : ni clash, ni élimination, ni lancer
// entre eux ; visibles l'un pour l'autre dans les buissons. Hors équipe
// (TEAM_NONE), personne n'est allié.
export function sameTeam(a: number, b: number): boolean {
  return a !== TEAM_NONE && a === b;
}

export function otherTeam(team: number): number {
  return team === 1 ? 2 : team === 2 ? 1 : TEAM_NONE;
}

// Team Deathmatch : la première équipe à 30 éliminations, ou la meilleure
// au bout de 5 minutes.
export const TDM_DURATION_MS = 5 * 60_000;
export const TDM_KILL_TARGET = 30;

// Dernière équipe en vie : pas de réapparition pendant la manche ; trois
// minutes au plus, l'arène se resserrant pendant la dernière (comme une
// manche, cf. roundArenaRadius).
export const LTS_DURATION_MS = 3 * 60_000;

// Capture du drapeau : trois captures, ou la meilleure équipe au bout de
// 8 minutes. Un drapeau lâché revient à sa base au bout de 20 s, ou dès
// qu'un joueur de son équipe le touche.
export const CTF_DURATION_MS = 8 * 60_000;
export const CTF_CAPTURE_TARGET = 3;
export const CTF_FLAG_RETURN_MS = 20_000;
// Contact avec un drapeau (centre du joueur), et rayon de la base où l'on
// rapporte le drapeau adverse.
export const CTF_FLAG_TOUCH_RADIUS = 4;
export const CTF_BASE_RADIUS = 9;
// Points du joueur au classement de la partie : une capture vaut quatre
// éliminations (SCORE_KILL), rapporter son drapeau une.
export const CTF_CAPTURE_POINTS = 60;
export const CTF_RETURN_POINTS = 15;

// Évènement d'un drapeau, serveur → tous (les drapeaux ne se cachent pas) :
// pris, lâché à la mort ou au départ du porteur, rentré à sa base, capturé.
export type FlagEventKind = "take" | "drop" | "return" | "capture";
export interface FlagEvent {
  kind: FlagEventKind;
  // Équipe du drapeau.
  team: number;
  // Joueur en cause ; absent quand le drapeau rentre seul (délai écoulé,
  // lâché dans le mur).
  playerId?: string;
  name?: string;
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
