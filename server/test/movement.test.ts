import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PLAYER_BODY_RADIUS, PLAYER_BOOST_MULT, PLAYER_SPEED } from "@bladeio/shared";
import { ArenaState } from "../src/state/ArenaState";
import { Player } from "../src/state/Player";
import { updateMovement } from "../src/systems/movement";
import { DT, FakeClock, addPlayer } from "./helpers";

let clock: FakeClock;
let state: ArenaState;
let drained: number;

beforeEach(() => {
  clock = new FakeClock();
  state = new ArenaState();
  drained = 0;
});
afterEach(() => clock.restore());

// Un tick de mouvement ; les humains « envoient » un input à chaque tick
// (sinon la règle d'inactivité de 500 ms les immobiliserait).
function step(ticks: number, keepInputsFresh = true): void {
  for (let i = 0; i < ticks; i++) {
    clock.advance(DT * 1000);
    if (keepInputsFresh) state.players.forEach((p) => { p.lastInputAt = clock.now; });
    updateMovement(DT, state, (p: Player, n: number) => {
      drained += n;
      p.bladeCount -= n;
    });
  }
}

test("avance à PLAYER_SPEED dans la direction de l'input", () => {
  const p = addPlayer(state, { x: 0, y: -20 });
  p.inputDx = 1;
  step(60);
  assert.ok(Math.abs(p.x - PLAYER_SPEED) < 1e-6, `x = ${p.x}`);
  assert.equal(p.y, -20);
  assert.equal(p.dirX, 1);
});

test("un input diagonal est normalisé", () => {
  const p = addPlayer(state, { x: 0, y: -20 });
  p.inputDx = 1;
  p.inputDy = 1;
  step(60);
  assert.ok(Math.abs(Math.hypot(p.x, p.y + 20) - PLAYER_SPEED) < 1e-6);
});

test("le boost accélère et coûte une lame toutes les 0,5 s", () => {
  const p = addPlayer(state, { x: 0, y: -20, blades: 5 });
  p.inputDx = 1;
  p.inputBoost = true;
  step(33); // 0,55 s
  assert.equal(drained, 1);
  step(30); // 1,05 s
  assert.equal(drained, 2);
  assert.equal(p.boost, true);
  assert.ok(Math.abs(p.x - PLAYER_SPEED * PLAYER_BOOST_MULT * 63 * DT) < 1e-6, `x = ${p.x}`);
});

test("pas de boost sans lame", () => {
  const p = addPlayer(state, { x: 0, y: -20 });
  p.inputDx = 1;
  p.inputBoost = true;
  step(60);
  assert.equal(p.boost, false);
  assert.equal(drained, 0);
  assert.ok(Math.abs(p.x - PLAYER_SPEED) < 1e-6);
});

test("un humain sans input depuis plus de 500 ms s'arrête, pas un bot", () => {
  const human = addPlayer(state, { x: 0, y: -20 });
  const bot = addPlayer(state, { x: 0, y: -30, isBot: true });
  human.inputDx = 1;
  bot.inputDx = 1;
  step(45, false); // 0,75 s sans nouvel input
  assert.ok(Math.abs(human.x - PLAYER_SPEED * 0.5) < 0.2, `humain x = ${human.x}`);
  assert.equal(human.inputDx, 0);
  assert.ok(Math.abs(bot.x - PLAYER_SPEED * 0.75) < 1e-6, `bot x = ${bot.x}`);
});

test("le hitlag fige le déplacement", () => {
  const p = addPlayer(state, { x: 0, y: -20 });
  p.inputDx = 1;
  p.hitlagUntil = clock.now + 100;
  step(5); // 83 ms
  assert.equal(p.x, 0);
  step(10);
  assert.ok(p.x > 0);
});

test("le knockback s'ajoute puis s'éteint (τ = 0,18 s)", () => {
  const p = addPlayer(state, { x: 0, y: -20 });
  p.knockbackVx = 8;
  step(60);
  assert.equal(p.knockbackVx, 0);
  // ∑ 8·e^(-k·dt/τ)·dt ≈ 1,37 u
  assert.ok(p.x > 1.2 && p.x < 1.5, `x = ${p.x}`);
});

test("collision décor : on s'arrête à la surface du pilier central", () => {
  const p = addPlayer(state, { x: 0, y: -3 });
  p.inputDy = 1;
  step(60);
  assert.ok(Math.abs(p.y - -(1.1 + PLAYER_BODY_RADIUS)) < 1e-9, `y = ${p.y}`);
});

test("deux joueurs qui se chevauchent sont écartés selon leur bouclier", () => {
  // 16 lames = anneau 0 plein : bouclier = orbite 1,8 + marge 0,05.
  const a = addPlayer(state, { x: 50, y: -20, blades: 16 });
  const b = addPlayer(state, { x: 51, y: -20, blades: 16 });
  step(1);
  assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - 2 * 1.85) < 1e-6);
  // Sans lame : seuls les corps se repoussent.
  const c = addPlayer(state, { x: -50, y: -20 });
  const d = addPlayer(state, { x: -49.5, y: -20 });
  step(1);
  assert.ok(Math.abs(Math.hypot(c.x - d.x, c.y - d.y) - 2 * PLAYER_BODY_RADIUS) < 1e-6);
});
