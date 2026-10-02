import {
  GameModeId,
  LTS_DURATION_MS,
  MAP_RADIUS,
  MatchEndEvent,
  MatchStanding,
  ROUND_INTERMISSION_MS,
  TDM_DURATION_MS,
  TDM_KILL_TARGET,
  TEAM_NONE,
  TEAM_SPAWN_RADIUS,
  isHiddenFrom,
  roundArenaRadius,
  teamBase,
} from "@bladeio/shared";
import type { Player } from "../state/Player";
import type { BotGoal } from "../systems/bots";
import { reachOf } from "../systems/interest";
import { pickSpawnPoint, zoneInner } from "../systems/spawnPoint";
import type { GameMode, ModeHost, PlayerStanding, Point } from "./GameMode";

// Ce que la partie garde d'un joueur au-delà de sa vie en cours.
interface MatchRecord {
  points: number;
  kills: number;
  deaths: number;
  bestBlades: number;
}

// Marge entre un camp et le mur : l'arène resserrée (dernière équipe en
// vie) rapproche les camps du centre.
const CAMP_WALL_MARGIN = 20;
// Bots : à partir de ce nombre de lames, ils vont au-devant de l'adversaire
// le plus proche dans ce rayon.
const HUNT_BLADES = 5;
const HUNT_RADIUS = 150;

// Base des modes équipe (tâche 7.2) : deux équipes, la moins nombreuse
// (bots compris) reçoit chaque arrivant ; on apparaît dans son camp, loin
// des seuls adversaires ; les joueurs sont classés comme dans une manche
// (points de toutes leurs vies) et le score d'équipe est synchronisé
// (ArenaState.teamScore1/2). En fin de partie : l'équipe gagnante et son
// meilleur joueur (MVP). Pas de trophées de rang : ces modes se jouent en
// salon privé.
export abstract class TeamMode implements GameMode {
  abstract readonly id: GameModeId;
  protected records = new Map<string, MatchRecord>();

  constructor(protected readonly host: ModeHost) {}

  // Durée d'une partie.
  protected abstract duration(): number;

  protected recordOf(id: string): MatchRecord {
    let r = this.records.get(id);
    if (!r) {
      r = { points: 0, kills: 0, deaths: 0, bestBlades: 0 };
      this.records.set(id, r);
    }
    return r;
  }

  // Équipe la moins nombreuse ; à égalité, la moins armée (lames en orbite).
  onJoin(p: Player): void {
    this.records.delete(p.id);
    const count = [0, 0, 0];
    const blades = [0, 0, 0];
    this.host.state.players.forEach((o) => {
      if (o.team === 1 || o.team === 2) {
        count[o.team]++;
        blades[o.team] += o.bladeCount;
      }
    });
    p.team = count[1] !== count[2] ? (count[1] < count[2] ? 1 : 2) : blades[1] <= blades[2] ? 1 : 2;
  }

  // Dans son camp ; si l'arène s'est resserrée, le camp recule vers le
  // centre pour rester dedans.
  spawnPoint(p: Player): Point {
    const base = teamBase(p.team);
    const room = zoneInner(this.host.state, CAMP_WALL_MARGIN) - TEAM_SPAWN_RADIUS;
    const k = room > 0 ? Math.min(1, room / Math.hypot(base.x, base.y)) : 0;
    return pickSpawnPoint(this.host.state, { x: base.x * k, y: base.y * k, radius: TEAM_SPAWN_RADIUS, team: p.team });
  }

  canRespawn(): boolean {
    return true;
  }

  onKill(victim: Player, killer: Player | null): void {
    const v = this.recordOf(victim.id);
    v.points += Math.max(0, Math.floor(victim.score));
    v.deaths++;
    v.bestBlades = Math.max(v.bestBlades, victim.maxBladeCount);
    if (killer) this.recordOf(killer.id).kills++;
  }

  standing(p: Player): PlayerStanding {
    const r = this.records.get(p.id);
    return {
      score: (r?.points ?? 0) + (p.alive ? Math.max(0, Math.floor(p.score)) : 0),
      kills: r?.kills ?? 0,
      deaths: r?.deaths ?? 0,
      bestBlades: Math.max(r?.bestBlades ?? 0, p.alive ? p.maxBladeCount : 0),
    };
  }

  rankBonus(): number {
    return 0;
  }

  protected setScores(a: number, b: number): void {
    const state = this.host.state;
    if (state.teamScore1 !== a) state.teamScore1 = a;
    if (state.teamScore2 !== b) state.teamScore2 = b;
  }

  // Équipe en tête aux scores (TEAM_NONE à égalité).
  protected leading(): number {
    const { teamScore1: a, teamScore2: b } = this.host.state;
    return a > b ? 1 : b > a ? 2 : TEAM_NONE;
  }

  // Équipe gagnante de la partie qui s'achève.
  protected winner(): number {
    return this.leading();
  }

  // Bots : sans meilleure envie (récolte proche, poursuite, fuite), un bot
  // assez armé va au-devant de l'adversaire visible le plus proche. Sans
  // ça, dispersés sur la carte, ils se croisaient peu : une dizaine
  // d'éliminations en 5 minutes de Team Deathmatch entre bots. Score entre
  // l'errance (10 à 25) et la récolte (35 et plus).
  botGoal(bot: Player): BotGoal | null {
    if (bot.bladeCount < HUNT_BLADES) return null;
    let target: Player | null = null;
    let best = HUNT_RADIUS;
    this.host.state.players.forEach((o) => {
      if (!o.alive || o.team === bot.team || o.team === TEAM_NONE || !this.visibleTo(bot, o)) return;
      const d = Math.hypot(o.x - bot.x, o.y - bot.y);
      if (d < best) {
        best = d;
        target = o;
      }
    });
    const t = target as Player | null;
    return t ? { x: t.x, y: t.y, score: 45 - best * 0.1, boost: false } : null;
  }

  // Même règle des buissons que pour les bots (BotController.hiddenFrom).
  protected visibleTo(bot: Player, other: Player): boolean {
    return other.revealed || !isHiddenFrom(bot.x, bot.y, reachOf(bot), other.x, other.y, reachOf(other));
  }

  matchResult(standings: MatchStanding[]): Pick<MatchEndEvent, "teams" | "mvp"> {
    const state = this.host.state;
    const winner = this.winner();
    // MVP : le meilleur de l'équipe gagnante, ou de tous à égalité.
    const mvp = standings.find((s) => winner === TEAM_NONE || s.team === winner);
    return { teams: { scores: [state.teamScore1, state.teamScore2], winner }, mvp: mvp?.id };
  }

  abstract tick(now: number): void;

  onMatchStart(now: number): void {
    this.records.clear();
    this.setScores(0, 0);
    const state = this.host.state;
    state.phaseEndsAt = now + this.duration();
    state.mapRadius = MAP_RADIUS;
  }
}

// Team Deathmatch : chaque élimination d'un adversaire rapporte un point à
// l'équipe du tueur (les morts au mur, rien) ; la première à 30, ou la
// meilleure au bout de 5 minutes.
export class TdmMode extends TeamMode {
  readonly id = "tdm" as const;

  protected duration(): number {
    return TDM_DURATION_MS;
  }

  onKill(victim: Player, killer: Player | null): void {
    super.onKill(victim, killer);
    if (!killer) return;
    const state = this.host.state;
    if (killer.team === 1) this.setScores(state.teamScore1 + 1, state.teamScore2);
    else if (killer.team === 2) this.setScores(state.teamScore1, state.teamScore2 + 1);
  }

  tick(now: number): void {
    const state = this.host.state;
    if (state.teamScore1 >= TDM_KILL_TARGET || state.teamScore2 >= TDM_KILL_TARGET || now >= state.phaseEndsAt) {
      this.host.endMatch(ROUND_INTERMISSION_MS);
    }
  }
}

// Qui arrive dans les premières secondes d'une manche y entre encore.
const LTS_JOIN_WINDOW_MS = 10_000;

// Dernière équipe en vie : pas de réapparition pendant la manche ; elle
// s'arrête quand une équipe n'a plus personne en vie (les deux devaient
// avoir des joueurs), ou au bout de trois minutes, l'arène se resserrant
// pendant la dernière : l'équipe avec le plus de survivants, puis le plus
// de lames, l'emporte. Score affiché : joueurs en vie.
export class LtsMode extends TeamMode {
  readonly id = "lts" as const;
  private startedAt = 0;
  // Équipes qui ont eu des joueurs pendant la manche.
  private fielded = [false, false, false];
  // Spectateurs (éliminés, arrivés en cours de manche) → joueur suivi.
  private watching = new Map<string, string>();

  protected duration(): number {
    return LTS_DURATION_MS;
  }

  canRespawn(): boolean {
    return false;
  }

  private joinWindowOpen(): boolean {
    return Date.now() - this.startedAt < LTS_JOIN_WINDOW_MS;
  }

  spawnsOnJoin(): boolean {
    return this.joinWindowOpen();
  }

  // Les bots complètent les équipes au début de la manche seulement.
  botsMayJoin(): boolean {
    return this.joinWindowOpen();
  }

  // Éliminés, ils restent au classement comme les humains, jusqu'à la
  // manche suivante (la room les retire alors, cf. restartMatch).
  keepsEliminatedBots(): boolean {
    return true;
  }

  onMatchStart(now: number): void {
    super.onMatchStart(now);
    this.startedAt = now;
    this.fielded = [false, false, false];
    this.watching.clear();
  }

  onLeave(p: Player): void {
    this.watching.delete(p.id);
  }

  // Un spectateur suit un coéquipier en vie (à défaut, n'importe qui) : sa
  // position, qu'aucun système n'utilise tant qu'il est hors jeu, centre sa
  // zone d'intérêt et sa caméra.
  private follow(p: Player): void {
    const state = this.host.state;
    let target = state.players.get(this.watching.get(p.id) ?? "");
    if (!target?.alive) {
      target = undefined;
      let fallback: Player | undefined;
      state.players.forEach((o) => {
        if (target || !o.alive) return;
        if (o.team === p.team) target = o;
        else fallback ??= o;
      });
      target ??= fallback;
      if (target) this.watching.set(p.id, target.id);
      else this.watching.delete(p.id);
    }
    if (target) {
      p.x = target.x;
      p.y = target.y;
    }
  }

  // Équipe gagnante à l'échéance : plus de survivants, puis plus de lames.
  protected winner(): number {
    const lead = this.leading();
    if (lead !== TEAM_NONE) return lead;
    const blades = [0, 0, 0];
    this.host.state.players.forEach((p) => {
      if (p.alive && (p.team === 1 || p.team === 2)) blades[p.team] += p.bladeCount;
    });
    return blades[1] > blades[2] ? 1 : blades[2] > blades[1] ? 2 : TEAM_NONE;
  }

  tick(now: number): void {
    const state = this.host.state;
    const alive = [0, 0, 0];
    state.players.forEach((p) => {
      if (p.alive && (p.team === 1 || p.team === 2)) {
        alive[p.team]++;
        this.fielded[p.team] = true;
      } else if (!p.alive && !p.isBot) {
        this.follow(p);
      }
    });
    this.setScores(alive[1], alive[2]);
    const radius = roundArenaRadius(MAP_RADIUS, now, state.phaseEndsAt);
    if (state.mapRadius !== radius) state.mapRadius = radius;
    const wipedOut = this.fielded[1] && this.fielded[2] && (alive[1] === 0 || alive[2] === 0);
    if (wipedOut || now >= state.phaseEndsAt) this.host.endMatch(ROUND_INTERMISSION_MS);
  }
}
