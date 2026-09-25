import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { ArenaState } from "../src/state/ArenaState";
import { updateScore } from "../src/systems/scoring";
import { FakeClock, addPlayer } from "./helpers";

let clock: FakeClock;
let state: ArenaState;

beforeEach(() => {
  clock = new FakeClock();
  state = new ArenaState();
});
afterEach(() => clock.restore());

test("score = kills×15 + record de lames + 1 par 10 s + caisses×3 + power-ups×2", () => {
  const p = addPlayer(state);
  p.kills = 2;
  p.maxBladeCount = 30;
  p.cratesDestroyed = 3;
  p.powerupsCollected = 4;
  p.spawnedAt = clock.now - 65_000;
  updateScore(p);
  assert.equal(p.score, 2 * 15 + 30 + 6 + 3 * 3 + 4 * 2);
});

test("le score ne baisse pas quand on perd des lames", () => {
  const p = addPlayer(state, { blades: 12 });
  updateScore(p);
  const before = p.score;
  p.bladeCount = 2;
  updateScore(p);
  assert.equal(p.score, before);
});

test("le score d'un joueur mort est figé", () => {
  const p = addPlayer(state);
  p.score = 42;
  p.kills = 10;
  p.alive = false;
  updateScore(p);
  assert.equal(p.score, 42);
});
