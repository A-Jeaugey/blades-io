import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  AMBIENT_MIN_DIST_FROM_PLAYER,
  AMBIENT_SPAWN_BURST,
  DECOR_COLLIDERS,
  GROUND_BLADE_BLINK_MS,
  MAP_RADIUS,
  WALL_KILL_THICKNESS,
} from "@bladeio/shared";
import { ArenaState } from "../src/state/ArenaState";
import { Blade } from "../src/state/Blade";
import { Player } from "../src/state/Player";
import { SpawnSystem, ambientCap, expireGroundBlades } from "../src/systems/spawning";
import { OrbitPositionCache } from "../src/systems/orbitPositions";
import { applyWallDamage } from "../src/systems/wallDamage";
import { FakeClock, addGroundBlade, addPlayer, groundBlades, ownedBlades, seedRandom } from "./helpers";

let clock: FakeClock;
let state: ArenaState;
let restoreRandom: () => void;

beforeEach(() => {
  clock = new FakeClock();
  state = new ArenaState();
  restoreRandom = seedRandom(7);
});
afterEach(() => {
  clock.restore();
  restoreRandom();
});

test("plafond ambiant : 18 par joueur, entre 35 et 400, ×2,5 en privé", () => {
  assert.equal(ambientCap(0, false), 35);
  assert.equal(ambientCap(1, false), 35);
  assert.equal(ambientCap(10, false), 180);
  assert.equal(ambientCap(30, false), 400);
  assert.equal(ambientCap(10, true), 450);
});

test("drops : clignotement dans les 3 dernières secondes puis suppression", () => {
  const blinking = addGroundBlade(state, { x: 10, y: 10, expiresAt: clock.now + GROUND_BLADE_BLINK_MS - 1 });
  const fresh = addGroundBlade(state, { x: 12, y: 10, expiresAt: clock.now + 5000 });
  const expired = addGroundBlade(state, { x: 14, y: 10, expiresAt: clock.now - 1 });
  const ambient = addGroundBlade(state, { x: 16, y: 10 });
  const owner = addPlayer(state, { x: -50, y: -50, blades: 1 });
  const flying = addGroundBlade(state, { x: 18, y: 10, expiresAt: clock.now - 1 });
  flying.isProjectile = true;
  expireGroundBlades(state, clock.now);
  assert.equal(blinking.expiring, true);
  assert.equal(fresh.expiring, false);
  assert.equal(state.blades.has(expired.id), false);
  for (const b of [blinking, fresh, ambient, flying, ...ownedBlades(state, owner)]) {
    assert.equal(state.blades.has(b.id), true);
  }
});

test("spawner : rien avant l'intervalle d'une seconde", () => {
  addPlayer(state, { x: 0, y: -20 });
  new SpawnSystem().update(0.5, state, false);
  assert.equal(groundBlades(state).length, 0);
});

test("spawner : lames ambiantes sans échéance, loin des joueurs et du décor", () => {
  const players: Player[] = [addPlayer(state, { x: 0, y: -20 }), addPlayer(state, { x: 100, y: 50 })];
  new SpawnSystem().update(1, state, false);
  const spawned = groundBlades(state);
  assert.equal(spawned.length, AMBIENT_SPAWN_BURST);
  const innerRadius = MAP_RADIUS - WALL_KILL_THICKNESS - 1;
  for (const b of spawned) {
    assert.equal(b.expiresAt, 0);
    assert.ok(Math.hypot(b.x, b.y) <= innerRadius);
    for (const p of players) assert.ok(Math.hypot(b.x - p.x, b.y - p.y) >= AMBIENT_MIN_DIST_FROM_PLAYER);
    for (const d of DECOR_COLLIDERS) assert.ok(Math.hypot(b.x - d.x, b.y - d.y) >= d.radius + 1);
  }
});

test("spawner : plafond respecté, les drops expirés libèrent de la place", () => {
  addPlayer(state, { x: 0, y: -20 });
  const drops: Blade[] = [];
  for (let i = 0; i < 35; i++) {
    const b = addGroundBlade(state, { x: 100 + i, y: 0, expiresAt: i < 5 ? clock.now - 1 : 0 });
    drops.push(b);
  }
  const spawner = new SpawnSystem();
  spawner.update(1, state, false);
  // 5 drops expirés supprimés, 5 lames ambiantes pour revenir au plafond.
  assert.equal(groundBlades(state).length, 35);
  for (const b of drops.slice(0, 5)) assert.equal(state.blades.has(b.id), false);
  spawner.update(1, state, false);
  assert.equal(groundBlades(state).length, 35);
});

test("mur : joueur et lames au-delà de la zone de mort, sauf protection de spawn", () => {
  const killRadius = MAP_RADIUS - WALL_KILL_THICKNESS;
  const outside = addPlayer(state, { x: killRadius + 0.5, y: 0 });
  const protectedOne = addPlayer(state, { x: 0, y: killRadius + 0.5 });
  protectedOne.spawnProtectionUntil = clock.now + 1000;
  const inside = addPlayer(state, { x: killRadius - 5, y: 0, blades: 2 });
  const [safe, doomed] = ownedBlades(state, inside);
  const cache = new OrbitPositionCache();
  cache.set(safe.id, killRadius - 6.8, 0);
  cache.set(doomed.id, killRadius + 0.2, 0);
  const killed: Player[] = [];
  const destroyed: Blade[] = [];
  applyWallDamage(state, cache, {
    onPlayerKilled: (p) => killed.push(p),
    onBladeDestroyed: (b) => destroyed.push(b),
  });
  assert.deepEqual(killed.map((p) => p.id), [outside.id]);
  assert.deepEqual(destroyed.map((b) => b.id), [doomed.id]);
});
