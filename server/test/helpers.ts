// Outils partagés par les tests des systèmes serveur. Les systèmes lisent
// Date.now() et Math.random() directement : on les remplace par une horloge
// simulée et un générateur à graine pour des tests déterministes.
import { BladeRarity, RARITY_HP, tierFromBladeCount } from "@bladeio/shared";
import { ArenaState } from "../src/state/ArenaState";
import { Blade } from "../src/state/Blade";
import { Player } from "../src/state/Player";
import { attachBladeToPlayer } from "../src/systems/pickup";

export const DT = 1 / 60;

export class FakeClock {
  now: number;
  private readonly realNow = Date.now;

  constructor(start = 1_700_000_000_000) {
    this.now = start;
    Date.now = () => this.now;
  }

  advance(ms: number): void {
    this.now += ms;
  }

  restore(): void {
    Date.now = this.realNow;
  }
}

// mulberry32 : suffisant pour rendre reproductibles les tirages des systèmes.
export function seedRandom(seed: number): () => void {
  const real = Math.random;
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => {
    Math.random = real;
  };
}

let seq = 0;
export function uid(prefix: string): string {
  seq++;
  return `${prefix}${seq}`;
}

export interface PlayerOptions {
  id?: string;
  x?: number;
  y?: number;
  blades?: number;
  rarity?: BladeRarity;
  rarities?: BladeRarity[];
  isBot?: boolean;
}

// Joueur vivant, sans protection de spawn, avec ses lames en orbite et son
// tier à jour (d'ordinaire recalculé par le tick de la room).
export function addPlayer(state: ArenaState, opts: PlayerOptions = {}): Player {
  const p = new Player();
  p.id = opts.id ?? uid("p");
  p.name = p.id;
  p.x = opts.x ?? 0;
  p.y = opts.y ?? 0;
  p.alive = true;
  p.isBot = opts.isBot ?? false;
  p.spawnedAt = Date.now();
  state.players.set(p.id, p);
  const rarities = opts.rarities ?? new Array<BladeRarity>(opts.blades ?? 0).fill(opts.rarity ?? BladeRarity.Common);
  for (const r of rarities) giveBlade(state, p, r);
  return p;
}

export function giveBlade(state: ArenaState, p: Player, rarity: BladeRarity = BladeRarity.Common): Blade {
  const b = new Blade();
  b.id = uid("b");
  b.rarity = rarity;
  b.hp = RARITY_HP[rarity];
  state.blades.set(b.id, b);
  attachBladeToPlayer(state, p, b);
  p.tier = tierFromBladeCount(p.bladeCount);
  return b;
}

export interface GroundBladeOptions {
  x: number;
  y: number;
  rarity?: BladeRarity;
  expiresAt?: number;
  pickupLockUntil?: number;
  vx?: number;
  vy?: number;
}

export function addGroundBlade(state: ArenaState, opts: GroundBladeOptions): Blade {
  const b = new Blade();
  b.id = uid("g");
  b.rarity = opts.rarity ?? BladeRarity.Common;
  b.hp = RARITY_HP[b.rarity as BladeRarity];
  b.x = opts.x;
  b.y = opts.y;
  b.vx = opts.vx ?? 0;
  b.vy = opts.vy ?? 0;
  b.expiresAt = opts.expiresAt ?? 0;
  b.pickupLockUntil = opts.pickupLockUntil ?? 0;
  state.blades.set(b.id, b);
  return b;
}

export function ownedBlades(state: ArenaState, p: Player): Blade[] {
  const out: Blade[] = [];
  state.blades.forEach((b) => {
    if (b.ownerId === p.id) out.push(b);
  });
  return out;
}

export function groundBlades(state: ArenaState): Blade[] {
  const out: Blade[] = [];
  state.blades.forEach((b) => {
    if (!b.ownerId && !b.isProjectile) out.push(b);
  });
  return out;
}
