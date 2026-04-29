import {
  AMBIENT_MAX_BASE,
  AMBIENT_MIN_DIST_FROM_PLAYER,
  AMBIENT_MIN_FLOOR,
  AMBIENT_PER_PLAYER,
  AMBIENT_SPAWN_BURST,
  AMBIENT_SPAWN_INTERVAL,
  BladeRarity,
  DECOR_COLLIDERS,
  GROUND_BLADE_TTL_MS,
  MAP_RADIUS,
  RARITY_HP,
  RARITY_SPAWN_WEIGHTS,
  WALL_KILL_THICKNESS,
} from "@bladeio/shared";
import { ArenaState } from "../state/ArenaState";
import { Blade } from "../state/Blade";
import { randomId } from "../utils/ids";

export function pickRarity(): BladeRarity {
  const r = Math.random();
  let acc = 0;
  for (const entry of RARITY_SPAWN_WEIGHTS) {
    acc += entry.weight;
    if (r <= acc) return entry.rarity;
  }
  return BladeRarity.Common;
}

export function ambientCap(playerCount: number): number {
  const scaled = AMBIENT_PER_PLAYER * Math.max(1, playerCount);
  return Math.min(AMBIENT_MAX_BASE, Math.max(AMBIENT_MIN_FLOOR, scaled));
}

export function countGroundBlades(state: ArenaState): number {
  let n = 0;
  state.blades.forEach((b) => {
    if (!b.ownerId) n++;
  });
  return n;
}

function insideAnyDecor(x: number, y: number, margin: number): boolean {
  for (let i = 0; i < DECOR_COLLIDERS.length; i++) {
    const d = DECOR_COLLIDERS[i];
    const dx = x - d.x;
    const dy = y - d.y;
    const minR = d.radius + margin;
    if (dx * dx + dy * dy < minR * minR) return true;
  }
  return false;
}

function randomPositionAwayFromPlayers(state: ArenaState): { x: number; y: number } | null {
  const innerRadius = MAP_RADIUS - WALL_KILL_THICKNESS - 1;
  for (let tries = 0; tries < 30; tries++) {
    const r = Math.sqrt(Math.random()) * innerRadius;
    const a = Math.random() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (insideAnyDecor(x, y, 1)) continue;
    let ok = true;
    state.players.forEach((p) => {
      if (!p.alive) return;
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy < AMBIENT_MIN_DIST_FROM_PLAYER * AMBIENT_MIN_DIST_FROM_PLAYER) {
        ok = false;
      }
    });
    if (ok) return { x, y };
  }
  return null;
}

export class SpawnSystem {
  private timer = 0;
  update(dt: number, state: ArenaState): void {
    this.timer += dt;
    if (this.timer < AMBIENT_SPAWN_INTERVAL) return;
    this.timer = 0;

    const cap = ambientCap(state.players.size);
    const current = countGroundBlades(state);
    // Gros burst autorisé pour remplir rapidement quand la map est vide.
    const spawns = Math.min(AMBIENT_SPAWN_BURST, Math.max(0, cap - current));
    for (let i = 0; i < spawns; i++) {
      const pos = randomPositionAwayFromPlayers(state);
      if (!pos) continue;
      const rarity = pickRarity();
      const blade = new Blade();
      blade.id = randomId();
      blade.rarity = rarity;
      blade.hp = RARITY_HP[rarity];
      blade.x = pos.x;
      blade.y = pos.y;
      blade.ownerId = "";
      blade.expiresAt = Date.now() + GROUND_BLADE_TTL_MS;
      state.blades.set(blade.id, blade);
    }
  }
}
