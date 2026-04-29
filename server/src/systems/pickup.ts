import {
  BladeRarity,
  MAX_BLADES_PER_PLAYER,
  PICKUP_RADIUS,
  RARITY_HP,
} from "@bladeio/shared";
import { ArenaState } from "../state/ArenaState";
import { Blade } from "../state/Blade";
import { Player } from "../state/Player";
import { SpatialHash } from "../utils/spatialHash";
import { assignSlot, ringCapacity } from "./orbits";

export interface PickupResult {
  player: Player;
  blade: Blade;
}

// Assigne un (ringIndex, slotIndex) à une lame nouvellement acquise par un joueur.
export function attachBladeToPlayer(state: ArenaState, player: Player, blade: Blade): void {
  // Compter les lames par anneau pour le joueur
  const countPerRing = new Map<number, number>();
  state.blades.forEach((b) => {
    if (b.ownerId === player.id) {
      countPerRing.set(b.ringIndex, (countPerRing.get(b.ringIndex) ?? 0) + 1);
    }
  });
  let ring = 0;
  while (true) {
    const cap = ringCapacity(ring);
    const cur = countPerRing.get(ring) ?? 0;
    if (cur < cap) {
      blade.ringIndex = ring;
      blade.slotIndex = cur; // sera recompacté à la position uniforme par le tick
      break;
    }
    ring++;
    if (ring > 64) break; // sécurité
  }
  blade.ownerId = player.id;
  blade.vx = 0;
  blade.vy = 0;
  // Au pickup la lame regen ses HP : sinon une lame Common ramassée avec
  // 1 PV restera fragile à vie même sans avoir combattu.
  blade.hp = RARITY_HP[blade.rarity as BladeRarity];
  player.bladeCount++;
  player.bladeIds.push(blade.id);
  if (player.bladeCount > player.maxBladeCount) player.maxBladeCount = player.bladeCount;
  player.score = player.maxBladeCount;
}

export class PickupSystem {
  update(
    state: ArenaState,
    onPickup: (player: Player, blade: Blade) => void,
  ): void {
    const now = Date.now();
    // Grille sur les lames au sol
    const groundHash = new SpatialHash<{ id: string; x: number; y: number }>(PICKUP_RADIUS * 2);
    const groundBlades: Blade[] = [];
    state.blades.forEach((b) => {
      if (b.isProjectile) return; // une lame en vol n'est pas ramassable
      if (!b.ownerId && b.pickupLockUntil <= now) {
        groundHash.insert({ id: b.id, x: b.x, y: b.y });
        groundBlades.push(b);
      }
    });

    state.players.forEach((p) => {
      if (!p.alive) return;
      if (p.bladeCount >= MAX_BLADES_PER_PLAYER) return;
      const near = groundHash.query(p.x, p.y, PICKUP_RADIUS);
      for (const item of near) {
        const b = state.blades.get(item.id);
        if (!b || b.ownerId) continue;
        const dx = b.x - p.x;
        const dy = b.y - p.y;
        if (dx * dx + dy * dy <= PICKUP_RADIUS * PICKUP_RADIUS) {
          if (p.bladeCount >= MAX_BLADES_PER_PLAYER) break;
          attachBladeToPlayer(state, p, b);
          onPickup(p, b);
        }
      }
    });
  }
}
