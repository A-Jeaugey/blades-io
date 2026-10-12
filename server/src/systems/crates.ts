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
  PRIVATE_ROOM_DENSITY_MULT,
  DECOR_COLLIDERS,
  GROUND_BLADE_TTL_MS,
  CrateKind,
  PROCESSOR_LOOT_MAX,
  PROCESSOR_LOOT_MIN,
  PROCESSOR_RARITY_WEIGHTS,
  RARITY_HP,
  VAULT_DROP_SPEED_MAX,
  VAULT_DROP_SPEED_MIN,
  VAULT_HITBOX,
  VAULT_LOOT_MAX,
  VAULT_LOOT_MIN,
  VAULT_RARITY_WEIGHTS,
  crateHitbox,
} from "@bladeio/shared";
import { ArenaState } from "../state/ArenaState";
import { LOOT_WALL_MARGIN, areaShare, zoneInner } from "./spawnPoint";
import { Blade } from "../state/Blade";
import { Crate } from "../state/Crate";
import { randomId } from "../utils/ids";

// Tirage d'une rareté selon une table de poids (somme 1) ; la dernière
// entrée rattrape l'arrondi.
export function pickWeighted(weights: ReadonlyArray<{ rarity: BladeRarity; weight: number }>): BladeRarity {
  const r = Math.random();
  let acc = 0;
  for (const entry of weights) {
    acc += entry.weight;
    if (r <= acc) return entry.rarity;
  }
  return weights[weights.length - 1].rarity;
}

function pickCrateRarity(): BladeRarity {
  const r = Math.random();
  let acc = 0;
  for (const entry of CRATE_LOOT_WEIGHTS) {
    acc += entry.weight;
    if (r <= acc) return entry.rarity;
  }
  return BladeRarity.Common;
}

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

// Lames projetées depuis (x, y), à partir de startR du centre, à une
// vitesse tirée dans [speedMin, speedMax] : le butin d'une caisse, d'un
// coffre ou d'une puce, ordinaire (à disputer) et qui expire comme les
// drops.
export function scatterLoot(
  state: ArenaState,
  x: number,
  y: number,
  rarities: readonly BladeRarity[],
  startR: number,
  speedMin: number,
  speedMax: number,
  lockMs: number,
): void {
  const now = Date.now();
  for (const rarity of rarities) {
    const a = Math.random() * Math.PI * 2;
    const speed = speedMin + Math.random() * (speedMax - speedMin);
    const b = new Blade();
    b.id = randomId();
    b.rarity = rarity;
    b.hp = RARITY_HP[rarity];
    b.x = x + Math.cos(a) * startR;
    b.y = y + Math.sin(a) * startR;
    b.vx = Math.cos(a) * speed;
    b.vy = Math.sin(a) * speed;
    b.pickupLockUntil = now + lockMs;
    b.expiresAt = now + GROUND_BLADE_TTL_MS;
    state.blades.set(b.id, b);
  }
}

// Butin d'une caisse d'évènement : nombre et raretés tirés à l'ouverture.
export function eventLoot(kind: number): BladeRarity[] {
  const vault = kind === CrateKind.Vault;
  const n = vault ? randInt(VAULT_LOOT_MIN, VAULT_LOOT_MAX) : randInt(PROCESSOR_LOOT_MIN, PROCESSOR_LOOT_MAX);
  const weights = vault ? VAULT_RARITY_WEIGHTS : PROCESSOR_RARITY_WEIGHTS;
  const out: BladeRarity[] = [];
  for (let i = 0; i < n; i++) out.push(pickWeighted(weights));
  return out;
}

function targetCrateCount(playerCount: number, isPrivate: boolean): number {
  const mult = isPrivate ? PRIVATE_ROOM_DENSITY_MULT : 1;
  const scaled = CRATE_PER_PLAYER * Math.max(1, playerCount) * mult;
  return Math.min(CRATE_MAX_TOTAL * mult, Math.max(CRATE_MIN_FLOOR * mult, scaled));
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
  // Dans l'arène du moment (resserrée en fin de manche, tâche 7.1).
  const innerRadius = zoneInner(state, LOOT_WALL_MARGIN);
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

  update(dt: number, state: ArenaState, isPrivate: boolean): void {
    this.expire(state);
    this.timer += dt;
    if (this.timer < CRATE_SPAWN_INTERVAL) return;
    this.timer = 0;
    // Densité de la carte entière, quelle que soit la taille de l'arène.
    // Les caisses des évènements de carte n'en font pas partie.
    const want = Math.round(targetCrateCount(state.players.size, isPrivate) * areaShare(state));
    let have = 0;
    state.crates.forEach((c) => { if (c.kind === CrateKind.Normal) have++; });
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

  // Caisses à durée de vie (coffre-fort, puces des évènements de carte) :
  // retirées, sans butin, si personne ne les a cassées à temps.
  private expire(state: ArenaState): void {
    if (state.crates.size === 0) return;
    const now = Date.now();
    const gone: string[] = [];
    state.crates.forEach((c) => {
      if (c.expiresAt > 0 && now >= c.expiresAt) gone.push(c.id);
    });
    for (const id of gone) state.crates.delete(id);
  }

  // Coffre-fort et puces (évènements de carte) : leur butin, que des
  // rares et mieux ; le coffre le projette depuis son bord, plus loin.
  // Sinon le tirage habituel.
  destroyCrate(state: ArenaState, c: Crate): void {
    if (c.kind === CrateKind.Vault) {
      scatterLoot(state, c.x, c.y, eventLoot(c.kind), VAULT_HITBOX, VAULT_DROP_SPEED_MIN, VAULT_DROP_SPEED_MAX, 400);
    } else if (c.kind === CrateKind.Chip) {
      scatterLoot(state, c.x, c.y, eventLoot(c.kind), crateHitbox(c.kind) * 0.5, CRATE_DROP_SPEED * 0.6, CRATE_DROP_SPEED * 1.1, 250);
    } else {
      // Tirages dans l'ordre d'avant (angle, vitesse, rareté) : une room de
      // bots seuls (bancs) doit jouer à l'identique.
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
    }
    state.crates.delete(c.id);
  }
}
