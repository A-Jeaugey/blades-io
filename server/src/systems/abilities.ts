import {
  AEGIS_DURATION_MS,
  AGENTS,
  AGENT_FX_SNARED,
  AbilityCastEvent,
  AgentEffect,
  AgentId,
  BARRAGE_DURATION_MS,
  BASTION_DURATION_MS,
  CastSlot,
  DASH_IMPULSE,
  ECLIPSE_DURATION_MS,
  RevealedEvent,
  SHOCKWAVE_RADIUS,
  SHOCKWAVE_WINDUP_MS,
  SMOKE_DURATION_MS,
  SMOKE_RADIUS,
  SONAR_RADIUS,
  SONAR_REVEAL_MS,
  SURGE_DASH_COOLDOWN_MS,
  SURGE_DURATION_MS,
  TRAP_ARM_MS,
  TRAP_LIFETIME_MS,
  TRAP_MAX,
  TRAP_RADIUS,
  TRAP_REVEAL_MS,
  TRAP_SLOW_MS,
  TRAP_TRIGGER_DIST,
  TrapSprungEvent,
  ULT_CHARGE_CRATE,
  ULT_CHARGE_KILL,
  ULT_CHARGE_MAX,
  ULT_CHARGE_PER_SECOND,
  ULT_CHARGE_POWERUP,
  VOLLEY_COUNT,
  VOLLEY_SPREAD,
  WELL_DURATION_MS,
  WELL_LOOT_PULL,
  WELL_RADIUS,
  WELL_WINDUP_MS,
  WellField,
  ZoneKind,
  abilityCooldownMs,
  agentFxBit,
  castDirection,
  castPoint,
  isAgentId,
  sameTeam,
} from "@bladeio/shared";
import { ArenaState } from "../state/ArenaState";
import { Player } from "../state/Player";
import { Zone } from "../state/Zone";
import { randomId } from "../utils/ids";
import { Concealment, activeEffect } from "./agentEffects";
import type { EventScope } from "./interest";

// Capacités des agents (shared/src/agents.ts, docs/AGENTS.md). Une demande
// arrive avec l'input d'un humain (InputMessage.cast) ou de la décision d'un
// bot, et s'applique au pas de déplacement de cet input (updateMovement) :
// l'impulsion d'un Éclair part au même pas que dans la prédiction du
// client. Le reste (jauge de l'ultime, fins d'effets, zones, pièges, puits,
// Onde) avance une fois par tick (update).
//
// Rien d'hostile ne touche un allié, un joueur sous protection
// d'apparition, ni (si le lanceur est un bot) un débutant que les bots
// épargnent : mêmes règles que les lames.

export interface AbilityHost {
  readonly state: ArenaState;
  // En jeu (pas pendant l'entracte d'un mode à fin).
  playing(): boolean;
  emit(type: string, payload: object, scope?: EventScope): void;
  // Lance la lame extérieure de l'orbite dans cette direction (Salve) ;
  // faux s'il n'y a plus de lame. phantom : un éclat, sans lame.
  launchThrow(p: Player, dirX: number, dirY: number, now: number, phantom?: boolean): boolean;
  // L'Onde de Vigie part de (x, y) : recul et lames arrachées.
  shockwave(owner: Player, x: number, y: number, now: number): void;
  // Une capacité offensive lève la grâce de son auteur, comme un lancer.
  endGrace(p: Player): void;
}

// Impulsion d'un Éclair, posée sur le pas de l'input qui l'a demandé.
export interface CastImpulse {
  impulseX: number;
  impulseY: number;
}

type CastOutcome = CastImpulse | boolean;

export class AbilitySystem {
  readonly conceal = new Concealment();
  // Puits posés (préavis compris), lus par le pas de mouvement de chaque
  // joueur (moveContextAt), tenus à jour par update.
  readonly wells: WellField[] = [];

  constructor(private readonly host: AbilityHost) {}

  // Agent d'un joueur ("" : aucun). Un changement remet la jauge à zéro :
  // on ne passe pas un ultime chargé à un autre kit.
  setAgent(p: Player, agent: string): void {
    if (p.agent === agent) return;
    p.agent = agent;
    p.ultPoints = 0;
    p.ultCharge = 0;
    p.abilityReadyAt = 0;
    this.clearEffects(p);
  }

  // Nouvelle vie : capacité prête, effets levés. La jauge de l'ultime
  // survit à la mort (un mécanisme de retour, pas une prime au plus fort).
  startLife(p: Player): void {
    p.abilityReadyAt = 0;
    p.reveals.length = 0;
    p.botCast = null;
    this.clearEffects(p);
  }

  // Triche de test (/ult) : ultime chargé, capacité prête.
  refill(p: Player): void {
    p.ultPoints = ULT_CHARGE_MAX;
    p.ultCharge = ULT_CHARGE_MAX;
    p.abilityReadyAt = 0;
  }

  // Nouvelle partie (restartMatch) : tout le monde repart à égalité.
  resetMatch(): void {
    for (const id of [...this.host.state.zones.keys()]) this.host.state.zones.delete(id);
    this.wells.length = 0;
    this.host.state.players.forEach((p) => {
      p.ultPoints = 0;
      p.ultCharge = 0;
    });
  }

  // Mort : effets levés ; une Onde en préavis ne part pas. Nuages, pièges et
  // puits restent jusqu'à leur fin.
  onDeath(p: Player): void {
    this.clearEffects(p);
    p.botCast = null;
    const doomed: string[] = [];
    this.host.state.zones.forEach((z) => {
      if (z.ownerId === p.id && z.kind === ZoneKind.Shockwave) doomed.push(z.id);
    });
    for (const id of doomed) this.host.state.zones.delete(id);
  }

  // Départ : ses zones disparaissent avec lui.
  removePlayer(id: string): void {
    const doomed: string[] = [];
    this.host.state.zones.forEach((z) => {
      if (z.ownerId === id) doomed.push(z.id);
    });
    for (const zid of doomed) this.host.state.zones.delete(zid);
  }

  onKill(killer: Player | null): void {
    if (killer) this.charge(killer, ULT_CHARGE_KILL);
  }

  onCrate(attacker: Player | null): void {
    if (attacker) this.charge(attacker, ULT_CHARGE_CRATE);
  }

  onPowerUp(p: Player): void {
    this.charge(p, ULT_CHARGE_POWERUP);
  }

  // Demande d'une capacité (slot) avec sa visée (castX, castY : vecteur
  // depuis le joueur) et la marche de ce pas (moveX, moveY : direction d'un
  // Éclair ou d'une Salve sans visée). Refusée sans bruit (recharge, jauge,
  // mort, entracte) ; renvoie l'impulsion d'un Éclair accepté.
  cast(p: Player, slot: number, castX: number, castY: number, moveX: number, moveY: number, now: number): CastImpulse | null {
    if (!p.alive || !this.host.playing() || !isAgentId(p.agent)) return null;
    const agent = p.agent;
    const cx = Number.isFinite(castX) ? castX : 0;
    const cy = Number.isFinite(castY) ? castY : 0;
    if (slot === CastSlot.Ability) {
      if (now < p.abilityReadyAt) return null;
      const out = this.castAbility(p, agent, cx, cy, moveX, moveY, now);
      if (out === false) return null;
      p.abilityReadyAt = now + abilityCooldownMs(agent, activeEffect(p, now) === AgentEffect.Surge);
      return out === true ? null : out;
    }
    if (slot === CastSlot.Ultimate) {
      const cost = AGENTS[agent].ultCost;
      if (p.ultPoints < cost) return null;
      if (!this.castUltimate(p, agent, cx, cy, now)) return null;
      p.ultPoints = Math.max(0, p.ultPoints - cost);
      p.ultCharge = Math.floor(p.ultPoints);
    }
    return null;
  }

  update(dt: number, now: number): void {
    const state = this.host.state;
    const playing = this.host.playing();
    state.players.forEach((p) => {
      if (!p.agent) {
        if (p.agentFx !== 0) p.agentFx = 0;
        return;
      }
      if (p.alive && playing && p.ultPoints < ULT_CHARGE_MAX) {
        p.ultPoints = Math.min(ULT_CHARGE_MAX, p.ultPoints + ULT_CHARGE_PER_SECOND * dt);
        const shown = Math.floor(p.ultPoints);
        if (shown !== p.ultCharge) p.ultCharge = shown;
      }
      if (p.agentEffect !== AgentEffect.None && p.agentEffectUntil <= now) {
        p.agentEffect = AgentEffect.None;
        p.agentEffectUntil = 0;
      }
      const fx = p.alive ? agentFxBit(activeEffect(p, now)) | (p.slowUntil > now ? AGENT_FX_SNARED : 0) : 0;
      if (p.agentFx !== fx) p.agentFx = fx;
      if (p.reveals.length > 0) {
        let w = 0;
        for (const r of p.reveals) if (r.until > now) p.reveals[w++] = r;
        p.reveals.length = w;
      }
    });

    this.wells.length = 0;
    const traps: Zone[] = [];
    const doomed: string[] = [];
    state.zones.forEach((z) => {
      if (z.kind === ZoneKind.Shockwave) {
        if (!z.fired && now >= z.startsAt) {
          z.fired = true;
          doomed.push(z.id);
          const owner = state.players.get(z.ownerId);
          if (owner?.alive && playing) this.host.shockwave(owner, z.x, z.y, now);
        }
        return;
      }
      if (now >= z.endsAt) {
        doomed.push(z.id);
        return;
      }
      if (z.kind === ZoneKind.Well) {
        this.wells.push({ x: z.x, y: z.y, radius: z.radius, startsAt: z.startsAt, endsAt: z.endsAt, ownerId: z.ownerId, team: z.team, bot: z.bot });
        if (now >= z.startsAt) this.pullLoot(z, dt);
      } else if (z.kind === ZoneKind.Trap && now >= z.startsAt) {
        traps.push(z);
      }
    });
    for (const z of traps) if (this.checkTrap(z, now)) doomed.push(z.id);
    for (const id of doomed) state.zones.delete(id);
    this.conceal.refresh(state, now);
  }

  // --- Capacités ----------------------------------------------------------

  private castAbility(p: Player, agent: AgentId, cx: number, cy: number, mx: number, my: number, now: number): CastOutcome {
    switch (agent) {
      case "volt": {
        const dir = castDirection(cx, cy, mx, my, p.dirX, p.dirY);
        if (dir.x === 0 && dir.y === 0) return false;
        this.announce(p, CastSlot.Ability, { dirX: dir.x, dirY: dir.y });
        return { impulseX: dir.x * DASH_IMPULSE, impulseY: dir.y * DASH_IMPULSE };
      }
      case "sagaie": {
        if (p.bladeCount <= 0) return false;
        const dir = castDirection(cx, cy, mx, my, p.dirX, p.dirY);
        if (dir.x === 0 && dir.y === 0) return false;
        // Une lame au centre, des éclats sur les côtés : la Salve coûte une
        // lame.
        const base = Math.atan2(dir.y, dir.x);
        if (!this.host.launchThrow(p, dir.x, dir.y, now)) return false;
        for (let i = 1; i < VOLLEY_COUNT; i++) {
          const offset = (i % 2 === 1 ? -1 : 1) * Math.ceil(i / 2) * VOLLEY_SPREAD;
          this.host.launchThrow(p, Math.cos(base + offset), Math.sin(base + offset), now, true);
        }
        this.host.endGrace(p);
        this.announce(p, CastSlot.Ability, { dirX: dir.x, dirY: dir.y });
        return true;
      }
      case "brume": {
        const at = castPoint("brume", CastSlot.Ability, p.x, p.y, cx, cy, p.dirX, p.dirY);
        this.addZone(p, ZoneKind.Smoke, at.x, at.y, SMOKE_RADIUS, now, now + SMOKE_DURATION_MS);
        this.announce(p, CastSlot.Ability, { tx: at.x, ty: at.y });
        return true;
      }
      case "vortex": {
        // Deux pièges au plus : le plus ancien saute.
        const mine: Zone[] = [];
        this.host.state.zones.forEach((z) => {
          if (z.kind === ZoneKind.Trap && z.ownerId === p.id) mine.push(z);
        });
        mine.sort((a, b) => a.createdAt - b.createdAt);
        while (mine.length >= TRAP_MAX) this.host.state.zones.delete(mine.shift()!.id);
        this.addZone(p, ZoneKind.Trap, p.x, p.y, TRAP_RADIUS, now + TRAP_ARM_MS, now + TRAP_LIFETIME_MS);
        this.host.endGrace(p);
        // Secret : seuls le poseur et ses alliés l'apprennent.
        this.announce(p, CastSlot.Ability, { tx: p.x, ty: p.y }, true);
        return true;
      }
      case "vigie": {
        this.host.state.players.forEach((t) => {
          if (!t.alive || t.id === p.id || sameTeam(p.team, t.team)) return;
          // Le Sonar d'un bot ne débusque pas un nouveau venu.
          if (p.isBot && t.botSpareUntil > now) return;
          const dx = t.x - p.x;
          const dy = t.y - p.y;
          if (dx * dx + dy * dy > SONAR_RADIUS * SONAR_RADIUS) return;
          this.reveal(t, p, now + SONAR_REVEAL_MS);
        });
        this.announce(p, CastSlot.Ability, {});
        return true;
      }
      case "rempart": {
        // Bastion en cours : l'Égide n'y ajouterait rien (et le raccourcirait).
        if (activeEffect(p, now) === AgentEffect.Bastion) return false;
        this.setEffect(p, AgentEffect.Aegis, now + AEGIS_DURATION_MS);
        this.announce(p, CastSlot.Ability, {});
        return true;
      }
    }
    return false;
  }

  private castUltimate(p: Player, agent: AgentId, cx: number, cy: number, now: number): boolean {
    switch (agent) {
      case "volt":
        this.setEffect(p, AgentEffect.Surge, now + SURGE_DURATION_MS);
        p.abilityReadyAt = Math.min(p.abilityReadyAt, now + SURGE_DASH_COOLDOWN_MS);
        break;
      case "sagaie":
        this.setEffect(p, AgentEffect.Barrage, now + BARRAGE_DURATION_MS);
        this.host.endGrace(p);
        break;
      case "brume":
        this.setEffect(p, AgentEffect.Eclipse, now + ECLIPSE_DURATION_MS);
        break;
      case "vortex": {
        const at = castPoint("vortex", CastSlot.Ultimate, p.x, p.y, cx, cy, p.dirX, p.dirY);
        const starts = now + WELL_WINDUP_MS;
        this.addZone(p, ZoneKind.Well, at.x, at.y, WELL_RADIUS, starts, starts + WELL_DURATION_MS);
        this.host.endGrace(p);
        this.announce(p, CastSlot.Ultimate, { tx: at.x, ty: at.y });
        return true;
      }
      case "vigie": {
        const fire = now + SHOCKWAVE_WINDUP_MS;
        this.addZone(p, ZoneKind.Shockwave, p.x, p.y, SHOCKWAVE_RADIUS, fire, fire);
        this.host.endGrace(p);
        break;
      }
      case "rempart":
        this.setEffect(p, AgentEffect.Bastion, now + BASTION_DURATION_MS);
        // Insensible au ralentissement : celui d'un piège tombe.
        p.slowUntil = 0;
        break;
    }
    this.announce(p, CastSlot.Ultimate, {});
    return true;
  }

  // --- Zones ---------------------------------------------------------------

  private addZone(p: Player, kind: ZoneKind, x: number, y: number, radius: number, startsAt: number, endsAt: number): Zone {
    const z = new Zone();
    z.id = randomId();
    z.kind = kind;
    z.x = x;
    z.y = y;
    z.radius = radius;
    z.ownerId = p.id;
    z.team = p.team;
    z.bot = p.isBot;
    z.startsAt = startsAt;
    z.endsAt = endsAt;
    z.createdAt = startsAt;
    this.host.state.zones.set(z.id, z);
    return z;
  }

  // Un piège armé se referme sur le premier adversaire qui le touche :
  // ralenti (sauf sous Bastion) et révélé à son poseur. Vrai s'il a servi.
  private checkTrap(z: Zone, now: number): boolean {
    const state = this.host.state;
    const owner = state.players.get(z.ownerId) ?? null;
    let victim: Player | null = null;
    state.players.forEach((v) => {
      if (victim || !v.alive || v.id === z.ownerId || sameTeam(z.team, v.team)) return;
      if (v.spawnProtectionUntil > now) return;
      if (owner?.isBot && v.botSpareUntil > now) return;
      const dx = v.x - z.x;
      const dy = v.y - z.y;
      if (dx * dx + dy * dy > TRAP_TRIGGER_DIST * TRAP_TRIGGER_DIST) return;
      victim = v;
    });
    if (!victim) return false;
    const v = victim as Player;
    if (activeEffect(v, now) !== AgentEffect.Bastion) v.slowUntil = now + TRAP_SLOW_MS;
    if (owner) this.reveal(v, owner, now + TRAP_REVEAL_MS);
    const ev: Omit<TrapSprungEvent, "tick"> = { x: z.x, y: z.y, victimId: v.id, ownerId: z.ownerId };
    this.host.emit("trapSprung", ev, { to: [z.ownerId, v.id], players: [v.id] });
    return true;
  }

  // Lames au sol aspirées vers le centre d'un puits actif.
  private pullLoot(z: Zone, dt: number): void {
    const r2 = z.radius * z.radius;
    const step = WELL_LOOT_PULL * dt;
    this.host.state.blades.forEach((b) => {
      if (b.ownerId || b.isProjectile) return;
      const dx = z.x - b.x;
      const dy = z.y - b.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2 || d2 < 0.09) return;
      const d = Math.sqrt(d2);
      const s = Math.min(d - 0.3, step) / d;
      b.x += dx * s;
      b.y += dy * s;
    });
  }

  // --- Joueurs -------------------------------------------------------------

  private reveal(target: Player, by: Player, until: number): void {
    const team = by.team;
    const prev = target.reveals.find((r) => r.by === by.id);
    if (prev) prev.until = Math.max(prev.until, until);
    else target.reveals.push({ by: by.id, team, until });
    const ev: RevealedEvent = { by: by.id, until };
    this.host.emit("revealed", ev, { to: [target.id] });
  }

  private charge(p: Player, amount: number): void {
    if (!p.agent || p.ultPoints >= ULT_CHARGE_MAX) return;
    p.ultPoints = Math.min(ULT_CHARGE_MAX, p.ultPoints + amount);
    p.ultCharge = Math.floor(p.ultPoints);
  }

  private setEffect(p: Player, effect: AgentEffect, until: number): void {
    p.agentEffect = effect;
    p.agentEffectUntil = until;
    p.agentFx = agentFxBit(effect) | (p.agentFx & AGENT_FX_SNARED);
  }

  private clearEffects(p: Player): void {
    p.agentEffect = AgentEffect.None;
    p.agentEffectUntil = 0;
    p.slowUntil = 0;
    p.agentFx = 0;
  }

  // Évènement de lancement (effets et sons) : aux clients qui voient son
  // auteur, jamais au-delà (un joueur caché qui lance une capacité ne se
  // trahit pas) ; un piège, à son poseur et à ses alliés seulement.
  private announce(p: Player, slot: CastSlot, extra: Partial<AbilityCastEvent>, secret = false): void {
    const ev: Omit<AbilityCastEvent, "tick"> = { playerId: p.id, agent: p.agent as AgentId, slot, x: p.x, y: p.y, ...extra };
    if (!secret) {
      this.host.emit("abilityCast", ev, { to: [p.id], players: [p.id] });
      return;
    }
    const allies: string[] = [p.id];
    if (p.team !== 0) this.host.state.players.forEach((o) => { if (o.team === p.team) allies.push(o.id); });
    this.host.emit("abilityCast", ev, { to: allies });
  }
}
