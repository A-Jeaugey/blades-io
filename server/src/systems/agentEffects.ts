import { AgentEffect, BUSH_REVEAL_MARGIN, ZoneKind, isInBush } from "@bladeio/shared";
import { ArenaState } from "../state/ArenaState";
import { Player } from "../state/Player";

// Effets d'agent lus par les autres systèmes (collisions, projectiles,
// zones d'intérêt, bots). Sans dépendance vers eux : abilities.ts les
// importe, eux importent ce module.

export function activeEffect(p: Player, now: number): AgentEffect {
  return p.agentEffectUntil > now ? (p.agentEffect as AgentEffect) : AgentEffect.None;
}

// Égide ou Bastion : ses lames en orbite ne peuvent être ni brisées ni
// arrachées.
export function bladesProtected(p: Player, now: number): boolean {
  const e = activeEffect(p, now);
  return e === AgentEffect.Aegis || e === AgentEffect.Bastion;
}

// Bastion : ni recul, ni gel du clash, ni ralentissement, ni attraction.
export function immovable(p: Player, now: number): boolean {
  return activeEffect(p, now) === AgentEffect.Bastion;
}

// Ce qui cache un joueur : buisson (arène ronde), nuage de Brume, Éclipse ;
// et ce qui le révèle quand même : un Sonar ou un piège, à qui l'a lancé et
// à son équipe. Recalculé une fois par tick (refresh), lu par les zones
// d'intérêt, le résumé de la minimap et les bots.
export class Concealment {
  private smokes: Array<{ x: number; y: number; r2: number }> = [];
  private now = 0;
  private hasMap = false;

  refresh(state: ArenaState, now: number): void {
    this.now = now;
    this.hasMap = state.map !== null;
    this.smokes.length = 0;
    state.zones.forEach((z) => {
      if (z.kind === ZoneKind.Smoke && z.startsAt <= now && now < z.endsAt) {
        this.smokes.push({ x: z.x, y: z.y, r2: z.radius * z.radius });
      }
    });
  }

  inSmoke(x: number, y: number): boolean {
    for (const s of this.smokes) {
      const dx = x - s.x;
      const dy = y - s.y;
      if (dx * dx + dy * dy <= s.r2) return true;
    }
    return false;
  }

  // Caché (buisson, nuage, Éclipse), sauf porteur de drapeau, visible de
  // tous.
  isConcealed(p: Player): boolean {
    if (p.revealed) return false;
    if (p.agentEffect === AgentEffect.Eclipse && p.agentEffectUntil > this.now) return true;
    if (!this.hasMap && isInBush(p.x, p.y)) return true;
    return this.smokes.length > 0 && this.inSmoke(p.x, p.y);
  }

  // Révélé à ce joueur, ou à son équipe, par un Sonar ou un piège.
  revealedTo(p: Player, viewerId: string, viewerTeam: number): boolean {
    for (const r of p.reveals) {
      if (r.until <= this.now) continue;
      if (r.by === viewerId || (r.team !== 0 && r.team === viewerTeam)) return true;
    }
    return false;
  }

  // Caché à cet observateur : caché, pas révélé à lui, et trop loin pour
  // que leurs orbites se touchent (même marge que les buissons : on ne se
  // bat jamais contre des lames invisibles).
  hiddenFrom(target: Player, targetReach: number, viewer: Player, viewerReach: number): boolean {
    if (!this.isConcealed(target)) return false;
    if (this.revealedTo(target, viewer.id, viewer.team)) return false;
    const reveal = viewerReach + targetReach + BUSH_REVEAL_MARGIN;
    const dx = target.x - viewer.x;
    const dy = target.y - viewer.y;
    return dx * dx + dy * dy > reveal * reveal;
  }
}
