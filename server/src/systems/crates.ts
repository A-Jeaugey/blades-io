import {
  BladeRarity,
  CRATE_DROP_MAX,
  CRATE_DROP_MIN,
  CRATE_DROP_SPEED,
  CRATE_HP,
  CRATE_LOOT_WEIGHTS,
  CRATE_MAX_TOTAL,
  CRATE_MIN_DIST_FROM_PLAYER,
  CRATE_MIN_FLOOR,
  CRATE_PER_PLAYER,
  CRATE_SPAWN_INTERVAL,
  DECOR_COLLIDERS,
  GROUND_BLADE_TTL_MS,
  MAP_RADIUS,
  RARITY_HP,
  WALL_KILL_THICKNESS,
} from "@bladeio/shared";
import { ArenaState } from "../state/ArenaState";
import { Blade } from "../state/Blade";
import { Crate } from "../state/Crate";
import { randomId } from "../utils/ids";

function pickCrateRarity(): BladeRarity {
  const r = Math.random();
  let acc = 0;
  for (const entry of CRATE_LOOT_WEIGHTS) {
    acc += entry.weight;
    if (r <= acc) return entry.rarity;
  }
  return BladeRarity.Common;
}

function targetCrateCount(playerCount: number): number {
  const scaled = CRATE_PER_PLAYER * Math.max(1, playerCount);
  return Math.min(CRATE_MAX_TOTAL, Math.max(CRATE_MIN_FLOOR, scaled));
}

function insideAnyDecor(x: number, y: number, margin: number): boolean {
  for (let i = 0; i < DECOR_COLLIDERS.length; i++) {
    const d = DECOR_COLLIDERS[i];
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
      if (dx * dx + dy * dy < CRATE_MIN_DIST_FROM_PLAYER * CRATE_MIN_DIST_FROM_PLAYER) {
        ok = false;
      }
    });
    if (!ok) continue;
    state.crates.forEach((c) => {
      const dx = c.x - x;
      const dy = c.y - y;
      if (dx * dx + dy * dy < 6 * 6) ok = false;
    });
    if (ok) return { x, y };
  }
  return null;
}

export class CrateSystem {
  private timer = 0;

  update(dt: number, state: ArenaState): void {
    this.timer += dt;
    if (this.timer < CRATE_SPAWN_INTERVAL) return;
    this.timer = 0;
    const want = targetCrateCount(state.players.size);
    const have = state.crates.size;
    const spawns = Math.min(3, Math.max(0, want - have));
    for (let i = 0; i < spawns; i++) {
      const pos = pickSpawnPoint(state);
      if (!pos) break;
      const c = new Crate();
      c.id = randomId();
      c.x = pos.x;
      c.y = pos.y;
      c.hp = CRATE_HP;
      c.maxHp = CRATE_HP;
      state.crates.set(c.id, c);
    }
  }

  destroyCrate(state: ArenaState, c: Crate): void {
    const n = CRATE_DROP_MIN + Math.floor(Math.random() * (CRATE_DROP_MAX - CRATE_DROP_MIN + 1));
    const now = Date.now();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = CRATE_DROP_SPEED * (0.5 + Math.random() * 0.5);
      const rarity = pickCrateRarity();
      const b = new Blade();
      b.id = randomId();
      b.rarity = rarity;
      b.hp = RARITY_HP[rarity];
      b.x = c.x;
      b.y = c.y;
      b.vx = Math.cos(a) * speed;
      b.vy = Math.sin(a) * speed;
      b.pickupLockUntil = now + 250;
      b.expiresAt = now + GROUND_BLADE_TTL_MS;
      state.blades.set(b.id, b);
    }
    state.crates.delete(c.id);
  }
}
