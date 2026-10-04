import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  BladeRarity,
  GROUND_BLADE_FRICTION,
  MAP_RADIUS,
  MAX_BLADES_PER_PLAYER,
  PICKUP_MAGNET_RADIUS,
  PICKUP_MAGNET_STRENGTH,
  WALL_KILL_THICKNESS,
} from "@bladeio/shared";
import { ArenaState } from "../src/state/ArenaState";
import { Blade } from "../src/state/Blade";
import { attachBladeToPlayer, PickupSystem } from "../src/systems/pickup";
import { updateScore } from "../src/systems/scoring";
import { OrbitPositionCache, recompactOwnerRing, updateBladePositions } from "../src/systems/orbitPositions";
import { DT, FakeClock, addGroundBlade, addPlayer, giveBlade, ownedBlades } from "./helpers";

let clock: FakeClock;
let state: ArenaState;

beforeEach(() => {
  clock = new FakeClock();
  state = new ArenaState();
});
afterEach(() => clock.restore());

test("attachBladeToPlayer remplit l'anneau 0 (16 slots) puis l'anneau 1", () => {
  const p = addPlayer(state, { x: 0, y: -20, blades: 17 });
  const blades = ownedBlades(state, p);
  const ring0 = blades.filter((b) => b.ringIndex === 0).map((b) => b.slotIndex).sort((a, b) => a - b);
  assert.deepEqual(ring0, Array.from({ length: 16 }, (_, i) => i));
  const ring1 = blades.filter((b) => b.ringIndex === 1);
  assert.equal(ring1.length, 1);
  assert.equal(ring1[0].slotIndex, 0);
  assert.equal(p.bladeCount, 17);
  assert.equal(p.maxBladeCount, 17);
  assert.equal(p.bladeIds.length, 17);
});

test("une lame ramassée récupère ses PV et perd son échéance de drop", () => {
  const p = addPlayer(state, { x: 0, y: -20 });
  const b = addGroundBlade(state, { x: 0, y: -21, rarity: BladeRarity.Rare, expiresAt: clock.now + 1000, vx: 2 });
  b.hp = 1;
  b.expiring = true;
  attachBladeToPlayer(state, p, b);
  assert.equal(b.ownerId, p.id);
  assert.equal(b.hp, 2);
  assert.equal(b.expiresAt, 0);
  assert.equal(b.expiring, false);
  assert.equal(b.vx, 0);
});

test("ramassage dans un rayon de 2,8 u, hors lames verrouillées et projectiles", () => {
  const p = addPlayer(state, { x: 0, y: -20 });
  const near = addGroundBlade(state, { x: 2, y: -20 });
  const far = addGroundBlade(state, { x: 3.5, y: -20 });
  const locked = addGroundBlade(state, { x: 1, y: -20, pickupLockUntil: clock.now + 1000 });
  const flying = addGroundBlade(state, { x: 0.5, y: -20 });
  flying.isProjectile = true;
  const picked: Blade[] = [];
  new PickupSystem().update(state, (_player, b) => picked.push(b));
  assert.deepEqual(picked.map((b) => b.id), [near.id]);
  assert.equal(p.bladeCount, 1);
  for (const b of [far, locked, flying]) assert.equal(b.ownerId, "");
});

test("pas de ramassage mort ou au plafond de lames", () => {
  const dead = addPlayer(state, { x: 0, y: -20 });
  dead.alive = false;
  const full = addPlayer(state, { x: 50, y: -20 });
  full.bladeCount = MAX_BLADES_PER_PLAYER;
  addGroundBlade(state, { x: 1, y: -20 });
  addGroundBlade(state, { x: 51, y: -20 });
  const picked: Blade[] = [];
  new PickupSystem().update(state, (_player, b) => picked.push(b));
  assert.equal(picked.length, 0);
});

test("positions d'orbite : chaque lame à son rayon d'anneau", () => {
  const p = addPlayer(state, { x: 10, y: -20, blades: 17 });
  const cache = new OrbitPositionCache();
  updateBladePositions(DT, 192, state, cache);
  for (const b of ownedBlades(state, p)) {
    const pos = cache.get(b.id)!;
    const expected = b.ringIndex === 0 ? 1.8 : 2.6;
    assert.ok(Math.abs(Math.hypot(pos.x - p.x, pos.y - p.y) - expected) < 1e-9);
  }
});

test("les lames d'un joueur mort ou disparu sont supprimées", () => {
  const p = addPlayer(state, { x: 0, y: -20, blades: 3 });
  p.alive = false;
  const gone = addPlayer(state, { x: 30, y: -20, blades: 2 });
  state.players.delete(gone.id);
  updateBladePositions(DT, 0, state, new OrbitPositionCache());
  assert.equal(state.blades.size, 0);
});

test("aimant : attraction vers le joueur le plus proche dans un rayon de 5,5 u", () => {
  addPlayer(state, { x: 0, y: -20 });
  const inside = addGroundBlade(state, { x: 4, y: -20 });
  const outside = addGroundBlade(state, { x: -7, y: -20 });
  updateBladePositions(DT, 0, state, new OrbitPositionCache());
  const pull = PICKUP_MAGNET_STRENGTH * (1 - 4 / PICKUP_MAGNET_RADIUS) * DT;
  assert.ok(Math.abs(inside.x - (4 - pull)) < 1e-6, `x = ${inside.x}`);
  assert.equal(outside.x, -7);
});

test("aimant : rayon doublé par le power-up, sans effet sur une lame verrouillée", () => {
  const p = addPlayer(state, { x: 0, y: -20 });
  p.magnetUntil = clock.now + 1000;
  const boosted = addGroundBlade(state, { x: -7, y: -20 });
  const locked = addGroundBlade(state, { x: 3, y: -20, pickupLockUntil: clock.now + 1000 });
  updateBladePositions(DT, 0, state, new OrbitPositionCache());
  assert.ok(boosted.x > -7);
  assert.equal(locked.x, 3);
});

test("friction des lames au sol et butée au bord de l'arène", () => {
  const sliding = addGroundBlade(state, { x: 100, y: 100, vx: 3 });
  const edge = MAP_RADIUS - WALL_KILL_THICKNESS - 0.5;
  const outside = addGroundBlade(state, { x: 249, y: 0 });
  updateBladePositions(DT, 0, state, new OrbitPositionCache());
  assert.ok(Math.abs(sliding.vx - (3 - GROUND_BLADE_FRICTION * DT)) < 1e-6);
  assert.ok(Math.abs(outside.x - edge) < 1e-6);
});

test("recompactOwnerRing renumérote les slots sans trou, dans l'ordre", () => {
  const p = addPlayer(state, { x: 0, y: -20, blades: 4 });
  const bySlot = ownedBlades(state, p).sort((a, b) => a.slotIndex - b.slotIndex);
  state.blades.delete(bySlot[1].id);
  recompactOwnerRing(state, p.id, 0);
  assert.deepEqual([bySlot[0], bySlot[2], bySlot[3]].map((b) => b.slotIndex), [0, 1, 2]);
  // Une nouvelle lame reprend le premier slot libre.
  const extra = giveBlade(state, p);
  assert.equal(extra.slotIndex, 3);
});

test("ramasser une lame ne fait pas retomber le score composite", () => {
  const p = addPlayer(state, { x: 0, y: -20, blades: 5 });
  p.kills = 4;
  updateScore(p);
  const composite = p.score;
  assert.equal(composite, 4 * 15 + 5);
  giveBlade(state, p);
  // Avant : score = maxBladeCount (6) jusqu'à la fin du tick.
  assert.equal(p.score, composite);
});
