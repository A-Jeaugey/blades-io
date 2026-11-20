// Agents (docs/AGENTS.md) : des personnages jouables qui ont chacun une
// capacité (recharge) et un ultime (jauge). Ce module est le contrat entre
// le serveur, qui applique les capacités, et le client, qui les demande,
// les prédit (déplacement du joueur local) et les montre. Tous les agents
// sont gratuits et égaux : aucun ne se débloque, aucun ne s'achète.
//
// Les chiffres sont ceux de la première version, réglés au banc
// (tools/bench-agents.js) ; le design et ses raisons sont dans
// docs/AGENTS.md.

import { PLAYER_BODY_RADIUS } from "./constants";
import type { GameMap } from "./maps";
import { sameTeam } from "./modes";
import type { MoveContext, PullField } from "./movement";
import type { TickStamped } from "./types";

export type AgentId = "volt" | "sagaie" | "brume" | "vortex" | "vigie" | "rempart";
export type AgentRole = "duelist" | "controller" | "initiator" | "guardian";

// Ordre d'affichage (lobby, aide).
export const AGENT_IDS: readonly AgentId[] = ["volt", "sagaie", "brume", "vortex", "vigie", "rempart"];
// Agent d'un joueur qui n'a rien choisi (première partie) : un bond, la
// capacité la plus intuitive.
export const DEFAULT_AGENT: AgentId = "volt";

// Visée d'une capacité (InputMessage.castX/castY, u depuis le joueur) :
// bornée à cette valeur sur chaque axe par le serveur ; le client la réduit
// d'abord d'un même facteur sur les deux, sinon la borne d'un seul axe
// tournerait la direction (et l'Éclair prédit ne serait plus celui du
// serveur). Toutes les portées sont bien en deçà.
export const CAST_VECTOR_MAX = 100;

// Emplacement demandé dans un input (InputMessage.cast).
export enum CastSlot {
  Ability = 1,
  Ultimate = 2,
}

// Effet à durée propre à l'agent, actif sur le joueur lui-même
// (Player.agentEffect, jusqu'à agentEffectUntil). Un seul à la fois : les
// effets d'un même agent ne se recouvrent jamais.
export enum AgentEffect {
  None = 0,
  Surge = 1, // Volt, Surtension
  Barrage = 2, // Sagaie, Rafale
  Eclipse = 3, // Brume, Éclipse
  Aegis = 4, // Rempart, Égide
  Bastion = 5, // Rempart, Bastion
}

// Effets visibles des autres joueurs (Player.agentFx) : un bit par effet,
// plus le ralentissement d'un piège.
export function agentFxBit(effect: AgentEffect): number {
  return effect === AgentEffect.None ? 0 : 1 << (effect - 1);
}
export const AGENT_FX_SNARED = 1 << 5;

// Zones posées par les capacités (ArenaState.zones).
export enum ZoneKind {
  Smoke = 0, // Brume, Nuée : cache qui est dedans
  Trap = 1, // Vortex, Piège : invisible des adversaires
  Well = 2, // Vortex, Singularité : attire vers le centre
  Shockwave = 3, // Vigie, Onde : préavis, puis l'onde
}

export interface AgentInfo {
  id: AgentId;
  role: AgentRole;
  // Recharge de la capacité (ms).
  abilityCooldownMs: number;
  // Prix de l'ultime sur la jauge (ULT_CHARGE_MAX au plus).
  ultCost: number;
  // L'ultime est un effet à durée (Surtension, Rafale, Éclipse, Bastion)
  // et non une zone : sa durée (ms), 0 sinon.
  ultEffect: AgentEffect;
  ultDurationMs: number;
}

// --- VOLT : Éclair (bond) et Surtension ----------------------------------
// Le bond est une impulsion qui s'amortit comme un recul (KNOCKBACK_DECAY,
// 0,18 s) : 46 × 0,18 ≈ 8 u en une demi-seconde. Il passe par le recul,
// hors du plafond de vitesse du boost : sous Speed, il ne va pas plus loin.
export const DASH_IMPULSE = 46;
// 8 s : à 7, Volt passait devant les autres au banc (éliminations / morts
// 1,17, score +8 % sur 32 graines).
export const DASH_COOLDOWN_MS = 8000;
export const SURGE_DURATION_MS = 6000;
export const SURGE_DASH_COOLDOWN_MS = 1500;

// --- SAGAIE : Salve et Rafale --------------------------------------------
// Trois lancers d'un coup, en éventail (écart entre deux voisins, rad) :
// une lame au centre, deux éclats (comme ceux de la Rafale) sur les côtés.
// À trois lames, la Salve affaiblissait Sagaie plus qu'elle ne la servait
// (éliminations / morts 0,85 au banc sur 32 graines).
export const VOLLEY_COUNT = 3;
export const VOLLEY_SPREAD = 0.175;
// 11 s : à 9, pour une lame, Sagaie passait devant les autres (score +12 %
// au banc sur 32 graines) ; à 11, +7 %, dans le bruit de la mesure.
export const VOLLEY_COOLDOWN_MS = 11000;
// Rafale : lancers sans lame, deux fois plus rapprochés. Les éclats sont des
// Communes à un impact qui disparaissent en retombant (aucune lame créée).
export const BARRAGE_DURATION_MS = 4000;
export const BARRAGE_THROW_COOLDOWN_MS = 250;

// --- BRUME : Nuée et Éclipse ---------------------------------------------
export const SMOKE_RADIUS = 6.5;
export const SMOKE_DURATION_MS = 7000;
export const SMOKE_RANGE = 22;
export const SMOKE_COOLDOWN_MS = 16000;
export const ECLIPSE_DURATION_MS = 7000;

// --- VORTEX : Piège et Singularité ---------------------------------------
export const TRAP_COOLDOWN_MS = 10000;
export const TRAP_ARM_MS = 1000;
export const TRAP_LIFETIME_MS = 60000;
export const TRAP_MAX = 2;
// Rayon du piège ; il se déclenche quand le corps d'un adversaire le touche.
export const TRAP_RADIUS = 2.2;
export const TRAP_TRIGGER_DIST = TRAP_RADIUS + PLAYER_BODY_RADIUS;
export const TRAP_SLOW_MULT = 0.6;
export const TRAP_SLOW_MS = 2500;
export const TRAP_REVEAL_MS = 4000;
// Le puits : préavis, puis attraction vers le centre. 7 u/s contre 11 u/s
// de marche : on en sort, lentement, ou au boost.
export const WELL_RANGE = 24;
export const WELL_DEFAULT_DIST = 10;
export const WELL_RADIUS = 11;
export const WELL_WINDUP_MS = 500;
export const WELL_DURATION_MS = 3500;
export const WELL_PULL = 7;
// Près du centre, l'attraction s'éteint sur cette distance (u) : sans ça, un
// joueur au centre y oscillerait d'un pas à l'autre.
export const WELL_CORE = 1.5;
// Lames au sol aspirées (u/s).
export const WELL_LOOT_PULL = 14;

// --- VIGIE : Sonar et Onde ------------------------------------------------
export const SONAR_RADIUS = 38;
export const SONAR_REVEAL_MS = 4000;
export const SONAR_COOLDOWN_MS = 14000;
// L'Onde reprend l'onde des obélisques (shared/src/interactive.ts : recul
// PULSE_KNOCKBACK, lames arrachées pulseShedCount).
export const SHOCKWAVE_WINDUP_MS = 600;
export const SHOCKWAVE_RADIUS = 12;

// --- REMPART : Égide et Bastion ------------------------------------------
export const AEGIS_DURATION_MS = 2500;
export const AEGIS_COOLDOWN_MS = 15000;
export const BASTION_DURATION_MS = 5000;
export const BASTION_SPEED_MULT = 0.85;

// --- Ultime : la jauge -----------------------------------------------------
// Des sources plates (un gros joueur ne charge pas plus vite qu'un petit) ;
// la charge survit à la mort, pas à un changement d'agent.
export const ULT_CHARGE_MAX = 100;
export const ULT_CHARGE_PER_SECOND = 1;
export const ULT_CHARGE_KILL = 20;
export const ULT_CHARGE_CRATE = 5;
export const ULT_CHARGE_POWERUP = 3;

export const AGENTS: Readonly<Record<AgentId, AgentInfo>> = {
  volt: { id: "volt", role: "duelist", abilityCooldownMs: DASH_COOLDOWN_MS, ultCost: 100, ultEffect: AgentEffect.Surge, ultDurationMs: SURGE_DURATION_MS },
  sagaie: { id: "sagaie", role: "duelist", abilityCooldownMs: VOLLEY_COOLDOWN_MS, ultCost: 100, ultEffect: AgentEffect.Barrage, ultDurationMs: BARRAGE_DURATION_MS },
  brume: { id: "brume", role: "controller", abilityCooldownMs: SMOKE_COOLDOWN_MS, ultCost: 100, ultEffect: AgentEffect.Eclipse, ultDurationMs: ECLIPSE_DURATION_MS },
  vortex: { id: "vortex", role: "controller", abilityCooldownMs: TRAP_COOLDOWN_MS, ultCost: 100, ultEffect: AgentEffect.None, ultDurationMs: 0 },
  vigie: { id: "vigie", role: "initiator", abilityCooldownMs: SONAR_COOLDOWN_MS, ultCost: 100, ultEffect: AgentEffect.None, ultDurationMs: 0 },
  rempart: { id: "rempart", role: "guardian", abilityCooldownMs: AEGIS_COOLDOWN_MS, ultCost: 100, ultEffect: AgentEffect.Bastion, ultDurationMs: BASTION_DURATION_MS },
};

// hasOwnProperty : l'identifiant vient du client.
export function isAgentId(id: unknown): id is AgentId {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(AGENTS, id);
}

export function agentInfo(id: string): AgentInfo | null {
  return isAgentId(id) ? AGENTS[id] : null;
}

// Recharge d'une capacité, Surtension comprise (Éclair presque sans pause).
export function abilityCooldownMs(agent: AgentId, surging: boolean): number {
  if (agent === "volt" && surging) return SURGE_DASH_COOLDOWN_MS;
  return AGENTS[agent].abilityCooldownMs;
}

// Direction d'une capacité dirigée (Éclair, Salve) : la visée si elle en a
// une, sinon la marche, sinon la dernière direction de marche. Nulle si rien
// ne donne de direction.
export function castDirection(
  castX: number,
  castY: number,
  moveX: number,
  moveY: number,
  faceX: number,
  faceY: number,
): { x: number; y: number } {
  for (const [x, y] of [[castX, castY], [moveX, moveY], [faceX, faceY]] as const) {
    const m = Math.hypot(x, y);
    if (m > 0.05) return { x: x / m, y: y / m };
  }
  return { x: 0, y: 0 };
}

// Point visé d'une capacité posée (Nuée, Singularité) : le vecteur de visée
// (depuis le joueur, en u) borné à la portée ; sans visée, à ses pieds
// (Nuée) ou à quelques pas devant (Singularité). Piège : toujours à ses
// pieds. Le client trace le même point que celui que le serveur retiendra.
export function castPoint(
  agent: AgentId,
  slot: CastSlot,
  px: number,
  py: number,
  castX: number,
  castY: number,
  faceX: number,
  faceY: number,
): { x: number; y: number } {
  const len = Math.hypot(castX, castY);
  if (agent === "brume" && slot === CastSlot.Ability) {
    if (len < 0.5) return { x: px, y: py };
    const k = Math.min(len, SMOKE_RANGE) / len;
    return { x: px + castX * k, y: py + castY * k };
  }
  if (agent === "vortex" && slot === CastSlot.Ultimate) {
    if (len < 0.5) {
      const f = Math.hypot(faceX, faceY);
      return f > 1e-3 ? { x: px + (faceX / f) * WELL_DEFAULT_DIST, y: py + (faceY / f) * WELL_DEFAULT_DIST } : { x: px, y: py };
    }
    const k = Math.min(len, WELL_RANGE) / len;
    return { x: px + castX * k, y: py + castY * k };
  }
  return { x: px, y: py };
}

// La capacité se vise-t-elle à un point du sol (et non dans une direction) ?
export function castIsPlaced(agent: AgentId, slot: CastSlot): boolean {
  return (agent === "brume" && slot === CastSlot.Ability) || (agent === "vortex" && slot === CastSlot.Ultimate);
}

// La capacité se vise-t-elle dans une direction (Éclair, Salve) ?
export function castIsAimed(agent: AgentId, slot: CastSlot): boolean {
  return slot === CastSlot.Ability && (agent === "volt" || agent === "sagaie");
}

// --- Déplacement -----------------------------------------------------------
// Ce que le pas de mouvement d'un joueur doit savoir de lui, lu par le
// serveur sur le Player et par la prédiction sur l'état acquitté.
export interface MoverState {
  speedUntil: number;
  hitlagUntil: number;
  bladeCount: number;
  slowUntil: number;
  agentEffect: number;
  agentEffectUntil: number;
  // Protection d'apparition : aucun puits ; nouveau venu que les capacités
  // des bots épargnent (botSpareUntilOf côté serveur) : aucun puits de bot.
  spawnProtectionUntil: number;
  botSpareUntil: number;
}

// Un puits (zone Singularité), tel que le pas de mouvement le lit.
export interface WellField {
  x: number;
  y: number;
  radius: number;
  startsAt: number;
  endsAt: number;
  ownerId: string;
  team: number;
  // Posé par un bot : sans effet sur un nouveau venu (botSpareUntil).
  bot: boolean;
}

const NO_PULLS: readonly PullField[] = [];

// Contexte du pas de mouvement d'un joueur à l'heure t (ms, heure du
// serveur) : le même au serveur et dans la prédiction du client, sinon
// chaque pas sous l'effet d'une capacité serait à corriger. Bastion ignore
// ralentissement et attraction ; Surtension permet le boost sans lame.
export function moveContextAt(
  s: MoverState,
  selfId: string,
  team: number,
  t: number,
  map: GameMap | null,
  wells: readonly WellField[],
): MoveContext {
  const active = s.agentEffectUntil > t ? s.agentEffect : AgentEffect.None;
  const bastion = active === AgentEffect.Bastion;
  const surge = active === AgentEffect.Surge;
  let speedMult = 1;
  if (bastion) speedMult = BASTION_SPEED_MULT;
  else if (s.slowUntil > t) speedMult = TRAP_SLOW_MULT;
  let pulls: PullField[] | null = null;
  // Un joueur protégé n'est pas attiré (docs/AGENTS.md, principe 5).
  if (!bastion && s.spawnProtectionUntil <= t) {
    for (const w of wells) {
      if (t < w.startsAt || t >= w.endsAt || w.ownerId === selfId || sameTeam(w.team, team)) continue;
      if (w.bot && s.botSpareUntil > t) continue;
      (pulls ??= []).push({ x: w.x, y: w.y, radius: w.radius, strength: WELL_PULL, core: WELL_CORE });
    }
  }
  return {
    speed: s.speedUntil > t,
    frozen: s.hitlagUntil > t,
    canBoost: s.bladeCount > 0 || surge,
    map,
    speedMult,
    pulls: pulls ?? NO_PULLS,
  };
}

// --- Messages ---------------------------------------------------------------
// Serveur → clients : une capacité vient d'être lancée (effets, sons).
// x, y : le lanceur ; tx, ty : le point visé (capacités posées) ; dirX, dirY :
// la direction (capacités dirigées).
export interface AbilityCastEvent extends TickStamped {
  playerId: string;
  agent: AgentId;
  slot: CastSlot;
  x: number;
  y: number;
  tx?: number;
  ty?: number;
  dirX?: number;
  dirY?: number;
}

// Serveur → le joueur repéré (Sonar, Piège) : jusqu'à quand.
export interface RevealedEvent {
  by: string;
  until: number;
}

// Serveur → poseur, victime et alentours : un piège s'est refermé.
export interface TrapSprungEvent extends TickStamped {
  x: number;
  y: number;
  victimId: string;
  ownerId: string;
}

// Serveur → alentours : l'Onde de Vigie part (après son préavis).
export interface ShockwaveEvent extends TickStamped {
  x: number;
  y: number;
  radius: number;
  playerId: string;
  hit: string[];
}
