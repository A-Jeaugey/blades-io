import {
  CTF_BASE_RADIUS,
  CTF_CAPTURE_POINTS,
  CTF_CAPTURE_TARGET,
  CTF_DURATION_MS,
  CTF_FLAG_RETURN_MS,
  CTF_FLAG_TOUCH_RADIUS,
  CTF_RETURN_POINTS,
  FlagEvent,
  FlagEventKind,
  ROUND_INTERMISSION_MS,
  TEAMS,
  TEAM_NONE,
  WALL_KILL_THICKNESS,
  otherTeam,
  teamBase,
} from "@bladeio/shared";
import { Flag } from "../state/Flag";
import type { Player } from "../state/Player";
import type { BotGoal } from "../systems/bots";
import { updateScore } from "../systems/scoring";
import { TeamMode } from "./teams";

type BotRole = "attack" | "defend";
// Un attaquant part chercher le drapeau à partir de ce nombre de lames.
const BOT_ATTACK_BLADES = 5;
// Un défenseur va au-devant d'un adversaire à cette distance de sa base.
const CTF_DEFEND_RADIUS = 35;
// Rayon autour d'un porteur adverse où les forces en présence se comptent.
const CTF_ASSAULT_RADIUS = 30;
// En deçà, un bot ne pèse pas sur le porteur (pas de lancer avant 2 lames)
// : il va d'abord se refaire, hors assaut. Sinon les plus faibles
// tournaient autour du porteur, fuyant dès 25 u, sans jamais rien
// ramasser ; deux porteurs chacun à sa base, la partie restait bloquée
// jusqu'au bout du temps.
const BOT_HUNT_BLADES = 3;

// Capture du drapeau (tâche 7.2). Chaque équipe a son drapeau au centre de
// son camp. On prend celui d'en face en le touchant ; on marque en le
// rapportant dans sa base pendant que le sien y est. Le porteur qui meurt
// ou s'en va le lâche sur place : ses adversaires le reprennent, son équipe
// le renvoie à sa base en le touchant, sinon il y rentre seul au bout de
// CTF_FLAG_RETURN_MS. Le porteur ne se cache pas dans les buissons
// (Player.revealed). Trois captures, ou la meilleure équipe au bout de huit
// minutes (égalité possible).
export class CtfMode extends TeamMode {
  readonly id = "ctf" as const;
  // Un drapeau par équipe, dans l'ordre de TEAMS (aussi dans state.flags).
  private flags: Flag[] = [];
  // Rôle de chaque bot, donné à son arrivée pour que chaque équipe ait
  // autant d'attaquants que de défenseurs.
  private roles = new Map<string, BotRole>();

  protected duration(): number {
    return CTF_DURATION_MS;
  }

  private flagOf(team: number): Flag | undefined {
    return this.flags[team - 1];
  }

  onJoin(p: Player): void {
    super.onJoin(p);
    if (!p.isBot) return;
    let attack = 0;
    let defend = 0;
    this.host.state.players.forEach((o) => {
      if (!o.isBot || o.team !== p.team) return;
      if (this.roles.get(o.id) === "defend") defend++;
      else attack++;
    });
    this.roles.set(p.id, attack > defend ? "defend" : "attack");
  }

  onLeave(p: Player): void {
    this.roles.delete(p.id);
    this.dropCarried(p);
  }

  onKill(victim: Player, killer: Player | null): void {
    super.onKill(victim, killer);
    this.dropCarried(victim);
  }

  onMatchStart(now: number): void {
    super.onMatchStart(now);
    if (this.flags.length === 0) {
      for (const team of TEAMS) {
        const f = new Flag();
        f.team = team;
        this.flags.push(f);
        this.host.state.flags.push(f);
      }
    }
    for (const f of this.flags) this.toBase(f);
  }

  tick(now: number): void {
    for (const f of this.flags) this.updateFlag(f, now);
    const state = this.host.state;
    if (state.teamScore1 >= CTF_CAPTURE_TARGET || state.teamScore2 >= CTF_CAPTURE_TARGET || now >= state.phaseEndsAt) {
      this.host.endMatch(ROUND_INTERMISSION_MS);
    }
  }

  private updateFlag(f: Flag, now: number): void {
    const state = this.host.state;
    if (f.carrierId) {
      const c = state.players.get(f.carrierId);
      // Filet : un porteur mort ou parti sans passer par onKill / onLeave.
      if (!c || !c.alive) {
        if (c) this.drop(f, c, now);
        else this.returnHome(f);
        return;
      }
      f.x = c.x;
      f.y = c.y;
      const home = this.flagOf(c.team);
      const base = teamBase(c.team);
      if (home?.atBase && Math.hypot(c.x - base.x, c.y - base.y) <= CTF_BASE_RADIUS) this.capture(f, c);
      return;
    }
    if (!f.atBase && now >= f.returnsAt) {
      this.returnHome(f);
      return;
    }
    // Contact : le joueur en vie le plus proche à portée. Son équipe ne fait
    // rien d'un drapeau resté à sa base.
    let toucher: Player | null = null;
    let best = CTF_FLAG_TOUCH_RADIUS * CTF_FLAG_TOUCH_RADIUS;
    state.players.forEach((p) => {
      if (!p.alive || (p.team === f.team && f.atBase) || otherTeam(p.team) === 0) return;
      const dx = p.x - f.x;
      const dy = p.y - f.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= best) {
        best = d2;
        toucher = p;
      }
    });
    const p = toucher as Player | null;
    if (!p) return;
    if (p.team === f.team) {
      // Rapporté par son équipe.
      this.toBase(f);
      this.award(p, CTF_RETURN_POINTS);
      this.announce("return", f.team, p);
      return;
    }
    f.carrierId = p.id;
    f.atBase = false;
    f.returnsAt = 0;
    f.x = p.x;
    f.y = p.y;
    p.revealed = true;
    // Prendre le drapeau est une attaque : fin de la grâce et de sa rampe,
    // pendant laquelle seuls les bots faciles s'en prennent à un humain.
    p.graceUntil = 0;
    p.graceRampUntil = 0;
    this.announce("take", f.team, p);
  }

  private capture(f: Flag, c: Player): void {
    const state = this.host.state;
    this.toBase(f);
    if (c.team === 1) this.setScores(state.teamScore1 + 1, state.teamScore2);
    else this.setScores(state.teamScore1, state.teamScore2 + 1);
    this.award(c, CTF_CAPTURE_POINTS);
    this.announce("capture", f.team, c);
  }

  // Points au classement, comptés dans le score de la vie en cours (gardé
  // à la mort, cf. TeamMode.onKill) : recalculé tout de suite, la vie peut
  // finir avant le prochain calcul.
  private award(p: Player, points: number): void {
    p.bonusScore += points;
    updateScore(p);
  }

  // Le drapeau que portait p tombe où il est.
  private dropCarried(p: Player): void {
    for (const f of this.flags) {
      if (f.carrierId === p.id) this.drop(f, p, Date.now());
    }
  }

  private drop(f: Flag, p: Player, now: number): void {
    // Lâché dans le mur (mort au mur) : hors d'atteinte, il rentre.
    const zone = this.host.state.mapRadius - WALL_KILL_THICKNESS - CTF_FLAG_TOUCH_RADIUS;
    if (Math.hypot(p.x, p.y) > zone) {
      this.returnHome(f);
      return;
    }
    p.revealed = false;
    f.carrierId = "";
    f.atBase = false;
    f.x = p.x;
    f.y = p.y;
    f.returnsAt = now + CTF_FLAG_RETURN_MS;
    this.announce("drop", f.team, p);
  }

  // Retour sans joueur (délai écoulé, mur), annoncé.
  private returnHome(f: Flag): void {
    this.toBase(f);
    this.announce("return", f.team);
  }

  private toBase(f: Flag): void {
    if (f.carrierId) {
      const c = this.host.state.players.get(f.carrierId);
      if (c) c.revealed = false;
    }
    const base = teamBase(f.team);
    f.x = base.x;
    f.y = base.y;
    f.carrierId = "";
    f.atBase = true;
    f.returnsAt = 0;
  }

  private announce(kind: FlagEventKind, team: number, p?: Player): void {
    const ev: FlagEvent = { kind, team };
    if (p) {
      ev.playerId = p.id;
      ev.name = p.name;
    }
    this.host.emit("flag", ev);
  }

  // Bots : le porteur rentre à sa base. Son drapeau emporté, tous les
  // autres rattrapent le porteur : sinon, les deux drapeaux pris, chaque
  // porteur attendait chez lui le retour du sien et la partie se figeait.
  // À terre, les défenseurs (et les attaquants proches) le rapportent.
  // Sinon les attaquants vont chercher le drapeau d'en face une fois assez
  // armés (avant, ils récoltent), ou escortent leur porteur ; les
  // défenseurs restent près de leur base. Scores : sous la fuite (1000) ;
  // au-dessus de la récolte pour l'attaque d'un bot armé.
  botGoal(bot: Player): BotGoal | null {
    const mine = this.flagOf(bot.team);
    const theirs = this.flagOf(otherTeam(bot.team));
    if (!mine || !theirs) return null;
    const home = teamBase(bot.team);
    if (theirs.carrierId === bot.id) return { x: home.x, y: home.y, score: 700, boost: false };
    const state = this.host.state;
    if (mine.carrierId) {
      const c = state.players.get(mine.carrierId);
      if (c) {
        const d = Math.hypot(c.x - bot.x, c.y - bot.y);
        // À plusieurs autour du porteur, plus armés que lui et ses
        // escortes : l'assaut passe avant la fuite (sinon chacun, plus
        // petit que lui, tournait à distance sans jamais attaquer).
        const assault = d < CTF_ASSAULT_RADIUS && this.strengthNear(c, bot.team, bot) > this.strengthNear(c, c.team, bot);
        const weak = bot.bladeCount < BOT_HUNT_BLADES;
        return {
          x: c.x,
          y: c.y,
          score: assault ? 1500 : weak ? 60 - d * 0.1 : 500 - d * 0.3,
          boost: d > 20 && d < 60 && bot.bladeCount > 6,
          targetId: c.id,
          urgent: true,
        };
      }
    }
    const role = this.roles.get(bot.id) ?? "attack";
    if (!mine.carrierId && !mine.atBase) {
      const d = Math.hypot(mine.x - bot.x, mine.y - bot.y);
      if (role === "defend" || d < 120) return { x: mine.x, y: mine.y, score: 450 - d * 0.5, boost: false };
    }
    if (role === "defend" && mine.atBase) {
      // Un adversaire rôde près de son drapeau : on va au-devant.
      let intruder: Player | null = null;
      let best = CTF_DEFEND_RADIUS;
      state.players.forEach((o) => {
        if (!o.alive || o.team === bot.team || o.team === TEAM_NONE || !this.visibleTo(bot, o)) return;
        const d = Math.hypot(o.x - home.x, o.y - home.y);
        if (d < best) {
          best = d;
          intruder = o;
        }
      });
      const o = intruder as Player | null;
      if (o) {
        const d = Math.hypot(o.x - bot.x, o.y - bot.y);
        return { x: o.x, y: o.y, score: 300 - d * 0.5, boost: false, targetId: o.id };
      }
    }
    if (role === "attack") {
      if (!theirs.carrierId) {
        const d = Math.hypot(theirs.x - bot.x, theirs.y - bot.y);
        return { x: theirs.x, y: theirs.y, score: (bot.bladeCount >= BOT_ATTACK_BLADES ? 150 : 40) - d * 0.1, boost: false };
      }
      const c = state.players.get(theirs.carrierId);
      return c ? { x: c.x, y: c.y, score: 60, boost: false } : null;
    }
    const d = Math.hypot(home.x - bot.x, home.y - bot.y);
    return d > 40 ? { x: home.x, y: home.y, score: 100, boost: false } : null;
  }

  // Lames des joueurs en vie de cette équipe autour de c, telles que le bot
  // les voit (un de plus par joueur : un corps sans lame pèse aussi).
  private strengthNear(c: Player, team: number, bot: Player): number {
    let sum = 0;
    this.host.state.players.forEach((p) => {
      if (!p.alive || p.team !== team || Math.hypot(p.x - c.x, p.y - c.y) > CTF_ASSAULT_RADIUS) return;
      if (p.team !== bot.team && !this.visibleTo(bot, p)) return;
      sum += p.bladeCount + 1;
    });
    return sum;
  }

}
