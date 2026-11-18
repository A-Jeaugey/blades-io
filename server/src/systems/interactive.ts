import {
  CrateKind,
  PULSE_CHARGE,
  PULSE_COOLDOWN_MS,
  PULSE_OBELISKS,
  PULSE_REGEN_DELAY_MS,
  PULSE_REGEN_PER_S,
  PULSE_WARNING_MS,
  RACK_HP,
  RACK_RESPAWN_MS,
  RACK_SITES,
} from "@bladeio/shared";
import { ArenaState } from "../state/ArenaState";
import { Crate } from "../state/Crate";
import { Player } from "../state/Player";
import { LOOT_WALL_MARGIN, zoneInner } from "./spawnPoint";

// Décor interactif (shared/src/interactive.ts) : racks à butin et
// obélisques qui se chargent. Chaque pièce est une caisse à place fixe et à
// identifiant fixe, que ce système remet en place quand elle a servi : le
// combat, les lancers, les PV et les dégâts sont ceux de toutes les caisses
// (collisions.ts, throws.ts, crateDamage.ts).

// Onde en attente : armée, elle part à `at`. Son auteur et son équipe sont
// retenus tels qu'au dernier coup : il peut être mort ou parti d'ici là.
export interface PendingPulse {
  x: number;
  y: number;
  at: number;
  ownerId: string;
  ownerTeam: number;
}

interface Site {
  id: string;
  kind: number;
  x: number;
  y: number;
  // Heure du serveur à partir de laquelle la pièce peut revenir.
  readyAt: number;
  // Obélisque : fraction de PV de la charge qui retombe, reportée d'un tick
  // à l'autre (les PV sont entiers).
  regenCarry: number;
}

export class InteractiveSystem {
  private readonly sites: Site[] = [];
  private pulses: PendingPulse[] = [];
  private readonly due: PendingPulse[] = [];

  constructor() {
    RACK_SITES.forEach((s, i) => this.sites.push({ id: `rack-${i}`, kind: CrateKind.Rack, x: s.x, y: s.y, readyAt: 0, regenCarry: 0 }));
    PULSE_OBELISKS.forEach((s, i) => this.sites.push({ id: `obelisk-${i}`, kind: CrateKind.Obelisk, x: s.x, y: s.y, readyAt: 0, regenCarry: 0 }));
  }

  // Partie suivante (l'arène vient d'être vidée) : tout revient tout de
  // suite, aucune onde ne survit au changement de manche.
  reset(): void {
    for (const s of this.sites) {
      s.readyAt = 0;
      s.regenCarry = 0;
    }
    this.pulses = [];
  }

  // Remet en place les pièces prêtes, fait retomber la charge des obélisques
  // délaissés, et renvoie les ondes qui partent à ce tick (tableau réutilisé
  // d'un appel à l'autre).
  update(dt: number, state: ArenaState, now: number): readonly PendingPulse[] {
    // Une pièce hors de l'arène du moment (resserrée en fin de manche,
    // réglée sur la population) ne revient pas : le mur l'emporterait.
    const inner = zoneInner(state, LOOT_WALL_MARGIN);
    for (const s of this.sites) {
      const c = state.crates.get(s.id);
      if (!c) {
        if (now < s.readyAt || s.x * s.x + s.y * s.y > inner * inner) continue;
        this.place(state, s);
        continue;
      }
      if (s.kind !== CrateKind.Obelisk || c.hp >= c.maxHp || c.hp <= 0) continue;
      if (now - c.lastDamageAt < PULSE_REGEN_DELAY_MS) continue;
      s.regenCarry += PULSE_REGEN_PER_S * dt;
      const whole = Math.floor(s.regenCarry);
      if (whole <= 0) continue;
      s.regenCarry -= whole;
      c.hp = Math.min(c.maxHp, c.hp + whole);
    }

    this.due.length = 0;
    if (this.pulses.length > 0) {
      const waiting: PendingPulse[] = [];
      for (const p of this.pulses) (now >= p.at ? this.due : waiting).push(p);
      this.pulses = waiting;
    }
    return this.due;
  }

  // La pièce vient d'être vidée (rack) ou chargée à fond (obélisque) : elle
  // reviendra après son délai. Pour un obélisque, renvoie l'onde armée.
  onDestroyed(crate: Crate, attacker: Player | null, now: number): PendingPulse | null {
    const site = this.sites.find((s) => s.id === crate.id);
    if (!site) return null;
    site.regenCarry = 0;
    if (site.kind === CrateKind.Rack) {
      site.readyAt = now + RACK_RESPAWN_MS;
      return null;
    }
    site.readyAt = now + PULSE_WARNING_MS + PULSE_COOLDOWN_MS;
    const pulse: PendingPulse = {
      x: site.x,
      y: site.y,
      at: now + PULSE_WARNING_MS,
      ownerId: attacker?.id ?? "",
      ownerTeam: attacker?.team ?? 0,
    };
    this.pulses.push(pulse);
    return pulse;
  }

  private place(state: ArenaState, s: Site): void {
    const c = new Crate();
    c.id = s.id;
    c.x = s.x;
    c.y = s.y;
    c.kind = s.kind;
    c.hp = c.maxHp = s.kind === CrateKind.Rack ? RACK_HP : PULSE_CHARGE;
    s.regenCarry = 0;
    state.crates.set(c.id, c);
  }
}
