// Prédiction avec rejeu d'inputs (tâche 1.2) : un client simulé, avec
// l'InputPredictor du vrai client, derrière 5 ticks de latence dans chaque
// sens (≈ 167 ms d'aller-retour). Sa position prédite doit rester collée à
// la trajectoire du serveur : correction nulle tant qu'aucun évènement
// serveur imprévisible ne survient, une seule correction sinon.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  AckState,
  InputPredictor,
  MoveInput,
  PLAYER_SPEED,
  POWERUP_SPEED_MULT,
  stepMovement,
} from "@bladeio/shared";
import { Player } from "../src/state/Player";
import { DT, FakeClock, seedRandom } from "./helpers";
import { TestRoom } from "./testRoom";

const LATENCY_TICKS = 5;

let clock: FakeClock;
let restoreRandom: () => void;

beforeEach(() => {
  clock = new FakeClock();
  restoreRandom = seedRandom(7);
});
afterEach(() => {
  clock.restore();
  restoreRandom();
});

// Ce que le client lit dans un patch (float32 sur le réseau).
function snapshot(r: TestRoom, p: Player): AckState {
  return {
    seq: p.lastSeq,
    x: Math.fround(p.x),
    y: Math.fround(p.y),
    knockbackVx: Math.fround(p.knockbackVx),
    knockbackVy: Math.fround(p.knockbackVy),
    serverTime: r.state.serverTime,
    speedUntil: p.speedUntil,
    hitlagUntil: p.hitlagUntil,
    bladeCount: p.bladeCount,
  };
}

interface Run {
  // Correction de la position prédite à chaque état reçu, par tick.
  corrections: Map<number, number>;
  // Écart entre la position prédite après le dernier input et celle du
  // serveur une fois cet input appliqué.
  finalGap: number;
}

// inputs(tick) : l'input du client à ce tick ; events(tick, p) : ce que le
// serveur fait au joueur (power-up, recul, hitlag).
function run(ticks: number, inputs: (tick: number) => MoveInput, events: (tick: number, p: Player) => void = () => {}): Run {
  const r = new TestRoom(clock);
  const p = r.join("p1");
  p.x = 0;
  p.y = -30;
  const client = { sessionId: "p1", leave: () => {} };
  const predictor = new InputPredictor();
  const uplink: Array<{ at: number; msg: object }> = [];
  const downlink: Array<{ at: number; ack: AckState }> = [];
  const corrections = new Map<number, number>();
  let seq = 0;
  // Le client envoie dès l'entrée en jeu, avant d'avoir reçu le moindre
  // état : ces inputs-là aussi seront appliqués par le serveur.
  for (let tick = 0; tick < ticks + 2 * LATENCY_TICKS + 2; tick++) {
    if (tick < ticks) {
      const input = inputs(tick);
      seq++;
      predictor.push(seq, input);
      uplink.push({ at: tick + LATENCY_TICKS, msg: { ...input, seq } });
    }
    while (uplink.length && uplink[0].at <= tick) r.room.handleInput(client, uplink.shift()!.msg);
    events(tick, p);
    r.tick();
    downlink.push({ at: tick + LATENCY_TICKS, ack: snapshot(r, p) });
    while (downlink.length && downlink[0].at <= tick) {
      const c = predictor.reconcile(downlink.shift()!.ack);
      corrections.set(tick, Math.hypot(c.dx, c.dy));
    }
  }
  return { corrections, finalGap: Math.hypot(predictor.body.x - p.x, predictor.body.y - p.y) };
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
}

test("pas de mouvement partagé : vitesse, normalisation, boost, Speed, recul, gel", () => {
  const body = { x: 0, y: 0, knockbackVx: 0, knockbackVy: 0 };
  const free = { speed: false, frozen: false, canBoost: true };
  let res = stepMovement(body, { dx: 3, dy: 4, boost: false }, free, 1);
  assert.ok(Math.abs(Math.hypot(body.x, body.y) - PLAYER_SPEED) < 1e-9);
  assert.deepEqual([res.dx, res.dy, res.moving, res.boosting], [0.6, 0.8, true, false]);
  body.x = 10; body.y = -30;
  res = stepMovement(body, { dx: 1, dy: 0, boost: true }, { ...free, canBoost: false }, 0.1);
  assert.equal(res.boosting, false);
  body.x = 10;
  stepMovement(body, { dx: 1, dy: 0, boost: false }, { ...free, speed: true }, 0.1);
  assert.ok(Math.abs(body.x - (10 + PLAYER_SPEED * POWERUP_SPEED_MULT * 0.1)) < 1e-9);
  body.knockbackVx = 8;
  const x0 = body.x;
  res = stepMovement(body, { dx: 1, dy: 0, boost: false }, { ...free, frozen: true }, 0.1);
  assert.equal(body.x, x0);
  assert.equal(body.knockbackVx, 8);
  assert.equal(res.moving, false);
});

test("prédiction : correction nulle en ligne droite, aux virages et à l'arrêt, 167 ms d'aller-retour", (t) => {
  // Droite, virage à 90°, demi-tour, boost, arrêt net, reprise.
  const script = (tick: number): MoveInput => {
    if (tick < 60) return { dx: 1, dy: 0, boost: false };
    if (tick < 90) return { dx: 0, dy: 1, boost: false };
    if (tick < 120) return { dx: 0, dy: -1, boost: false };
    if (tick < 150) return { dx: -0.6, dy: 0.8, boost: true };
    if (tick < 180) return { dx: 0, dy: 0, boost: false };
    return { dx: 1, dy: 1, boost: false };
  };
  const res = run(240, script);
  // Le premier état reçu initialise la prédiction (pas de correction).
  const all = [...res.corrections.values()].slice(1);
  t.diagnostic(`corrections : moyenne ${mean(all).toExponential(2)} u, max ${Math.max(...all).toExponential(2)} u`);
  // Seul écart : l'arrondi float32 des positions reçues.
  assert.ok(Math.max(...all) < 1e-4, `max ${Math.max(...all)}`);
  assert.ok(res.finalGap < 1e-4, `écart final ${res.finalGap}`);
});

test("prédiction : sous Speed, une seule correction quand le client l'apprend", (t) => {
  let pickupTick = -1;
  const res = run(180, () => ({ dx: 1, dy: 0, boost: false }), (tick, p) => {
    // Power-up Speed ramassé au tick 40, pour 2 s.
    if (tick === 40) {
      p.speedUntil = clock.now + 2000;
      pickupTick = tick;
    }
  });
  const learnedAt = pickupTick + LATENCY_TICKS;
  const before = [...res.corrections].filter(([tick]) => tick < learnedAt).map(([, c]) => c);
  const at = res.corrections.get(learnedAt) ?? 0;
  const after = [...res.corrections].filter(([tick]) => tick > learnedAt).map(([, c]) => c);
  t.diagnostic(`correction à l'apprentissage ${at.toFixed(3)} u, ensuite moyenne ${mean(after).toExponential(2)} u, max ${Math.max(...after).toExponential(2)} u`);
  assert.ok(Math.max(...before) < 1e-4);
  // Les inputs déjà envoyés ont été appliqués sous Speed : un rattrapage.
  assert.ok(at > 0.01);
  // Plus de rubber-banding ensuite, fin de l'effet comprise.
  assert.ok(mean(after) < 0.01, `moyenne ${mean(after)}`);
  assert.ok(Math.max(...after) < 0.1, `max ${Math.max(...after)}`);
  assert.ok(res.finalGap < 1e-4);
});

test("prédiction : recul et hitlag rejoués après la première correction", (t) => {
  const res = run(160, () => ({ dx: 0, dy: 1, boost: false }), (tick, p) => {
    if (tick === 40) {
      p.knockbackVx = 20;
      p.hitlagUntil = clock.now + 75;
    }
  });
  const learnedAt = 40 + LATENCY_TICKS;
  const after = [...res.corrections].filter(([tick]) => tick > learnedAt).map(([, c]) => c);
  t.diagnostic(`correction à l'apprentissage ${(res.corrections.get(learnedAt) ?? 0).toFixed(3)} u, ensuite max ${Math.max(...after).toExponential(2)} u`);
  assert.ok((res.corrections.get(learnedAt) ?? 0) > 0.01);
  assert.ok(Math.max(...after) < 1e-3, `max ${Math.max(...after)}`);
  assert.ok(res.finalGap < 1e-4);
});
