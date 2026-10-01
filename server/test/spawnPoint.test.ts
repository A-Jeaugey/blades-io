// Spawn sûr et période de grâce (tâche 3.2). Le comportement des bots face
// à un joueur en grâce est testé dans bots.test.ts ; l'effet d'ensemble
// (temps avant la première mort d'un débutant) se mesure avec
// `node tools/bench-survival.js first`.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { SPAWN_GRACE_MS, SPAWN_GRACE_RAMP_MS, SPAWN_LOOT_RADIUS, SPAWN_RADIUS } from "@bladeio/shared";
import { ArenaState } from "../src/state/ArenaState";
import { pickSpawnPoint, spawnClearance } from "../src/systems/spawnPoint";
import { FakeClock, addGroundBlade, addPlayer, giveBlade, seedRandom } from "./helpers";
import { TestRoom } from "./testRoom";

let clock: FakeClock;
let restoreRandom: () => void;

beforeEach(() => {
  clock = new FakeClock();
  restoreRandom = seedRandom(42);
});
afterEach(() => {
  clock.restore();
  restoreRandom();
});

function fakeClient(sessionId: string) {
  return { sessionId, leave: () => {} };
}

test("spawn : distance requise croissante avec les lames, plafonnée", () => {
  assert.equal(spawnClearance(0), 35);
  assert.equal(spawnClearance(3), 41);
  assert.equal(spawnClearance(20), 75);
  assert.equal(spawnClearance(500), 100);
});

test("spawn : dans le rayon de spawn, à distance des joueurs selon leurs lames", () => {
  const state = new ArenaState();
  const players = [
    addPlayer(state, { x: 0, y: 0, blades: 40 }),
    addPlayer(state, { x: 80, y: 60, blades: 12 }),
    addPlayer(state, { x: -90, y: -40, blades: 3 }),
  ];
  for (let i = 0; i < 200; i++) {
    const s = pickSpawnPoint(state);
    assert.ok(Math.hypot(s.x, s.y) <= SPAWN_RADIUS + 1e-9, `rayon ${Math.hypot(s.x, s.y)}`);
    for (const p of players) {
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      assert.ok(d >= spawnClearance(p.bladeCount), `${d.toFixed(1)} u d'un joueur à ${p.bladeCount} lames`);
    }
  }
});

test("spawn : à sécurité égale, là où il y a des lames au sol", () => {
  const state = new ArenaState();
  for (let i = 0; i < 8; i++) addGroundBlade(state, { x: 70 + (i % 3), y: 70 + Math.floor(i / 3) });
  let near = 0;
  for (let i = 0; i < 200; i++) {
    const s = pickSpawnPoint(state);
    if (Math.hypot(s.x - 71, s.y - 71) < SPAWN_LOOT_RADIUS) near++;
  }
  // Un tirage uniforme y tomberait 3 % du temps ; le meilleur de 30 dès
  // qu'un candidat y tombe (57 % des cas).
  assert.ok(near > 80, `${near} spawns sur 200 près des lames`);
});

test("grâce : posée à l'arrivée et au respawn, jamais pour un bot", () => {
  const r = new TestRoom(clock, { bots: true });
  const p = r.join("p1", {}, { protected: true });
  assert.equal(p.graceUntil, clock.now + SPAWN_GRACE_MS);
  assert.equal(p.graceRampUntil, p.graceUntil + SPAWN_GRACE_RAMP_MS);
  r.tick();
  r.room.killPlayer(p, null, "wall");
  clock.advance(4000);
  r.room.handleRespawn(fakeClient("p1"), {});
  assert.equal(p.graceUntil, clock.now + SPAWN_GRACE_MS);
  assert.equal(p.graceRampUntil, p.graceUntil + SPAWN_GRACE_RAMP_MS);
  let bots = 0;
  r.state.players.forEach((b) => {
    if (!b.isBot) return;
    bots++;
    assert.equal(b.graceUntil, 0);
  });
  assert.ok(bots > 0);
});

test("grâce : s'arrête au premier lancer", () => {
  const r = new TestRoom(clock);
  const p = r.join("p1", {}, { protected: true });
  p.x = 0; p.y = -30;
  r.room.handleInput(fakeClient("p1"), { dx: 0, dy: 0, throw: true, aimX: 1, aimY: 0 });
  r.tick();
  assert.equal(r.eventsOf("bladeThrown").length, 1);
  assert.equal(p.graceUntil, 0);
  assert.equal(p.graceRampUntil, 0);
});

test("grâce : s'arrête au premier clash", () => {
  const r = new TestRoom(clock);
  const p1 = r.join("p1", {}, { protected: true });
  // Invulnérabilité écoulée, grâce en cours.
  p1.spawnProtectionUntil = 0;
  const p2 = r.join("p2");
  p1.x = 0; p1.y = -20;
  p2.x = 3.4; p2.y = -20;
  assert.ok(p1.graceUntil > clock.now);
  for (let i = 0; i < 120 && r.eventsOf("clash").length === 0; i++) r.tick();
  assert.ok(r.eventsOf("clash").length > 0, "aucun clash");
  assert.equal(p1.graceUntil, 0);
  assert.equal(p1.graceRampUntil, 0);
});

test("grâce : un clash avec un bot lancé à sa poursuite ne la lève pas", () => {
  // C'est le bot qui attaque : si le contact levait la protection, tous les
  // autres bots fondraient aussitôt sur le nouveau venu.
  const r = new TestRoom(clock);
  const p = r.join("p1", {}, { protected: true });
  const bot = r.room.bots.spawnBot(r.state, { x: 10, y: 10 });
  r.room.bots.isChasing = (botId: string, targetId: string) => botId === bot.id && targetId === p.id;
  r.room.endGraceOnContact(p, bot);
  assert.ok(p.graceUntil > clock.now);
  assert.ok(p.graceRampUntil > clock.now);
  // Contact avec un joueur (ou un bot qui ne le poursuit pas) : levée.
  const other = r.join("p2");
  r.room.endGraceOnContact(p, other);
  assert.equal(p.graceUntil, 0);
  assert.equal(p.graceRampUntil, 0);
});

test("grâce : s'arrête à la première élimination", () => {
  const r = new TestRoom(clock);
  const p = r.join("p1", {}, { protected: true });
  giveBlade(r.state, p);
  const victim = r.join("p2");
  r.room.killPlayer(victim, p, "blades");
  assert.equal(p.graceUntil, 0);
  assert.equal(p.graceRampUntil, 0);
});
