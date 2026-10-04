import {
  BOT_CHAMPIONS_MAX,
  BOT_MAX_TOTAL,
  BOT_MIN_PLAYERS,
  BOT_NAMES,
  BOT_THINK_INTERVAL,
  CHAMPION_FLEE_RATIO,
  CHAMPION_MAX_BLADES,
  CHAMPION_MIN_BLADES,
  CHAMPION_NAME_MARK,
  CHAMPION_PREY_RATIO,
  CHAMPION_RESPAWN_MS,
  CHAMPION_SECOND_AT,
  CHAMPION_SIZE_RATIO,
  MAP_RADIUS,
  PLAYER_SPEED,
  SPAWN_GRACE_CHASE_RADIUS,
  SPAWN_GRACE_RAMP_MS,
  THROW_PROJECTILE_MAX_RANGE,
  THROW_PROJECTILE_SPEED,
  WALL_KILL_THICKNESS,
  isHiddenFrom,
  outerOrbitRadius,
  sameTeam,
} from "@bladeio/shared";
import { ArenaState } from "../state/ArenaState";
import { Player } from "../state/Player";
import { reachOf } from "./interest";
import { zoneInner } from "./spawnPoint";

// Rayon de sécurité : marge confortable pour que ni le corps, ni les lames
// orbitantes ne touchent la zone de mort. Il suit le rayon de l'arène, qui
// se resserre à la fin d'une manche (tâche 7.1).
function botSafeRadius(arena: ArenaState): number {
  return arena.mapRadius - WALL_KILL_THICKNESS - 8;
}

// Au-delà, l'évitement du mur reprend la main (scoreAvoidWall, dès
// botSafeRadius - 5) : un bot n'y vise rien. Sinon il oscille entre sa
// cible et le mur sans jamais l'atteindre ; dans l'arène à la taille de sa
// population (tâche 4.5), tous les bots d'une room finissaient collés à
// cette limite, sans plus rien ramasser ni affronter. Le butin apparaît
// en deçà (LOOT_WALL_MARGIN, systems/spawnPoint.ts).
function botReachRadius(arena: ArenaState): number {
  return botSafeRadius(arena) - 6;
}

function reachable(arena: ArenaState, x: number, y: number): boolean {
  const r = botReachRadius(arena);
  return x * x + y * y <= r * r;
}

// Marge entre l'orbite d'un bot et celle d'un joueur en période de grâce
// quand le bot choisit où aller récolter.
const GRACE_KEEPOUT_MARGIN = 6;
// Distance au-delà de laquelle un bot ne prend personne en chasse.
const CHASE_RADIUS = 80;

// Chasse à la prime (tâche 4.2). Un bot ne poursuit d'ordinaire que plus
// petit que lui : le leader, toujours le plus gros, n'était jamais contesté
// et régnait des minutes. Il devient une cible dès que le bot a
// BOUNTY_HUNT_RATIO de ses lames, d'autant plus attirante que la prime est
// grosse, et plusieurs bots peuvent le viser ensemble.
const BOUNTY_HUNT_RATIO = 0.6;
const BOUNTY_HUNT_WEIGHT = 1.0;

// Niveaux de difficulté (tâche 4.6), indépendants de la personnalité. Ils
// règlent la façon dont un bot s'en prend aux joueurs humains. Normal : le
// comportement d'avant. Facile : ne poursuit que de près, moins vite qu'un
// joueur (on peut toujours lui échapper) et sans boost, et lâche l'affaire
// au bout de quelques secondes ; vise mal et marque une pause après chaque
// lancer. Difficile : vise mieux et repère de plus loin. Entre bots, tous
// se battent comme avant : des bots faciles aussi avec les autres bots
// rendaient aux règnes du leader leur durée d'avant 4.2 (banc du
// snowball : 7 à 8 changements de leader par heure au lieu de ~40).
export enum BotSkill {
  Easy = 0,
  Normal = 1,
  Hard = 2,
}

interface SkillProfile {
  chaseRadius: number; // rayon de poursuite (hors rampe de grâce)
  chaseSpeed: number; // part de la vitesse de marche en poursuite
  chaseBoost: boolean;
  giveUpMs: number; // poursuite abandonnée au bout de ce temps
  aimSpread: number; // multiplie l'erreur de visée de la personnalité
  throwPauseMs: number; // attente en plus du cooldown entre deux lancers
  // Temps de réaction de la visée (s) : un lancer anticipe la course de la
  // cible d'après sa vitesse d'il y a ce temps-là. Un joueur qui change de
  // direction juste avant le lancer l'esquive ; en ligne droite, rien ne
  // change. Sans lui, la visée suivait chaque virage en 50 à 100 ms (retour
  // du owner, 2026-10-04 : « ils visent trop bien »).
  aimReaction: number;
}

const SKILLS: Record<BotSkill, SkillProfile> = {
  [BotSkill.Easy]: { chaseRadius: 45, chaseSpeed: 0.85, chaseBoost: false, giveUpMs: 6000, aimSpread: 1.8, throwPauseMs: 3000, aimReaction: 0.35 },
  [BotSkill.Normal]: { chaseRadius: CHASE_RADIUS, chaseSpeed: 1, chaseBoost: true, giveUpMs: Infinity, aimSpread: 1, throwPauseMs: 0, aimReaction: 0.25 },
  [BotSkill.Hard]: { chaseRadius: 95, chaseSpeed: 1, chaseBoost: true, giveUpMs: Infinity, aimSpread: 0.6, throwPauseMs: 0, aimReaction: 0.2 },
};

// Champion (tâche 4.12) : un difficile qui lâche une poursuite au bout de
// 12 s. Sans limite, il pourchassait un joueur aussi rapide que lui en
// boostant (deux lames par seconde) et fondait de 190 lames à 3 avant
// qu'un petit bot l'achève.
const CHAMPION_PROFILE: SkillProfile = { ...SKILLS[BotSkill.Hard], giveUpMs: 12000 };
// Il ne booste qu'à l'approche finale, entre ces distances (u), et ne fuit
// en boostant qu'une menace plus proche que CHAMPION_FLEE_BOOST_RANGE.
const CHAMPION_BOOST_MIN = 6;
const CHAMPION_BOOST_MAX = 18;
const CHAMPION_FLEE_BOOST_RANGE = 12;
// Marge entre l'orbite d'un champion et celle d'un nouveau venu, en deçà de
// laquelle le champion s'écarte (scoreAvoidFresh).
const CHAMPION_FRESH_KEEPOUT = 8;

// Profil d'un bot face à ce joueur : son niveau contre un humain, normal
// contre un autre bot ; celui d'un champion contre tous.
function profileAgainst(st: { skill: BotSkill; champion: boolean }, other: Player): SkillProfile {
  if (st.champion) return CHAMPION_PROFILE;
  return other.isBot ? SKILLS[BotSkill.Normal] : SKILLS[st.skill];
}

// Après un abandon, la cible est ignorée ce temps-là (sinon le bot la
// reprendrait à la décision suivante).
const GIVE_UP_IGNORE_MS = 5000;

// Part des bots faciles, normaux et difficiles à leur apparition. Avec un
// débutant dans la room (première partie sur l'appareil), plus de bots
// faciles et aucun difficile ; les difficiles déjà là le laissent
// tranquille.
const SKILL_MIX_USUAL: [number, number, number] = [0.3, 0.4, 0.3];
const SKILL_MIX_BEGINNERS: [number, number, number] = [0.6, 0.4, 0];

function drawSkill(mix: [number, number, number]): BotSkill {
  const r = Math.random();
  if (r < mix[0]) return BotSkill.Easy;
  if (r < mix[0] + mix[1]) return BotSkill.Normal;
  return BotSkill.Hard;
}

// Débutant : première partie sur cet appareil (drapeau du client, cf.
// télémétrie 4.8), pour toute la session.
function isBeginner(p: Player): boolean {
  return !p.isBot && p.newcomer;
}

// Clamp un point cible dans la zone safe.
function clampToSafe(x: number, y: number, safeRadius: number): { x: number; y: number } {
  const d = Math.hypot(x, y);
  if (d <= safeRadius) return { x, y };
  const scale = safeRadius / d;
  return { x: x * scale, y: y * scale };
}

// IA très simple pour les bots :
// - Si un ennemi vivant est plus faible (moins de lames) à portée → fonce
//   dessus pour l'enrouler avec ses lames.
// - Sinon, vise la lame au sol la plus proche.
// - Sinon, déambule vers un point random près du centre.
// - Boost si on a beaucoup de lames et qu'on poursuit quelqu'un.
// Re-décide toutes les BOT_THINK_INTERVAL secondes ; entre deux décisions
// les inputs sont gardés tels quels (économie de calcul).
export enum BotPersonality {
  Aggressive = 0,
  Farmer = 1,
  Hunter = 2,
  Camper = 3,
}

interface BotState {
  targetX: number;
  targetY: number;
  nextThinkAt: number;
  personality: BotPersonality;
  jitterAngle: number;
  fleeSign: number;
  actionType: string;
  // Hysteresis : ID du joueur cible courant. Le bot conserve cette cible
  // tant qu'elle reste pertinente, plutôt que de re-scorer à zéro chaque
  // tick. Évite l'oscillation entre cibles équivalentes — donne une
  // sensation d'"intention".
  currentTargetId: string | null;
  // Sinusoïde de courbure d'approche : déphasage individuel + signe
  // (-1/+1) → chaque bot prend un arc d'approche différent, ne fonce
  // jamais en ligne droite. Phase incrémentée par wall-clock.
  curveSign: number;
  curvePhaseOffset: number; // [0, 2π) initial seed
  // Niveau de menace ressenti (0..N) : nombre de lames perdues dans les
  // dernières 3s. Mis à jour à chaque decide(). >3 = "je prends cher"
  // → bias vers flee.
  threatLevel: number;
  skill: BotSkill;
  // Début de la poursuite de currentTargetId (ms), pour l'abandon des bots
  // faciles, et cible ignorée après un abandon.
  chaseSince: number;
  // Vitesse de marche en poursuite (cf. SkillProfile.chaseSpeed).
  chaseSpeed: number;
  ignoreId: string | null;
  ignoreUntil: number;
  // Pas de nouveau lancer sur un humain avant (ms) : pause des bots
  // faciles.
  nextThrowAt: number;
  // La poursuite en cours vient d'un objectif urgent (cf. BotGoal.urgent).
  urgent: boolean;
  // Champion (tâche 4.12), relevé à la création de l'état.
  champion: boolean;
}

// Cache vélocité par joueur — une seule entrée par playerID, mise à jour
// à chaque tick du BotController. Permet aux bots de prédire les
// trajectoires avec la VRAIE vitesse (input + knockback + friction)
// au lieu de p.inputDx qui n'est qu'une intention sans grandeur.
// Profondeur de l'historique des vitesses (s), au-delà du plus long temps
// de réaction de visée.
const VELOCITY_HISTORY_S = 1;

interface VelocityCache {
  vx: number;
  vy: number;
  prevX: number;
  prevY: number;
  lastT: number; // secondes
  // Vitesses lissées de la dernière seconde (t en s), pour la visée avec
  // temps de réaction (cf. SkillProfile.aimReaction).
  hist: Array<{ t: number; vx: number; vy: number }>;
}

// Calcule un point d'interception prédit pour un projectile partant de
// (origX, origY) à projSpeed contre une cible à (tgtX, tgtY) qui se déplace
// à (tgtVx, tgtVy). Itération à 2 passes pour raffiner — converge vite à
// l'échelle des distances de combat (12-30u). Au-delà la cible peut tourner
// donc précision marginale, peu utile.
function predictIntercept(
  origX: number, origY: number,
  tgtX: number, tgtY: number,
  tgtVx: number, tgtVy: number,
  projSpeed: number,
): { x: number; y: number; t: number } {
  let px = tgtX;
  let py = tgtY;
  let t = 0;
  for (let i = 0; i < 2; i++) {
    const dx = px - origX;
    const dy = py - origY;
    const d = Math.hypot(dx, dy);
    t = d / Math.max(0.001, projSpeed);
    px = tgtX + tgtVx * t;
    py = tgtY + tgtVy * t;
  }
  return { x: px, y: py, t };
}

// Objectif fixé par le mode de jeu (modes équipe, tâche 7.2) : un point où
// aller, noté sur la même échelle que les autres actions (fuite au-dessus
// de 1000, poursuite vers 100, récolte sous 110, errance vers 10).
// targetId : joueur à rattraper (porteur de son drapeau), poursuivi et visé
// par les lancers comme en chasse.
export interface BotGoal {
  x: number;
  y: number;
  score: number;
  boost: boolean;
  targetId?: string;
  // Cible à arrêter coûte que coûte (porteur d'un drapeau) : le bot lui
  // lance ses lames même s'il en a peu ; à la course, à vitesse égale, il
  // ne la rattrape jamais.
  urgent?: boolean;
}

export class BotController {
  private state = new Map<string, BotState>();
  // Vélocité lissée des joueurs (humans + bots) — utilisée pour les
  // prédictions d'intercept des throws et de chase. EMA avec alpha 0.7
  // sur le sample courant pour absorber le knockback / micro-jitter sans
  // figer les tournants brusques.
  private velocity = new Map<string, VelocityCache>();
  // Joueurs en période de grâce (cf. SPAWN_GRACE_MS), relevés à chaque
  // update : les bots ne les poursuivent pas, ne leur lancent rien et ne
  // vont pas récolter à leur contact (un clash, même accidentel, mettrait
  // fin à leur grâce).
  private graced: Array<{ x: number; y: number; reach: number }> = [];
  // Nouveaux venus (débutants, joueurs dans leur grâce ou leur rampe) : un
  // champion, dont l'orbite tue tout ce qu'elle touche, ne va pas récolter
  // ni errer à leur contact (tâche 4.12).
  private fresh: Array<{ x: number; y: number; reach: number }> = [];
  // Leader et sa prime, fixés par la room à chaque tick (cf. setLeader).
  private leaderId: string | null = null;
  private leaderBounty = 0;
  // Cible → bot qui la poursuit, d'après les dernières décisions : un
  // nouveau venu (débutant ou rampe de grâce) n'a qu'un poursuivant à la
  // fois (tâche 4.6).
  private chasers = new Map<string, string>();
  // Objectifs du mode de jeu (cf. BotGoal), null hors des modes qui en
  // donnent.
  private goalFor: ((bot: Player) => BotGoal | null) | null = null;

  setGoals(fn: ((bot: Player) => BotGoal | null) | null): void {
    this.goalFor = fn;
  }

  // Prochain champion possible (ms epoch) : CHAMPION_RESPAWN_MS après la
  // chute du précédent.
  private nextChampionAt = 0;

  // Plus gros humain aguerri (ni débutant, ni bot) de la room : -1 s'il n'y
  // en a aucun, sinon ses lames (0 s'il est mort).
  private topVeteranBlades(arena: ArenaState): number {
    let top = -1;
    arena.players.forEach((p) => {
      if (p.isBot || p.newcomer) return;
      top = Math.max(top, p.alive ? p.bladeCount : 0);
    });
    return top;
  }

  // Un champion doit-il apparaître à la place du prochain bot (tâche
  // 4.12) ? Un s'il y a un humain aguerri, deux s'il a grossi.
  championDue(arena: ArenaState, nowMs: number): boolean {
    if (nowMs < this.nextChampionAt) return false;
    const top = this.topVeteranBlades(arena);
    if (top < 0) return false;
    const wanted = Math.min(BOT_CHAMPIONS_MAX, top >= CHAMPION_SECOND_AT ? 2 : 1);
    let alive = 0;
    arena.players.forEach((p) => { if (p.isBot && p.alive && p.champion) alive++; });
    return alive < wanted;
  }

  // Lames d'un champion à son apparition : à la taille du plus gros humain
  // aguerri.
  championBlades(arena: ArenaState): number {
    const top = Math.max(0, this.topVeteranBlades(arena));
    return Math.round(Math.max(CHAMPION_MIN_BLADES, Math.min(CHAMPION_MAX_BLADES, top * CHAMPION_SIZE_RATIO)));
  }

  // place : le point d'apparition, ou la règle du mode qui le choisit
  // (cf. modes/), appelée avant l'entrée du bot dans l'arène.
  spawnBot(
    arena: ArenaState,
    place: { x: number; y: number } | ((bot: Player) => { x: number; y: number }),
    champion = false,
  ): Player {
    const id = "bot_" + Math.random().toString(36).slice(2, 10);
    const p = new Player();
    p.id = id;
    const usedNames = new Set<string>();
    arena.players.forEach((player) => {
      if (player.alive) usedNames.add(player.name);
    });
    
    const availableNames = BOT_NAMES.filter(n => !usedNames.has(n));
    if (availableNames.length > 0) {
      p.name = availableNames[Math.floor(Math.random() * availableNames.length)];
    } else {
      // Fallback au cas où il y a plus de bots que de noms disponibles
      p.name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] + " II";
    }
    p.isBot = true;
    if (champion) {
      p.champion = true;
      p.name = CHAMPION_NAME_MARK + p.name;
    }
    const spawn = typeof place === "function" ? place(p) : place;
    p.x = spawn.x;
    p.y = spawn.y;
    p.alive = true;
    p.spawnedAt = Date.now();
    p.spinPhase = Math.random() * Math.PI * 2;
    p.spinScale = 0.75 + Math.random() * 0.5;
    arena.players.set(id, p);
    return p;
  }

  // Bots ordinaires voulus ; les champions viennent en plus (championDue).
  desiredBotCount(arena: ArenaState): number {
    let humans = 0;
    arena.players.forEach((p) => {
      if (!p.isBot) humans++;
    });
    const target = Math.max(0, BOT_MIN_PLAYERS - humans);
    return Math.min(BOT_MAX_TOTAL, target);
  }

  forEachBot(arena: ArenaState, fn: (p: Player) => void): void {
    arena.players.forEach((p) => {
      if (p.isBot) fn(p);
    });
  }

  setLeader(id: string | null, bounty: number): void {
    this.leaderId = id;
    this.leaderBounty = bounty;
  }

  update(dt: number, arena: ArenaState): void {
    const now = (Date.now() / 1000);
    // Mise à jour cache vélocité avant les décisions des bots — toutes les
    // prédictions d'intercept en dépendent.
    this.updateVelocityCache(arena, now);
    const nowMs = Date.now();
    this.graced.length = 0;
    this.fresh.length = 0;
    this.chasers.clear();
    let beginners = false;
    arena.players.forEach((p) => {
      if (isBeginner(p)) beginners = true;
      if (p.alive && p.graceUntil > nowMs) {
        this.graced.push({ x: p.x, y: p.y, reach: outerOrbitRadius(p.bladeCount) });
      }
      if (p.alive && this.isNewcomer(p, nowMs)) {
        this.fresh.push({ x: p.x, y: p.y, reach: outerOrbitRadius(p.bladeCount) });
      }
      if (!p.isBot || !p.alive) return;
      const st = this.state.get(p.id);
      if (st && st.actionType === "chase" && st.currentTargetId && !this.chasers.has(st.currentTargetId)) {
        this.chasers.set(st.currentTargetId, p.id);
      }
    });
    arena.players.forEach((p) => {
      if (!p.isBot || !p.alive) return;
      let st = this.state.get(p.id);
      if (!st) {
        // Champion : chasseur, difficile (il laisse les débutants et les
        // joueurs en rampe de grâce tranquilles, cf. leavesAlone).
        const personality = p.champion ? BotPersonality.Hunter : Math.floor(Math.random() * 4) as BotPersonality;
        st = {
          targetX: p.x,
          targetY: p.y,
          nextThinkAt: 0,
          personality,
          jitterAngle: 0,
          fleeSign: Math.random() < 0.5 ? 1 : -1,
          actionType: "wander",
          currentTargetId: null,
          curveSign: Math.random() < 0.5 ? 1 : -1,
          curvePhaseOffset: Math.random() * Math.PI * 2,
          threatLevel: 0,
          skill: p.champion ? BotSkill.Hard : drawSkill(beginners ? SKILL_MIX_BEGINNERS : SKILL_MIX_USUAL),
          chaseSince: 0,
          chaseSpeed: 1,
          ignoreId: null,
          ignoreUntil: 0,
          nextThrowAt: 0,
          urgent: false,
          champion: p.champion,
        };
        this.state.set(p.id, st);
      }
      if (now >= st.nextThinkAt) {
        // Reaction time jitter par personnalité : Hunter rapide (focused),
        // Aggressive moyen, Farmer plus lent (méthodique), Camper le plus
        // lent (réaction défensive). Cible 50-300ms de variance par-dessus
        // l'intervalle de base. Plus humain qu'une jitter uniforme.
        const reactionByPers =
          st.personality === BotPersonality.Hunter ? 0.05 :
          st.personality === BotPersonality.Aggressive ? 0.10 :
          st.personality === BotPersonality.Farmer ? 0.20 :
          0.30; // Camper
        st.nextThinkAt = now + BOT_THINK_INTERVAL + Math.random() * reactionByPers;
        this.decide(p, arena, st);
        if (st.actionType === "chase" && st.currentTargetId && !this.chasers.has(st.currentTargetId)) {
          this.chasers.set(st.currentTargetId, p.id);
        }
      }
      this.applyInput(p, st, now, botSafeRadius(arena));
      // Évalue un throw opportuniste à chaque tick (le cooldown est géré
      // par processThrows). Pas de coût dispendieux : une boucle bornée
      // sur les joueurs + caisses, après alignement on shortcut.
      this.tryThrow(p, arena, st);
    });

    if (this.state.size > 32) {
      for (const id of [...this.state.keys()]) {
        if (!arena.players.has(id)) this.state.delete(id);
      }
    }
  }

  // Met à jour la vélocité lissée de chaque joueur. Appelé une fois par
  // tick au début de update(). EMA(0.7) pour absorber le micro-jitter du
  // knockback sans figer les tournants brusques. Skipper si le delta de
  // temps est trop court (< 50ms) → évite les divisions explosives.
  private updateVelocityCache(arena: ArenaState, now: number): void {
    arena.players.forEach((p) => {
      if (!p.alive) return;
      let v = this.velocity.get(p.id);
      if (!v) {
        this.velocity.set(p.id, { vx: 0, vy: 0, prevX: p.x, prevY: p.y, lastT: now, hist: [{ t: now, vx: 0, vy: 0 }] });
        return;
      }
      const dt = now - v.lastT;
      if (dt < 0.05) return;
      const newVx = (p.x - v.prevX) / dt;
      const newVy = (p.y - v.prevY) / dt;
      v.vx = v.vx * 0.3 + newVx * 0.7;
      v.vy = v.vy * 0.3 + newVy * 0.7;
      v.prevX = p.x;
      v.prevY = p.y;
      v.lastT = now;
      v.hist.push({ t: now, vx: v.vx, vy: v.vy });
      while (v.hist.length > 1 && v.hist[0].t < now - VELOCITY_HISTORY_S) v.hist.shift();
    });
    // GC les entrées orphelines périodiquement.
    if (this.velocity.size > arena.players.size * 1.5 + 4) {
      for (const id of [...this.velocity.keys()]) {
        if (!arena.players.has(id)) this.velocity.delete(id);
      }
    }
  }

  // Lit la vélocité en cache (zéro si absente). Helper qui évite des
  // `?.vx` partout dans les calculs de prédiction.
  private getVelocity(id: string): { vx: number; vy: number } {
    const v = this.velocity.get(id);
    return v ? { vx: v.vx, vy: v.vy } : { vx: 0, vy: 0 };
  }

  // Vitesse lissée telle qu'elle était `reaction` secondes plus tôt : le
  // dernier relevé à cette date, sinon le plus ancien gardé.
  private reactedVelocity(id: string, now: number, reaction: number): { vx: number; vy: number } {
    const v = this.velocity.get(id);
    if (!v) return { vx: 0, vy: 0 };
    const at = now - reaction;
    for (let i = v.hist.length - 1; i >= 0; i--) {
      const h = v.hist[i];
      if (h.t <= at) return { vx: h.vx, vy: h.vy };
    }
    const first = v.hist[0];
    return first ? { vx: first.vx, vy: first.vy } : { vx: v.vx, vy: v.vy };
  }

  // Point où ce bot ne doit pas aller : son orbite y toucherait celle d'un
  // joueur en période de grâce.
  private nearGraced(bot: Player, x: number, y: number): boolean {
    const list = bot.champion ? this.fresh : this.graced;
    if (list.length === 0) return false;
    const botReach = reachOf(bot);
    for (const g of list) {
      const keep = g.reach + botReach + GRACE_KEEPOUT_MARGIN;
      const dx = x - g.x;
      const dy = y - g.y;
      if (dx * dx + dy * dy < keep * keep) return true;
    }
    return false;
  }

  // Un bot ne voit pas un joueur caché dans un buisson, avec la même règle
  // que les clients (tâche 2.4) : ni fuite, ni poursuite, ni lancer.
  // Avant, les buissons ne cachaient rien aux bots. Un porteur de drapeau
  // ne se cache pas.
  private hiddenFrom(bot: Player, other: Player): boolean {
    return !other.revealed && isHiddenFrom(bot.x, bot.y, reachOf(bot), other.x, other.y, reachOf(other));
  }

  // Ce bot poursuit-il ce joueur (dernière décision) ? Un clash entre eux
  // est alors son attaque, pas celle du joueur.
  isChasing(botId: string, targetId: string): boolean {
    const st = this.state.get(botId);
    return !!st && st.actionType === "chase" && st.currentTargetId === targetId;
  }

  // Rayon dans lequel un bot prend ce joueur en chasse : nul pendant la
  // grâce, puis croissant jusqu'au rayon du bot (selon son niveau) pendant
  // la rampe (un nouveau venu n'est d'abord remarqué que de près). Pendant
  // la rampe, « de près » suit la taille de l'arène (tâche 4.5) : dans une
  // arène plus petite, donc plus dense, autant de bots le remarquent que
  // dans la carte entière.
  private chaseRadiusFor(other: Player, nowMs: number, full: number, arena: ArenaState): number {
    if (other.graceUntil > nowMs) return 0;
    if (other.graceRampUntil <= nowMs) return full;
    const t = 1 - (other.graceRampUntil - nowMs) / SPAWN_GRACE_RAMP_MS;
    const ramp = SPAWN_GRACE_CHASE_RADIUS + (full - SPAWN_GRACE_CHASE_RADIUS) * Math.max(0, Math.min(1, t));
    return Math.min(full, ramp * Math.min(1, arena.mapRadius / MAP_RADIUS));
  }

  // Nouveau venu : débutant, ou joueur dans les 50 s qui suivent son
  // apparition (grâce et rampe). Un seul bot à la fois le poursuit.
  private isNewcomer(p: Player, nowMs: number): boolean {
    return isBeginner(p) || p.graceRampUntil > nowMs;
  }

  // Compte les lames perdues récemment (3s) — proxy pour "je prends cher".
  // Lit le buffer recentLosses du bot lui-même : ses lames détruites
  // (handleBladeDestroyed), pas celles qu'il a lancées et qui ont touché.
  private recentDamageRate(bot: Player, nowMs: number): number {
    const cutoff = nowMs - 3000;
    let count = 0;
    for (const l of bot.recentLosses) {
      if (l.ts >= cutoff && !l.thrown) count++;
    }
    return count;
  }

  private decide(bot: Player, arena: ArenaState, st: BotState): void {
    // Mise à jour du threat level avant le scoring : flee/chase/farm en
    // dépendent.
    st.threatLevel = this.recentDamageRate(bot, Date.now());

    const scores = [];

    // ── Priorité absolue : éviter le mur ──
    const wallAction = this.scoreAvoidWall(bot, arena);
    if (wallAction) scores.push(wallAction);

    const fleeAction = this.scoreFlee(bot, arena, st);
    if (fleeAction) scores.push(fleeAction);

    if (bot.champion) {
      const avoidFresh = this.scoreAvoidFresh(bot);
      if (avoidFresh) scores.push(avoidFresh);
    }

    const chaseAction = this.scoreChase(bot, arena, st);
    if (chaseAction) scores.push(chaseAction);

    const farmBladeAction = this.scoreFarmBlades(bot, arena, st);
    if (farmBladeAction) scores.push(farmBladeAction);

    const farmCrateAction = this.scoreFarmCrates(bot, arena, st);
    if (farmCrateAction) scores.push(farmCrateAction);

    const farmPowerupAction = this.scoreFarmPowerups(bot, arena, st);
    if (farmPowerupAction) scores.push(farmPowerupAction);

    scores.push(this.scoreWander(bot, arena, st));

    // Objectif du mode de jeu, en balance avec le reste : un bot fuit plus
    // gros que lui, sauf objectif noté plus haut que la fuite (assaut à
    // plusieurs sur un porteur de drapeau).
    const goal = this.goalFor?.(bot) ?? null;
    const goalAction = goal
      ? { type: goal.targetId ? "chase" : "goal", score: goal.score, x: goal.x, y: goal.y, boost: goal.boost }
      : null;
    if (goalAction) scores.push(goalAction);

    scores.sort((a, b) => b.score - a.score);
    const bestAction = scores[0];
    st.urgent = !!goal?.urgent && bestAction === goalAction;
    if (goal?.targetId && bestAction === goalAction) {
      // Poursuite imposée : même suivi qu'une chasse (lancers, allure du
      // niveau du bot face à un humain).
      const target = arena.players.get(goal.targetId);
      if (goal.targetId !== st.currentTargetId) st.chaseSince = Date.now();
      st.currentTargetId = goal.targetId;
      st.chaseSpeed = target ? profileAgainst(st, target).chaseSpeed : 1;
    }

    // Clamp la cible dans la safe zone pour ne jamais viser hors de la map.
    const safe = clampToSafe(bestAction.x, bestAction.y, botSafeRadius(arena));
    st.targetX = safe.x;
    st.targetY = safe.y;
    st.actionType = bestAction.type;
    bot.inputBoost = bestAction.boost;

    // Si on n'a pas pris une action chase, libérer la commitment de cible
    // (sinon elle persiste et bias les futures décisions chase de manière
    // incorrecte alors que le bot a fait autre chose entre temps).
    if (bestAction.type !== "chase") {
      st.currentTargetId = null;
    }

    // Aim Jitter
    st.jitterAngle = (Math.random() - 0.5) * 0.5; // Up to ~14 degrees of error
  }

  private scoreFlee(bot: Player, arena: ArenaState, st: BotState) {
    let threatDx = 0;
    let threatDy = 0;
    let maxDanger = 0;

    // Un champion ne fuit que nettement plus gros que lui.
    const fearOf = bot.champion ? bot.bladeCount * CHAMPION_FLEE_RATIO : bot.bladeCount;
    let nearest = Infinity;
    arena.players.forEach((other) => {
      if (other.id === bot.id || !other.alive || sameTeam(bot.team, other.team)) return;
      if (other.bladeCount <= fearOf) return;
      if (this.hiddenFrom(bot, other)) return;

      const dx = bot.x - other.x;
      const dy = bot.y - other.y;
      const d = Math.hypot(dx, dy);

      const threatRadius = 25;
      if (d < threatRadius && d > 0.001) {
        const danger = (threatRadius - d) + (other.bladeCount - bot.bladeCount);
        maxDanger = Math.max(maxDanger, danger);
        if (d < nearest) nearest = d;
        threatDx += dx / d;
        threatDy += dy / d;
      }
    });

    if (maxDanger === 0) return null;

    let m = Math.hypot(threatDx, threatDy);
    if (m < 0.15) {
      let perpDx = 0;
      let perpDy = 0;
      arena.players.forEach((other) => {
        if (perpDx !== 0 || perpDy !== 0) return;
        if (other.id === bot.id || !other.alive || sameTeam(bot.team, other.team)) return;
        if (other.bladeCount <= fearOf) return;
        if (this.hiddenFrom(bot, other)) return;
        const dx = bot.x - other.x;
        const dy = bot.y - other.y;
        const d = Math.hypot(dx, dy);
        if (d < 25 && d > 0.001) {
          perpDx = -dy / d * st.fleeSign;
          perpDy = dx / d * st.fleeSign;
        }
      });
      threatDx = perpDx;
      threatDy = perpDy;
      m = Math.hypot(threatDx, threatDy) || 1;
    }

    // Bonus threat-aware : si le bot prend cher (≥ 3 lames perdues en 3s),
    // boost le flee score pour qu'il décide de fuir même contre un ennemi
    // à priori comparable. "Je suis blessé, je dois me regrouper".
    const threatBoost = st.threatLevel >= 3 ? st.threatLevel * 50 : 0;

    return {
      type: "flee",
      score: 1000 + maxDanger * 10 + threatBoost,
      x: bot.x + (threatDx / m) * 30,
      y: bot.y + (threatDy / m) * 30,
      // Plus enclin à boost en flee si déjà blessé. Un champion seulement
      // si la menace est sur lui : l'écart de lames suffisait à le faire
      // booster dès 25 u, et il fondait à fuir un joueur qui ne le
      // poursuivait pas.
      boost: bot.champion
        ? nearest < CHAMPION_FLEE_BOOST_RANGE
        : bot.bladeCount > 2 && (maxDanger > 10 || st.threatLevel >= 4),
    };
  }

  // Champion (tâche 4.12) : il s'écarte d'un nouveau venu (débutant, grâce
  // ou rampe) qui passe à portée de son orbite, qui le tuerait au moindre
  // contact. Ne pas le viser ni récolter près de lui ne suffisait pas : au
  // banc de survie, un joueur qui revient mourait plus souvent avant 30 s
  // (5,4 → 8,5 %, 24 graines), en croisant un champion en chemin. Au-dessus
  // de tout sauf la fuite et le mur.
  private scoreAvoidFresh(bot: Player) {
    if (this.fresh.length === 0) return null;
    const botReach = reachOf(bot);
    let ax = 0;
    let ay = 0;
    for (const f of this.fresh) {
      const dx = bot.x - f.x;
      const dy = bot.y - f.y;
      const d = Math.hypot(dx, dy);
      const keep = botReach + f.reach + CHAMPION_FRESH_KEEPOUT;
      if (d >= keep || d < 1e-3) continue;
      ax += (dx / d) * (keep - d);
      ay += (dy / d) * (keep - d);
    }
    const m = Math.hypot(ax, ay);
    if (m < 1e-6) return null;
    return { type: "avoid_fresh", score: 900, x: bot.x + (ax / m) * 20, y: bot.y + (ay / m) * 20, boost: false };
  }

  private scoreChase(bot: Player, arena: ArenaState, st: BotState) {
    let bestScore = -1;
    let bestId: string | null = null;
    let targetX = 0, targetY = 0;
    let shouldBoost = false;
    let speed = 1;

    let minBlades = 6;
    let aggroAdvantage = 3;

    if (st.personality === BotPersonality.Aggressive) {
      minBlades = 1;
      aggroAdvantage = -1;
    } else if (st.personality === BotPersonality.Hunter) {
      minBlades = 2;
      aggroAdvantage = 0;
    } else if (st.personality === BotPersonality.Farmer) {
      minBlades = 5;
      aggroAdvantage = 2;
    }

    if (bot.bladeCount < minBlades) return null;

    // Hysteresis de cible : bonus pour la cible courante. Empêche
    // l'oscillation entre deux cibles équivalentes (le bot reste engagé
    // avec celle qu'il poursuivait déjà). Bonus modeste — si une autre
    // cible est NETTEMENT meilleure (>20 d'écart), on switch quand même.
    const COMMITMENT_BONUS = 20;

    const nowMs = Date.now();
    // Bot facile : abandon d'une poursuite qui s'éternise, la cible est
    // ignorée un moment.
    const current = st.currentTargetId ? arena.players.get(st.currentTargetId) : undefined;
    if (current && nowMs - st.chaseSince > profileAgainst(st, current).giveUpMs) {
      st.ignoreId = current.id;
      st.ignoreUntil = nowMs + GIVE_UP_IGNORE_MS;
      st.currentTargetId = null;
    }
    arena.players.forEach((other) => {
      if (other.id === bot.id || !other.alive || sameTeam(bot.team, other.team)) return;
      if (other.id === st.ignoreId && nowMs < st.ignoreUntil) return;
      if (this.leavesAlone(bot, st, other)) return;
      if (this.isNewcomer(other, nowMs)) {
        const chaser = this.chasers.get(other.id);
        if (chaser !== undefined && chaser !== bot.id) return;
      }
      const bounty = other.id === this.leaderId ? this.leaderBounty : 0;
      if (bot.champion) {
        // Champion : des proies à sa mesure, jusqu'à ce qu'il fuirait.
        if (other.bladeCount < bot.bladeCount * CHAMPION_PREY_RATIO) return;
        if (other.bladeCount > bot.bladeCount * CHAMPION_FLEE_RATIO) return;
      } else if (bounty > 0) {
        if (bot.bladeCount < other.bladeCount * BOUNTY_HUNT_RATIO) return;
      } else if (other.bladeCount + aggroAdvantage > bot.bladeCount) return;
      const profile = profileAgainst(st, other);
      const radius = this.chaseRadiusFor(other, nowMs, profile.chaseRadius, arena);
      if (radius <= 0) return;
      if (this.hiddenFrom(bot, other)) return;

      const dx = other.x - bot.x;
      const dy = other.y - bot.y;
      const d = Math.hypot(dx, dy);

      if (d > radius) return;

      // Un champion préfère les proies les plus dignes de lui ; l'écart de
      // lames, compté tel quel, rendait négative toute proie plus grosse.
      let score = bot.champion
        ? 80 + 30 * (other.bladeCount / Math.max(1, bot.bladeCount)) - d * 0.5
        : 80 + (bot.bladeCount - other.bladeCount) * 5 - d;

      if (st.personality === BotPersonality.Hunter) score += 20;
      if (st.personality === BotPersonality.Aggressive) score += 40;

      // Bonus commitment si on poursuivait déjà cette cible.
      if (other.id === st.currentTargetId) score += COMMITMENT_BONUS;
      score += bounty * BOUNTY_HUNT_WEIGHT;

      // Anti-double-aggro
      let someoneCloser = false;
      arena.players.forEach((competitor) => {
        if (competitor.id === bot.id || !competitor.alive || !competitor.isBot) return;
        if (Math.hypot(competitor.x - other.x, competitor.y - other.y) < d * 0.8) {
          someoneCloser = true;
        }
      });
      // Pas pour le leader : à plusieurs, on peut le faire tomber.
      if (someoneCloser && bounty === 0) score -= 40;

      if (score > bestScore) {
        bestScore = score;
        bestId = other.id;
        // Aim au point d'interception : on prédit où l'ennemi sera quand on
        // arrive là-bas, pas sa position courante. Vitesse réelle (lissée)
        // depuis le cache, fallback sur l'input direction si la cible vient
        // d'apparaître. Lead time = d / PLAYER_SPEED (notre propre vitesse
        // d'approche, pas celle du projectile — on est en chase corps).
        const v = this.getVelocity(other.id);
        const leadT = d / Math.max(0.1, PLAYER_SPEED);
        targetX = other.x + v.vx * leadT;
        targetY = other.y + v.vy * leadT;
        shouldBoost = bot.champion
          ? d > CHAMPION_BOOST_MIN && d < CHAMPION_BOOST_MAX
          : profile.chaseBoost && bot.bladeCount > 5 && d > 15 && d < 40 && st.personality !== BotPersonality.Camper;
        speed = profile.chaseSpeed;
      }
    });

    if (bestScore <= 0) return null;
    // Mémorise la cible pour le prochain tick (commitment).
    if (bestId !== st.currentTargetId) st.chaseSince = nowMs;
    st.currentTargetId = bestId;
    st.chaseSpeed = speed;
    return { type: "chase", score: bestScore, x: targetX, y: targetY, boost: shouldBoost };
  }

  // Un bot difficile laisse les débutants tranquilles : ni poursuite, ni
  // lancer (les difficiles n'apparaissent plus quand il y en a, mais ceux
  // qui étaient là restent). Pendant la rampe de grâce d'un humain, seuls
  // les bots faciles, qu'on distance et qui abandonnent, s'en prennent à
  // lui : quand les bots ne restaient plus collés au bord de l'arène
  // (tâche 4.5), on mourait deux à cinq fois plus souvent avant 30 s. Pas
  // de répit gratuit : lancer ou toucher quelqu'un met fin à la rampe.
  private leavesAlone(bot: Player, st: BotState, other: Player): boolean {
    if (other.isBot) return false;
    if (st.skill === BotSkill.Hard && isBeginner(other)) return true;
    return st.skill !== BotSkill.Easy && other.graceRampUntil > Date.now();
  }

  private scoreFarmBlades(bot: Player, arena: ArenaState, st: BotState) {
    let bestScore = -1;
    let targetX = 0, targetY = 0;
    const farmRadius = bot.bladeCount < 6 ? 100 : 50;

    arena.blades.forEach((b) => {
      // Pas les lames en vol.
      if (b.ownerId || b.isProjectile) return;
      const dx = b.x - bot.x;
      const dy = b.y - bot.y;
      const d = Math.hypot(dx, dy);

      if (d > farmRadius) return;
      if (!reachable(arena, b.x, b.y)) return;
      if (this.nearGraced(bot, b.x, b.y)) return;

      let score = 40 - d * 0.5;
      if (st.personality === BotPersonality.Farmer) score += 20;
      if (bot.bladeCount < 3) score += 50;

      if (score > bestScore) {
        bestScore = score;
        targetX = b.x;
        targetY = b.y;
      }
    });

    if (bestScore <= 0) return null;
    return { type: "farm_blade", score: bestScore, x: targetX, y: targetY, boost: false };
  }

  private scoreFarmCrates(bot: Player, arena: ArenaState, st: BotState) {
    let bestScore = -1;
    let targetX = 0, targetY = 0;

    if (bot.bladeCount < 1) return null;

    arena.crates?.forEach((c) => {
      const dx = c.x - bot.x;
      const dy = c.y - bot.y;
      const d = Math.hypot(dx, dy);

      if (d > 60) return;
      if (!reachable(arena, c.x, c.y)) return;
      if (this.nearGraced(bot, c.x, c.y)) return;

      let score = 35 - d * 0.5;
      if (st.personality === BotPersonality.Farmer) score += 25;

      if (score > bestScore) {
        bestScore = score;
        targetX = c.x;
        targetY = c.y;
      }
    });

    if (bestScore <= 0) return null;
    return { type: "farm_crate", score: bestScore, x: targetX, y: targetY, boost: false };
  }

  private scoreFarmPowerups(bot: Player, arena: ArenaState, st: BotState) {
    let bestScore = -1;
    let targetX = 0, targetY = 0;

    arena.powerups?.forEach((pu) => {
      const dx = pu.x - bot.x;
      const dy = pu.y - bot.y;
      const d = Math.hypot(dx, dy);

      if (d > 70) return;
      if (!reachable(arena, pu.x, pu.y)) return;
      if (this.nearGraced(bot, pu.x, pu.y)) return;

      let score = 60 - d * 0.5;
      if (pu.type === 4 && bot.bladeCount < 5) score += 40;
      if (pu.type === 3) score += 20;

      if (score > bestScore) {
        bestScore = score;
        targetX = pu.x;
        targetY = pu.y;
      }
    });

    if (bestScore <= 0) return null;
    return { type: "farm_powerup", score: bestScore, x: targetX, y: targetY, boost: false };
  }

  private scoreWander(bot: Player, arena: ArenaState, st: BotState) {
    const distToTarget = Math.hypot(bot.x - st.targetX, bot.y - st.targetY);
    let tx = st.targetX;
    let ty = st.targetY;

    if (distToTarget < 5 || st.actionType !== "wander") {
      for (let tries = 0; tries < 4; tries++) {
        const r = Math.random() * Math.max(0, Math.min(zoneInner(arena, 10), botReachRadius(arena) - 4));
        const a = Math.random() * Math.PI * 2;
        tx = Math.cos(a) * r;
        ty = Math.sin(a) * r;
        if (!this.nearGraced(bot, tx, ty)) break;
      }
    }

    let score = 10;
    if (st.personality === BotPersonality.Camper) score += 15;

    return { type: "wander", score, x: tx, y: ty, boost: false };
  }

  // Score « éviter le mur ». Se déclenche quand le bot entre dans la zone
  // de danger (entre botSafeRadius - 5 et le rayon de mort). Plus il est
  // proche du bord, plus le score est élevé (dépasse le flee).
  private scoreAvoidWall(bot: Player, arena: ArenaState) {
    const distFromCenter = Math.hypot(bot.x, bot.y);
    const dangerStart = botSafeRadius(arena) - 5;

    if (distFromCenter < dangerStart) return null;

    const killRadius = arena.mapRadius - WALL_KILL_THICKNESS;
    const urgency = Math.min(1, (distFromCenter - dangerStart) / (killRadius - dangerStart));

    // Viser vers le centre, proportionnel à l'urgence.
    const nx = distFromCenter > 0.001 ? -bot.x / distFromCenter : 0;
    const ny = distFromCenter > 0.001 ? -bot.y / distFromCenter : 0;

    return {
      type: "avoid_wall",
      score: 2000 + urgency * 1000, // Dépasse le flee (1000+)
      x: bot.x + nx * 25,
      y: bot.y + ny * 25,
      boost: urgency > 0.7 && bot.bladeCount > 1, // boost d'urgence
    };
  }

  private applyInput(bot: Player, st: BotState, now: number, safeRadius: number): void {
    const dx = st.targetX - bot.x;
    const dy = st.targetY - bot.y;
    const d = Math.hypot(dx, dy);

    if (d < 0.5) {
      bot.inputDx = 0;
      bot.inputDy = 0;
      return;
    }

    let angle = Math.atan2(dy, dx);
    angle += st.jitterAngle; // jitter de visée fixe par décision

    // Approche en courbe : en chase à moyenne distance (8-40u), on ajoute
    // une oscillation perpendiculaire qui module l'angle de marche. Au
    // lieu de foncer en ligne droite, le bot trace un arc. Amplitude
    // décroît avec la distance (effet plus marqué loin, presque nul de
    // près pour ne pas rater l'impact). Phase déterministe depuis now +
    // curvePhaseOffset → chaque bot oscille sur son propre cycle.
    if (st.actionType === "chase" && d > 8 && d < 40) {
      const t = now * 1.4 + st.curvePhaseOffset;
      const distAttenuation = Math.min(1, (d - 8) / 20); // 0 à d=8, 1 à d=28+
      const curveAmp = 0.32 * st.curveSign * distAttenuation; // ~18° max
      angle += Math.sin(t) * curveAmp;
    }

    const pace = st.actionType === "chase" ? st.chaseSpeed : 1;
    let dirX = Math.cos(angle) * pace;
    let dirY = Math.sin(angle) * pace;

    // ── Filet de sécurité temps-réel ──
    // Entre deux décisions, le bot peut encore dériver vers le mur
    // (knockback, inertie). Si on est proche et qu'on se dirige vers
    // l'extérieur, on redirige immédiatement vers le centre.
    const distFromCenter = Math.hypot(bot.x, bot.y);
    if (distFromCenter > safeRadius - 3 && distFromCenter > 0.001) {
      // Produit scalaire direction · radiale : >0 = on s'éloigne du centre
      const radX = bot.x / distFromCenter;
      const radY = bot.y / distFromCenter;
      const dot = dirX * radX + dirY * radY;
      if (dot > 0) {
        // Rediriger vers le centre
        dirX = -radX;
        dirY = -radY;
      }
    }

    bot.inputDx = dirX;
    bot.inputDy = dirY;
  }

  // Tente un lancer, visé par le champ aim comme celui d'un humain : la
  // direction ne dépend plus du sens de marche. En chasse, sur la cible
  // poursuivie ; en fuite, sur le poursuivant (Hunter et Aggressive
  // seulement, les autres courent) ; en récolte de caisses, sur la caisse
  // visée (Farmer et Camper). Errance, évitement du mur et ramassage : pas
  // de lancer.
  private tryThrow(bot: Player, arena: ArenaState, st: BotState): void {
    const now = Date.now();
    if (bot.throwCooldownUntil > now) return;

    // Seuil de lames mini par personnalité : un bot qui n'a presque rien
    // ne gaspille pas une lame en projectile, il préfère farmer.
    let minBlades = 6;
    if (st.personality === BotPersonality.Aggressive) minBlades = 4;
    else if (st.personality === BotPersonality.Hunter) minBlades = 5;
    else if (st.personality === BotPersonality.Farmer) minBlades = 9;
    else if (st.personality === BotPersonality.Camper) minBlades = 7;
    if (st.urgent) minBlades = 2;
    if (bot.bladeCount < minBlades) return;

    // Plage de portée utile : trop près (<12) le projectile clash sur ses
    // propres lames ; au-delà de la portée max, la lame retombe au sol et
    // le tir est gaspillé (le bot ne touche rien). Petite marge anti-fuite
    // pour que la cible n'esquive pas trivialement en marchant en arrière.
    const minDist = 12;
    const maxDist = THROW_PROJECTILE_MAX_RANGE - 2;

    let aim: { x: number; y: number } | null = null;
    // Joueur visé (pas une caisse) : le niveau du bot s'applique à un humain.
    let victim: Player | null = null;
    if (st.actionType === "chase" && st.currentTargetId) {
      const target = arena.players.get(st.currentTargetId);
      if (target) {
        aim = this.leadAim(bot, target, now, minDist, maxDist, profileAgainst(st, target).aimReaction);
        victim = target;
      }
    } else if (
      st.actionType === "flee" &&
      (st.personality === BotPersonality.Hunter || st.personality === BotPersonality.Aggressive)
    ) {
      // Poursuivant = menace (plus de lames) la plus proche.
      let pursuer = null as Player | null;
      let best = Infinity;
      arena.players.forEach((other) => {
        if (other.id === bot.id || !other.alive || other.bladeCount <= bot.bladeCount || sameTeam(bot.team, other.team)) return;
        if (other.graceUntil > now || this.hiddenFrom(bot, other) || this.leavesAlone(bot, st, other)) return;
        const d = Math.hypot(other.x - bot.x, other.y - bot.y);
        if (d < best) { best = d; pursuer = other; }
      });
      if (pursuer) {
        aim = this.leadAim(bot, pursuer, now, minDist, maxDist, profileAgainst(st, pursuer).aimReaction);
        victim = pursuer;
      }
    } else if (
      st.actionType === "farm_crate" &&
      (st.personality === BotPersonality.Farmer || st.personality === BotPersonality.Camper)
    ) {
      // Caisse visée par la décision (la plus proche du point cible).
      // Statique : pas d'intercept à calculer.
      let crateX = 0;
      let crateY = 0;
      let best = Infinity;
      arena.crates?.forEach((c) => {
        if (c.hp <= 0) return;
        const d = Math.hypot(c.x - st.targetX, c.y - st.targetY);
        if (d < best) { best = d; crateX = c.x; crateY = c.y; }
      });
      if (best < 1) {
        const d = Math.hypot(crateX - bot.x, crateY - bot.y);
        if (d >= minDist && d <= maxDist) aim = { x: (crateX - bot.x) / d, y: (crateY - bot.y) / d };
      }
    }
    if (!aim) return;
    const profile = victim ? profileAgainst(st, victim) : SKILLS[BotSkill.Normal];
    const onHuman = victim !== null && !victim.isBot;
    if (onHuman && st.nextThrowAt > now) return;

    // Erreur de visée uniforme par personnalité (rad). Avant la visée libre,
    // le bot tirait dès que la cible entrait dans un cône de 20 à 35° autour
    // de sa marche, et l'erreur allait jusqu'à ce demi-angle. Valeurs
    // calibrées en simulation (joueur débutant face aux bots d'une room
    // chauffée) pour garder la létalité des lancers d'avant : la visée libre
    // change d'où partent les lancers, pas combien ils tuent. Avec 0,08 à
    // 0,2 rad, les éliminations par lancer doublaient.
    let spread = 0.3;
    if (st.personality === BotPersonality.Hunter) spread = 0.18;
    else if (st.personality === BotPersonality.Aggressive) spread = 0.45;
    spread *= profile.aimSpread;
    const angle = Math.atan2(aim.y, aim.x) + (Math.random() * 2 - 1) * spread;
    bot.aimX = Math.cos(angle);
    bot.aimY = Math.sin(angle);
    bot.inputThrow = true;
    if (onHuman) st.nextThrowAt = now + profile.throwPauseMs;
  }

  // Direction (normalisée) vers le point d'interception d'une cible, ou
  // null si elle est hors de portée utile, protégée ou en période de grâce.
  // On aligne sur où la cible SERA quand le projectile arrive (pas où elle
  // est) : sans ça les bots ratent toute cible en mouvement à >12u. La
  // vitesse cible vient du cache lissé (vraie vitesse incluant knockback,
  // pas juste l'intent input).
  private leadAim(
    bot: Player,
    target: Player,
    now: number,
    minDist: number,
    maxDist: number,
    reaction: number,
  ): { x: number; y: number } | null {
    if (!target.alive || target.spawnProtectionUntil > now || target.graceUntil > now) return null;
    // Jamais sur un allié (modes équipe) : le projectile le traverserait.
    if (sameTeam(bot.team, target.team)) return null;
    if (this.hiddenFrom(bot, target)) return null;
    const d = Math.hypot(target.x - bot.x, target.y - bot.y);
    if (d < minDist || d > maxDist) return null;
    const v = this.reactedVelocity(target.id, now / 1000, reaction);
    const intercept = predictIntercept(bot.x, bot.y, target.x, target.y, v.vx, v.vy, THROW_PROJECTILE_SPEED);
    const idx = intercept.x - bot.x;
    const idy = intercept.y - bot.y;
    const idd = Math.hypot(idx, idy);
    // L'intercept doit rester DANS la portée — si la cible file, il peut
    // sortir de maxDist et la lame finirait au sol.
    if (idd < 0.1 || idd > maxDist) return null;
    return { x: idx / idd, y: idy / idd };
  }

  cleanupDead(arena: ArenaState): void {
    const toRemove: string[] = [];
    arena.players.forEach((p) => {
      if (!p.isBot || p.alive) return;
      toRemove.push(p.id);
      if (p.champion) this.nextChampionAt = Date.now() + CHAMPION_RESPAWN_MS;
    });
    for (const id of toRemove) {
      const bladeIds: string[] = [];
      arena.blades.forEach((b) => {
        if (b.ownerId === id) bladeIds.push(b.id);
      });
      for (const bid of bladeIds) arena.blades.delete(bid);
      arena.players.delete(id);
      this.state.delete(id);
    }
  }
}
