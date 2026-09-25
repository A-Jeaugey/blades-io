import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  BladeRarity,
  CRATE_HP,
  GROUND_BLADE_TTL_MS,
  THROW_COOLDOWN_MS,
  THROW_LANDED_PICKUP_LOCK_MS,
  THROW_PROJECTILE_MAX_RANGE,
  THROW_PROJECTILE_SPEED,
  BladeThrownEvent,
  ProjectileImpactEvent,
} from "@bladeio/shared";
import { ArenaState } from "../src/state/ArenaState";
import { Blade } from "../src/state/Blade";
import { Crate } from "../src/state/Crate";
import { Player } from "../src/state/Player";
import { OrbitPositionCache } from "../src/systems/orbitPositions";
import {
  ThrowCallbacks,
  processThrows,
  resolveProjectileCollisions,
  updateProjectiles,
} from "../src/systems/throws";
import { DT, FakeClock, addPlayer, ownedBlades, uid } from "./helpers";

let clock: FakeClock;
let state: ArenaState;

beforeEach(() => {
  clock = new FakeClock();
  state = new ArenaState();
});
afterEach(() => clock.restore());

interface Recorder extends ThrowCallbacks {
  thrown: BladeThrownEvent[];
  impacts: ProjectileImpactEvent[];
  kills: Array<{ victim: Player; killer: Player | null }>;
  destroyed: Blade[];
  crateHits: Crate[];
}

function recorder(): Recorder {
  const r: Recorder = {
    thrown: [],
    impacts: [],
    kills: [],
    destroyed: [],
    crateHits: [],
    onBladeThrown: (ev) => { r.thrown.push(ev); },
    onProjectileImpact: (ev) => { r.impacts.push(ev); },
    onPlayerKilled: (victim, killer) => { r.kills.push({ victim, killer }); victim.alive = false; },
    onCrateHit: (c) => { r.crateHits.push(c); },
    onCrateDestroyed: () => {},
    onBladeDestroyed: (b) => { r.destroyed.push(b); state.blades.delete(b.id); },
  };
  return r;
}

function thrower(x = 0, y = 0): Player {
  const p = addPlayer(state, { x, y, rarities: [BladeRarity.Common, BladeRarity.Rare, BladeRarity.Epic] });
  p.dirX = 1;
  p.dirY = 0;
  return p;
}

function projectile(opts: { x: number; y: number; rarity: BladeRarity; pierce: number; by: Player }): Blade {
  const b = new Blade();
  b.id = uid("proj");
  b.rarity = opts.rarity;
  b.x = opts.x;
  b.y = opts.y;
  b.isProjectile = true;
  b.thrownBy = opts.by.id;
  b.pierceLeft = opts.pierce;
  state.blades.set(b.id, b);
  return b;
}

test("lancer : la lame extérieure part en projectile dans la direction du joueur", () => {
  const p = thrower();
  const outer = ownedBlades(state, p).find((b) => b.rarity === BladeRarity.Epic)!;
  p.inputThrow = true;
  const r = recorder();
  processThrows(state, r);
  assert.equal(outer.isProjectile, true);
  assert.equal(outer.ownerId, "");
  assert.equal(outer.thrownBy, p.id);
  assert.equal(outer.pierceLeft, 2); // Epic
  assert.equal(outer.vx, THROW_PROJECTILE_SPEED);
  assert.equal(outer.vy, 0);
  // Départ au bord extérieur : orbite (1,8) + hitbox projectile (0,85) + 0,1.
  assert.ok(Math.abs(outer.x - 2.75) < 1e-9);
  assert.equal(p.bladeCount, 2);
  assert.equal(p.bladeIds.includes(outer.id), false);
  assert.equal(p.throwCooldownUntil, clock.now + THROW_COOLDOWN_MS);
  assert.equal(p.inputThrow, false);
  assert.equal(r.thrown.length, 1);
});

test("lancer : cooldown de 0,5 s, flag consommé même si refusé", () => {
  const p = thrower();
  const r = recorder();
  p.inputThrow = true;
  processThrows(state, r);
  p.inputThrow = true;
  processThrows(state, r);
  assert.equal(p.bladeCount, 2);
  assert.equal(p.inputThrow, false);
  clock.advance(THROW_COOLDOWN_MS);
  p.inputThrow = true;
  processThrows(state, r);
  assert.equal(p.bladeCount, 1);
  assert.equal(r.thrown.length, 2);
});

test("lancer visé : la visée prime sur la direction de déplacement", () => {
  const p = thrower();
  // Le joueur marche vers +x, vise derrière lui.
  p.aimX = -0.6;
  p.aimY = 0.8;
  p.inputThrow = true;
  const r = recorder();
  processThrows(state, r);
  const blade = state.blades.get(r.thrown[0].bladeId)!;
  assert.ok(Math.abs(blade.vx - -0.6 * THROW_PROJECTILE_SPEED) < 1e-9);
  assert.ok(Math.abs(blade.vy - 0.8 * THROW_PROJECTILE_SPEED) < 1e-9);
  assert.ok(blade.x < p.x && blade.y > p.y, "départ côté visée");
  assert.deepEqual([r.thrown[0].dirX, r.thrown[0].dirY], [-0.6, 0.8]);
  assert.equal(p.aimX, 0);
  assert.equal(p.aimY, 0);
});

test("lancer visé : la visée est consommée même si le lancer est refusé", () => {
  const p = thrower();
  p.throwCooldownUntil = clock.now + 100;
  p.aimX = 0;
  p.aimY = -1;
  p.inputThrow = true;
  const r = recorder();
  processThrows(state, r);
  assert.equal(r.thrown.length, 0);
  assert.equal(p.aimX, 0);
  assert.equal(p.aimY, 0);
  // Lancer suivant sans visée : direction de déplacement, pas l'ancienne visée.
  clock.advance(100);
  p.inputThrow = true;
  processThrows(state, r);
  assert.deepEqual([r.thrown[0].dirX, r.thrown[0].dirY], [1, 0]);
});

test("lancer refusé sans direction, sans lame ou mort", () => {
  const still = thrower(0, 0);
  still.dirX = 0;
  still.dirY = 0;
  const empty = addPlayer(state, { x: 20, y: 0 });
  const dead = thrower(40, 0);
  dead.alive = false;
  for (const p of [still, empty, dead]) p.inputThrow = true;
  const r = recorder();
  processThrows(state, r);
  assert.equal(r.thrown.length, 0);
  assert.equal(still.bladeCount, 3);
});

test("portée max : la lame retombe à 30 u, ramassable après un court verrou", () => {
  const p = thrower();
  p.inputThrow = true;
  const r = recorder();
  processThrows(state, r);
  const blade = state.blades.get(r.thrown[0].bladeId)!;
  for (let i = 0; i < 60; i++) {
    clock.advance(DT * 1000);
    updateProjectiles(DT, state, r);
  }
  assert.equal(blade.isProjectile, false);
  assert.ok(Math.abs(blade.x - (2.75 + THROW_PROJECTILE_MAX_RANGE)) < 1e-9, `x = ${blade.x}`);
  assert.equal(blade.vx, 0);
  const landedAt = blade.pickupLockUntil - THROW_LANDED_PICKUP_LOCK_MS;
  assert.ok(Math.abs(blade.expiresAt - (landedAt + GROUND_BLADE_TTL_MS)) < 1e-3);
  assert.deepEqual(r.impacts.map((i) => [i.kind, i.destroyed]), [[3, false]]);
});

test("un projectile qui atteint la zone de mort est détruit", () => {
  const p = thrower(235, 0);
  p.inputThrow = true;
  const r = recorder();
  processThrows(state, r);
  for (let i = 0; i < 30; i++) {
    clock.advance(DT * 1000);
    updateProjectiles(DT, state, r);
  }
  assert.equal(r.destroyed.length, 1);
  assert.deepEqual(r.impacts.map((i) => [i.kind, i.destroyed]), [[3, true]]);
});

test("un projectile dont le TTL est écoulé est détruit", () => {
  const p = thrower();
  p.inputThrow = true;
  const r = recorder();
  processThrows(state, r);
  state.blades.get(r.thrown[0].bladeId)!.expiresAt = clock.now - 1;
  updateProjectiles(DT, state, r);
  assert.equal(r.destroyed.length, 1);
});

test("projectile vs corps : tue, consomme un pierce, une seule fois par cible", () => {
  const a = addPlayer(state, { x: 0, y: 0 });
  const b = addPlayer(state, { x: 10, y: 0 });
  const proj = projectile({ x: 10.5, y: 0, rarity: BladeRarity.Epic, pierce: 2, by: a });
  const r = recorder();
  resolveProjectileCollisions(state, r, new OrbitPositionCache());
  assert.deepEqual(r.kills.map((k) => [k.victim.id, k.killer?.id]), [[b.id, a.id]]);
  assert.equal(proj.pierceLeft, 1);
  assert.equal(state.blades.has(proj.id), true);
  b.alive = true;
  resolveProjectileCollisions(state, r, new OrbitPositionCache());
  assert.equal(r.kills.length, 1);
});

test("un projectile Common est consommé au premier impact", () => {
  const a = addPlayer(state, { x: 0, y: 0 });
  addPlayer(state, { x: 10, y: 0 });
  const proj = projectile({ x: 10.5, y: 0, rarity: BladeRarity.Common, pierce: 1, by: a });
  const r = recorder();
  resolveProjectileCollisions(state, r, new OrbitPositionCache());
  assert.equal(state.blades.has(proj.id), false);
  assert.equal(r.impacts[0].destroyed, true);
});

test("le lanceur et les joueurs protégés ne sont pas touchés", () => {
  const a = addPlayer(state, { x: 0, y: 0 });
  const fresh = addPlayer(state, { x: 10, y: 0 });
  fresh.spawnProtectionUntil = clock.now + 1000;
  projectile({ x: 0.2, y: 0, rarity: BladeRarity.Common, pierce: 1, by: a });
  projectile({ x: 10.2, y: 0, rarity: BladeRarity.Common, pierce: 1, by: a });
  const r = recorder();
  resolveProjectileCollisions(state, r, new OrbitPositionCache());
  assert.equal(r.kills.length, 0);
});

test("les lames en orbite protègent le corps", () => {
  const a = addPlayer(state, { x: 0, y: 0 });
  const b = addPlayer(state, { x: 10, y: 0, rarity: BladeRarity.Rare, blades: 1 });
  const shield = ownedBlades(state, b)[0];
  const cache = new OrbitPositionCache();
  cache.set(shield.id, 8.2, 0);
  // À portée du corps (1,1 u) ET de la lame (0,7 u) : la lame encaisse.
  projectile({ x: 8.9, y: 0, rarity: BladeRarity.Common, pierce: 1, by: a });
  const r = recorder();
  resolveProjectileCollisions(state, r, cache);
  assert.equal(r.kills.length, 0);
  assert.equal(b.alive, true);
  assert.equal(shield.hp, 2 - 1);
  assert.equal(r.impacts[0].kind, 0);
});

test("un projectile Legendary traverse une caisse", () => {
  const a = addPlayer(state, { x: 0, y: 0 });
  const crate = new Crate();
  crate.id = uid("c");
  crate.x = 10;
  crate.y = 0;
  crate.hp = CRATE_HP;
  state.crates.set(crate.id, crate);
  const proj = projectile({ x: 10.3, y: 0, rarity: BladeRarity.Legendary, pierce: 3, by: a });
  const r = recorder();
  resolveProjectileCollisions(state, r, new OrbitPositionCache());
  assert.equal(crate.hp, CRATE_HP - 8);
  assert.equal(proj.pierceLeft, 2);
  assert.deepEqual(r.impacts.map((i) => [i.kind, i.destroyed]), [[2, false]]);
  assert.equal(r.crateHits.length, 1);
});
