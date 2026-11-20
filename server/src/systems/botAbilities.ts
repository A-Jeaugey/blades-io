import {
  AGENTS,
  CastSlot,
  DASH_IMPULSE,
  KNOCKBACK_DECAY,
  SHOCKWAVE_RADIUS,
  SONAR_RADIUS,
  WELL_RANGE,
  ZoneKind,
  isAgentId,
  sameTeam,
} from "@bladeio/shared";
import { ArenaState } from "../state/ArenaState";
import { Player } from "../state/Player";

// Capacités des bots (agents, docs/AGENTS.md) : des règles simples, par
// agent, selon ce que le bot est en train de faire (poursuite, fuite,
// récolte) et ce qui l'entoure. Elles servent aussi d'adversaire au banc
// d'équilibrage (tools/bench-agents.js) : il mesure la puissance brute de
// chaque kit joué ainsi, pas le talent d'un joueur.
//
// Jamais contre un nouveau venu (débutant, ou dans les 50 s qui suivent son
// apparition : grâce puis rampe) : un bot qui en poursuit un ne lance rien
// vers lui (bots.ts, planCast), et un nouveau venu ne déclenche ni Onde ni
// Sonar. Les effets de zone épargnent en plus, côté serveur, les débutants
// en grâce que les bots épargnent (sparedByBots).

export interface BotCastContext {
  now: number;
  arena: ArenaState;
  // Action en cours (decide) et sa cible éventuelle.
  action: string;
  target: Player | null;
  // Lames perdues ces 3 dernières secondes.
  threatLevel: number;
  // Chance qu'une occasion soit saisie à cette décision (niveau du bot).
  eagerness: number;
  // Rayon sûr de l'arène (on ne bondit pas vers le mur).
  safeRadius: number;
  // Le bot voit-il ce joueur (buisson, Nuée, Éclipse, immeuble) ?
  sees(other: Player): boolean;
  // Joueur que le bot ménage (nouveau venu) : jamais la raison d'une
  // capacité.
  spares(other: Player): boolean;
  // Direction (normalisée) vers le point d'interception d'une cible, null
  // hors de portée de lancer.
  leadAim(target: Player): { x: number; y: number } | null;
}

export interface BotCast {
  slot: number;
  x: number;
  y: number;
}

// Distance parcourue par un Éclair (impulsion amortie comme un recul).
const DASH_REACH = DASH_IMPULSE * KNOCKBACK_DECAY;

export function planBotCast(bot: Player, c: BotCastContext): BotCast | null {
  const agent = bot.agent;
  if (!isAgentId(agent) || !bot.alive) return null;
  if (Math.random() > c.eagerness) return null;
  const abilityReady = c.now >= bot.abilityReadyAt;
  const ultReady = bot.ultPoints >= AGENTS[agent].ultCost;
  if (!abilityReady && !ultReady) return null;

  const target = c.target && c.target.alive ? c.target : null;
  const td = target ? Math.hypot(target.x - bot.x, target.y - bot.y) : Infinity;
  const threat = nearestThreat(bot, c);
  const hd = threat ? Math.hypot(threat.x - bot.x, threat.y - bot.y) : Infinity;
  const chasing = c.action === "chase" && target !== null;
  const fleeing = c.action === "flee" && threat !== null;

  switch (agent) {
    case "volt": {
      if (abilityReady && chasing && td >= 6 && td <= 16 && target!.bladeCount <= bot.bladeCount * 1.2) {
        return toward(bot, target!.x, target!.y, CastSlot.Ability);
      }
      if (abilityReady && fleeing && hd < 12) {
        const away = safeDash(bot, bot.x - threat!.x, bot.y - threat!.y, c.safeRadius);
        if (away) return { slot: CastSlot.Ability, ...away };
      }
      if (ultReady && ((chasing && td < 30) || (fleeing && hd < 15))) return self(CastSlot.Ultimate);
      return null;
    }
    case "sagaie": {
      if (abilityReady && chasing && td >= 10 && td <= 26 && bot.bladeCount >= 8) {
        const aim = c.leadAim(target!);
        if (aim) return { slot: CastSlot.Ability, x: aim.x * td, y: aim.y * td };
      }
      if (ultReady && chasing && td >= 8 && td <= 26) return self(CastSlot.Ultimate);
      return null;
    }
    case "brume": {
      if (abilityReady && ((fleeing && hd < 14) || c.threatLevel >= 2)) return self(CastSlot.Ability);
      if (ultReady && ((fleeing && hd < 18) || (chasing && td >= 14 && td <= 35))) return self(CastSlot.Ultimate);
      return null;
    }
    case "vortex": {
      if (ultReady && chasing && td >= 6 && td <= WELL_RANGE) {
        // Au point où sera la cible, un peu en deçà : elle tombe dans le
        // puits en continuant sa course.
        const aim = c.leadAim(target!);
        const d = Math.min(WELL_RANGE, td);
        if (aim) return { slot: CastSlot.Ultimate, x: aim.x * d, y: aim.y * d };
        return toward(bot, target!.x, target!.y, CastSlot.Ultimate, d);
      }
      if (abilityReady && (fleeing ? hd < 18 : (c.action === "farm_crate" || c.action === "wander") && Math.random() < 0.15 && ownTraps(bot, c.arena) < 2)) {
        return self(CastSlot.Ability);
      }
      return null;
    }
    case "vigie": {
      if (abilityReady && (hiddenEnemyNear(bot, c) || (chasing && Math.random() < 0.3))) return self(CastSlot.Ability);
      if (ultReady && bot.bladeCount >= 4 && enemiesWithin(bot, c, SHOCKWAVE_RADIUS - 4) >= 1) return self(CastSlot.Ultimate);
      return null;
    }
    case "rempart": {
      if (ultReady && ((chasing && td < 10) || c.threatLevel >= 2)) return self(CastSlot.Ultimate);
      if (abilityReady && (c.threatLevel >= 1 || (chasing && td < 8))) return self(CastSlot.Ability);
      return null;
    }
  }
  return null;
}

function self(slot: number): BotCast {
  return { slot, x: 0, y: 0 };
}

function toward(bot: Player, x: number, y: number, slot: number, dist?: number): BotCast | null {
  const dx = x - bot.x;
  const dy = y - bot.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-3) return null;
  const k = (dist ?? d) / d;
  return { slot, x: dx * k, y: dy * k };
}

// Bond de fuite, détourné (d'un quart de tour au plus) s'il menait au mur.
function safeDash(bot: Player, dx: number, dy: number, safeRadius: number): { x: number; y: number } | null {
  const d = Math.hypot(dx, dy);
  if (d < 1e-3) return null;
  const base = Math.atan2(dy, dx);
  for (const turn of [0, 0.6, -0.6, 1.2, -1.2]) {
    const a = base + turn;
    const ex = bot.x + Math.cos(a) * DASH_REACH;
    const ey = bot.y + Math.sin(a) * DASH_REACH;
    if (Math.hypot(ex, ey) < safeRadius - 4) return { x: Math.cos(a), y: Math.sin(a) };
  }
  return null;
}

// Menace la plus proche : un adversaire visible plus gros que le bot.
function nearestThreat(bot: Player, c: BotCastContext): Player | null {
  let best: Player | null = null;
  let bestD = Infinity;
  c.arena.players.forEach((o) => {
    if (o === bot || !o.alive || sameTeam(bot.team, o.team) || o.bladeCount <= bot.bladeCount) return;
    if (!c.sees(o)) return;
    const d = Math.hypot(o.x - bot.x, o.y - bot.y);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  });
  return best;
}

// Adversaires visibles et vulnérables (ni nouveaux venus, ni protégés) dans
// un rayon.
function enemiesWithin(bot: Player, c: BotCastContext, radius: number): number {
  let n = 0;
  c.arena.players.forEach((o) => {
    if (o === bot || !o.alive || sameTeam(bot.team, o.team)) return;
    if (o.graceUntil > c.now || o.spawnProtectionUntil > c.now || c.spares(o) || !c.sees(o)) return;
    if (Math.hypot(o.x - bot.x, o.y - bot.y) <= radius) n++;
  });
  return n;
}

// Un adversaire caché au bot à portée de Sonar : la raison d'en lancer un.
function hiddenEnemyNear(bot: Player, c: BotCastContext): boolean {
  let found = false;
  c.arena.players.forEach((o) => {
    if (found || o === bot || !o.alive || sameTeam(bot.team, o.team) || o.graceUntil > c.now || c.spares(o)) return;
    if (Math.hypot(o.x - bot.x, o.y - bot.y) > SONAR_RADIUS) return;
    if (!c.sees(o)) found = true;
  });
  return found;
}

function ownTraps(bot: Player, arena: ArenaState): number {
  let n = 0;
  arena.zones.forEach((z) => {
    if (z.kind === ZoneKind.Trap && z.ownerId === bot.id) n++;
  });
  return n;
}
