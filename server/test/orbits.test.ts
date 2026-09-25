// Horloge d'orbite (tâche 1.1) : les angles des lames se déduisent des
// champs synchronisés, restent continus quand la vitesse change et
// s'arrêtent pendant le hitlag.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { orbitSlotAngle, orbitThetaAt, ringRadius } from "@bladeio/shared";
import { ArenaState } from "../src/state/ArenaState";
import { Player } from "../src/state/Player";
import { OrbitPositionCache, updateBladePositions } from "../src/systems/orbitPositions";
import { DT, FakeClock, addPlayer, giveBlade, ownedBlades } from "./helpers";

let clock: FakeClock;
let state: ArenaState;

beforeEach(() => {
  clock = new FakeClock();
  state = new ArenaState();
});
afterEach(() => clock.restore());

function positionsAt(tick: number): Map<string, { x: number; y: number }> {
  const cache = new OrbitPositionCache();
  updateBladePositions(DT, tick, state, cache);
  const out = new Map<string, { x: number; y: number }>();
  state.blades.forEach((b) => {
    const pos = cache.get(b.id);
    if (pos) out.set(b.id, { ...pos });
  });
  return out;
}

// Ce que fait le client : l'angle d'une lame à partir des seuls champs
// synchronisés du joueur et de la lame.
function clientPosition(p: Player, ring: number, slot: number, inRing: number, tick: number) {
  const theta = orbitThetaAt(p.orbitPhase, p.orbitRate, p.orbitTick, tick);
  const a = orbitSlotAngle(ring, slot, inRing, theta, p.spinPhase);
  const r = ringRadius(ring);
  return { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r };
}

test("un client reproduit exactement les positions serveur à partir des champs synchronisés", () => {
  const p = addPlayer(state, { x: 10, y: -20, blades: 20 });
  p.spinPhase = 1.3;
  p.spinScale = 0.9;
  for (let tick = 1; tick <= 300; tick++) {
    clock.advance(DT * 1000);
    const server = positionsAt(tick);
    // Vitesse qui change en cours de route (Spin à mi-parcours).
    if (tick === 150) p.spinUntil = clock.now + 5000;
    if (tick % 50 !== 0) continue;
    const blades = ownedBlades(state, p);
    const perRing = new Map<number, number>();
    for (const b of blades) perRing.set(b.ringIndex, (perRing.get(b.ringIndex) ?? 0) + 1);
    for (const b of blades) {
      const c = clientPosition(p, b.ringIndex, b.slotIndex, perRing.get(b.ringIndex)!, tick);
      const s = server.get(b.id)!;
      assert.ok(Math.abs(c.x - s.x) < 1e-9 && Math.abs(c.y - s.y) < 1e-9, `tick ${tick}`);
    }
  }
});

test("un changement de vitesse ne fait pas sauter les lames", () => {
  const p = addPlayer(state, { x: 0, y: -20, blades: 5 });
  for (let tick = 1; tick <= 3600; tick++) positionsAt(tick); // une minute de jeu
  const before = positionsAt(3600);
  // Même tick, vitesse différente (Spin) : nouveau segment, même angle.
  p.spinUntil = clock.now + 10_000;
  const after = positionsAt(3600);
  for (const [id, pos] of before) {
    assert.ok(Math.hypot(pos.x - after.get(id)!.x, pos.y - after.get(id)!.y) < 1e-9);
  }
  assert.equal(p.orbitTick, 3600);
  // Et la rotation reprend plus vite ensuite.
  const rate = p.orbitRate;
  positionsAt(3601);
  assert.equal(p.orbitRate, rate);
  assert.ok(rate > 1.5);
});

test("ramasser une lame ne change la vitesse que d'un cran", () => {
  const p = addPlayer(state, { x: 0, y: -20, blades: 5 });
  for (let tick = 1; tick <= 600; tick++) positionsAt(tick);
  const thetaBefore = orbitThetaAt(p.orbitPhase, p.orbitRate, p.orbitTick, 600);
  giveBlade(state, p);
  positionsAt(600);
  const thetaAfter = orbitThetaAt(p.orbitPhase, p.orbitRate, p.orbitTick, 600);
  assert.ok(Math.abs(thetaAfter - thetaBefore) < 1e-9);
});

test("le hitlag fige l'horloge d'orbite, qui repart sans saut", () => {
  const p = addPlayer(state, { x: 0, y: -20, blades: 3 });
  for (let tick = 1; tick <= 60; tick++) {
    clock.advance(DT * 1000);
    positionsAt(tick);
  }
  p.hitlagUntil = clock.now + 100;
  const frozen = positionsAt(61);
  for (let tick = 62; tick <= 66; tick++) {
    clock.advance(DT * 1000);
    const pos = positionsAt(tick);
    for (const [id, f] of frozen) assert.ok(Math.hypot(f.x - pos.get(id)!.x, f.y - pos.get(id)!.y) < 1e-9);
  }
  assert.equal(p.orbitRate, 0);
  clock.advance(200);
  const resumed = positionsAt(67);
  assert.ok(p.orbitRate > 0);
  // Premier tick après le gel : l'angle part de la position figée.
  for (const [id, f] of frozen) assert.ok(Math.hypot(f.x - resumed.get(id)!.x, f.y - resumed.get(id)!.y) < 1e-9);
});
