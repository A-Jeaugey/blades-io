import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { MAX_STEP_CREDIT, PLAYER_BODY_RADIUS, PLAYER_BOOST_MULT, PLAYER_SPEED } from "@bladeio/shared";
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

// Un tick de mouvement. Les humains avancent d'un pas par input reçu : on
// simule un client qui envoie à chaque tick l'input tenu (inputDx, inputDy,
// inputBoost). send = false : plus rien n'arrive.
function step(ticks: number, send = true): void {
  for (let i = 0; i < ticks; i++) {
    clock.advance(DT * 1000);
    if (send) {
      state.players.forEach((p) => {
        if (!p.isBot) p.inputQueue.push({ dx: p.inputDx, dy: p.inputDy, boost: p.inputBoost, seq: ++p.lastQueuedSeq });
      });
    }
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

test("un humain qui n'envoie plus d'input s'arrête aussitôt, pas un bot", () => {
  const human = addPlayer(state, { x: 0, y: -20 });
  const bot = addPlayer(state, { x: 0, y: -30, isBot: true });
  human.inputDx = 1;
  bot.inputDx = 1;
  step(30);
  step(15, false); // 0,25 s sans nouvel input
  assert.ok(Math.abs(human.x - PLAYER_SPEED * 0.5) < 1e-6, `humain x = ${human.x}`);
  assert.ok(Math.abs(bot.x - PLAYER_SPEED * 0.75) < 1e-6, `bot x = ${bot.x}`);
});

test("file d'inputs : un pas par input, dans l'ordre, lastSeq acquitte le dernier appliqué", () => {
  const p = addPlayer(state, { x: 0, y: -20 });
  p.inputQueue.push({ dx: 1, dy: 0, boost: false, seq: 7 }, { dx: 0, dy: 1, boost: false, seq: 8 });
  step(1, false);
  assert.ok(Math.abs(p.x - PLAYER_SPEED * DT) < 1e-9);
  assert.equal(p.y, -20);
  assert.equal(p.lastSeq, 7);
  step(1, false);
  assert.ok(Math.abs(p.y - (-20 + PLAYER_SPEED * DT)) < 1e-9);
  assert.equal(p.lastSeq, 8);
  assert.equal(p.inputQueue.length, 0);
});

test("file d'inputs : envoyer plus vite ne fait pas aller plus vite, un retard se rattrape", () => {
  const fast = addPlayer(state, { x: 0, y: -20 });
  const late = addPlayer(state, { x: 0, y: -40 });
  let seq = 0;
  // fast envoie 2 inputs par tick pendant 1 s ; late n'envoie rien pendant
  // 100 ms, puis ses 6 inputs arrivent d'un coup.
  for (let i = 0; i < 60; i++) {
    fast.inputQueue.push({ dx: 1, dy: 0, boost: false, seq: ++seq }, { dx: 1, dy: 0, boost: false, seq: ++seq });
    if (i === 6) for (let k = 0; k < 7; k++) late.inputQueue.push({ dx: 1, dy: 0, boost: false, seq: 1000 + k });
    else if (i > 6) late.inputQueue.push({ dx: 1, dy: 0, boost: false, seq: 1000 + i });
    step(1, false);
  }
  // Crédit : au plus ~1 pas par tick en régime établi, plus le crédit
  // initial accumulé.
  assert.ok(fast.x <= PLAYER_SPEED * (60 + MAX_STEP_CREDIT) * DT + 1e-9, `fast x = ${fast.x}`);
  assert.ok(fast.x < PLAYER_SPEED * 1.2, `fast x = ${fast.x}`);
  // late a rattrapé son retard : ses 60 inputs sont appliqués.
  assert.equal(late.inputQueue.length, 0);
  assert.ok(Math.abs(late.x - PLAYER_SPEED * 60 * DT) < 1e-9, `late x = ${late.x}`);
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

test("hitlag : le recul reçu pendant le gel s'applique en entier à sa sortie", () => {
  const p = addPlayer(state, { x: 0, y: -20 });
  p.knockbackVx = 8;
  p.hitlagUntil = clock.now + 100;
  step(5); // 83 ms, figé
  assert.equal(p.x, 0);
  assert.equal(p.knockbackVx, 8);
  step(60);
  // Même recul total que sans gel (cf. test suivant) : rien n'est perdu.
  assert.ok(p.x > 1.2 && p.x < 1.5, `x = ${p.x}`);
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
