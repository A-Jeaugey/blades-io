import {
  BladeRarity,
  DECOR_COLLIDERS,
  MAP_RADIUS,
  POWERUP_BLADES_COUNT,
  POWERUP_DURATION,
  POWERUP_HITBOX,
  POWERUP_MAX_TOTAL,
  POWERUP_MIN_DIST_FROM_PLAYER,
  POWERUP_MIN_FLOOR,
  POWERUP_PER_PLAYER,
  POWERUP_RARITY_WEIGHTS,
  POWERUP_SPAWN_INTERVAL,
  POWERUP_TYPE_WEIGHTS,
  PowerUpType,
  RARITY_HP,
  WALL_KILL_THICKNESS,
} from "@bladeio/shared";
import { ArenaState } from "../state/ArenaState";
import { Blade } from "../state/Blade";
import { Player } from "../state/Player";
import { PowerUp } from "../state/PowerUp";
import { attachBladeToPlayer } from "./pickup";
import { randomId } from "../utils/ids";

function pickRarity(): BladeRarity {
  const r = Math.random();
  let acc = 0;
  for (const e of POWERUP_RARITY_WEIGHTS) {
    acc += e.weight;
    if (r <= acc) return e.rarity;
  }
  return BladeRarity.Common;
}

function pickType(): PowerUpType {
  const r = Math.random();
  let acc = 0;
  for (const e of POWERUP_TYPE_WEIGHTS) {
    acc += e.weight;
    if (r <= acc) return e.type;
  }
  return PowerUpType.Speed;
}

function targetCount(playerCount: number): number {
  const scaled = POWERUP_PER_PLAYER * Math.max(1, playerCount);
  return Math.min(POWERUP_MAX_TOTAL, Math.max(POWERUP_MIN_FLOOR, scaled));
}

function insideAnyDecor(x: number, y: number, margin: number): boolean {
  for (const d of DECOR_COLLIDERS) {
    const dx = x - d.x;
    const dy = y - d.y;
    const r = d.radius + margin;
    if (dx * dx + dy * dy < r * r) return true;
  }
  return false;
}

function pickSpawnPoint(state: ArenaState): { x: number; y: number } | null {
  const innerRadius = MAP_RADIUS - WALL_KILL_THICKNESS - 4;
  for (let tries = 0; tries < 30; tries++) {
    const r = Math.sqrt(Math.random()) * innerRadius;
    const a = Math.random() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (insideAnyDecor(x, y, 2)) continue;
    let ok = true;
    state.players.forEach((p) => {
      if (!p.alive) return;
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy < POWERUP_MIN_DIST_FROM_PLAYER * POWERUP_MIN_DIST_FROM_PLAYER) {
        ok = false;
      }
    });
    if (!ok) continue;
    state.powerups.forEach((pu) => {
      const dx = pu.x - x;
      const dy = pu.y - y;
      if (dx * dx + dy * dy < 5 * 5) ok = false;
    });
    if (ok) return { x, y };
  }
  return null;
}

export class PowerUpSystem {
  // Timer initialisé à l'intervalle de spawn pour que le PREMIER tick
  // déclenche déjà un spawn ; sinon il faudrait attendre 2 s avant de
  // voir quoi que ce soit sur la map.
  private timer = POWERUP_SPAWN_INTERVAL;

  // Spawn + pickup + expiration des effets. Le pickup applique l'effet
  // directement via setFields sur le Player : le client lit les `*Until`
  // sur son propre state et affiche les badges d'effet.
  update(dt: number, state: ArenaState, onPickup: (p: Player, pu: PowerUp) => void): void {
    this.timer += dt;
    if (this.timer >= POWERUP_SPAWN_INTERVAL) {
      this.timer = 0;
      const want = targetCount(state.players.size);
      const have = state.powerups.size;
      // Burst 4 pour remplir vite au début + combler rapidement les pickups.
      const spawns = Math.min(4, Math.max(0, want - have));
      for (let i = 0; i < spawns; i++) {
        const pos = pickSpawnPoint(state);
        if (!pos) break;
        const pu = new PowerUp();
        pu.id = randomId();
        pu.type = pickType();
        pu.rarity = pickRarity();
        pu.x = pos.x;
        pu.y = pos.y;
        state.powerups.set(pu.id, pu);
      }
    }

    // Pickup : joueur vivant à portée.
    // BUG 6.2 FIX : un seul joueur peut ramasser un power-up donné par tick.
    // On flag le power-up comme « déjà pris » dès le premier pickup pour
    // empêcher un deuxième joueur de le ramasser sur la même frame.
    const hitSq = POWERUP_HITBOX * POWERUP_HITBOX;
    const picked: string[] = [];
    state.powerups.forEach((pu) => {
      let alreadyPicked = false;
      state.players.forEach((p) => {
        if (alreadyPicked) return;
        if (!p.alive) return;
        const dx = p.x - pu.x;
        const dy = p.y - pu.y;
        if (dx * dx + dy * dy <= hitSq) {
          this.applyEffect(state, p, pu);
          onPickup(p, pu);
          picked.push(pu.id);
          alreadyPicked = true;
        }
      });
    });
    for (const id of picked) state.powerups.delete(id);
  }

  private applyEffect(state: ArenaState, p: Player, pu: PowerUp): void {
    const rarity = pu.rarity as BladeRarity;
    const durationMs = POWERUP_DURATION[rarity] * 1000;
    const now = Date.now();
    // On étend toujours : si on ramasse un SPEED alors qu'on a déjà SPEED,
    // on prolonge jusqu'à max(currentUntil, now + duration) plutôt que de
    // reset.
    switch (pu.type as PowerUpType) {
      case PowerUpType.Speed:
        p.speedUntil = Math.max(p.speedUntil, now + durationMs);
        break;
      case PowerUpType.Spin:
        p.spinUntil = Math.max(p.spinUntil, now + durationMs);
        break;
      case PowerUpType.Magnet:
        p.magnetUntil = Math.max(p.magnetUntil, now + durationMs);
        break;
      case PowerUpType.Shield:
        p.shieldUntil = Math.max(p.shieldUntil, now + durationMs);
        // Heal les lames en orbite à pleine HP pour sentir l'effet.
        state.blades.forEach((b) => {
          if (b.ownerId === p.id) b.hp = RARITY_HP[b.rarity as BladeRarity];
        });
        break;
      case PowerUpType.Blades: {
        // Instant : attache N lames Common supplémentaires.
        const n = POWERUP_BLADES_COUNT[rarity];
        for (let i = 0; i < n; i++) {
          const b = new Blade();
          b.id = randomId();
          b.rarity = BladeRarity.Common;
          b.hp = RARITY_HP[BladeRarity.Common];
          state.blades.set(b.id, b);
          attachBladeToPlayer(state, p, b);
        }
        break;
      }
    }
  }
}
