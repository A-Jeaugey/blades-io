// Tests d'intégration : la room complète, tick par tick, hors réseau.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  BladeRarity,
  CLOSE_CODE_INPUT_FLOOD,
  GROUND_BLADE_TTL_MS,
  MAP_RADIUS,
  PLAYER_SPEED,
  SPAWN_PROTECTION_MS,
  WALL_KILL_THICKNESS,
} from "@bladeio/shared";
import * as matches from "../src/auth/matches";
import * as wallet from "../src/auth/wallet";
import { Blade } from "../src/state/Blade";
import { Player } from "../src/state/Player";
import { FakeClock, giveBlade, groundBlades, ownedBlades, seedRandom } from "./helpers";
import { TestRoom } from "./testRoom";

let clock: FakeClock;
let restoreRandom: () => void;
let credits: Array<[string, string, number]>;
let recorded: matches.MatchRecord[];

beforeEach(() => {
  clock = new FakeClock();
  restoreRandom = seedRandom(99);
  credits = [];
  recorded = [];
  // Les modules auth sont remplacés : aucun appel Supabase pendant les tests.
  (wallet as any).creditWallet = async (id: string, n: number) => { credits.push(["user", id, n]); };
  (wallet as any).creditGuestWallet = async (id: string, n: number) => { credits.push(["guest", id, n]); };
  (matches as any).recordMatch = async (rec: matches.MatchRecord) => { recorded.push(rec); };
});
afterEach(() => {
  clock.restore();
  restoreRandom();
});

function fakeClient(sessionId: string) {
  const leaveCodes: number[] = [];
  return { sessionId, leaveCodes, leave: (code: number) => { leaveCodes.push(code); } };
}

function armed(r: TestRoom, id: string, total: number): Player {
  const p = r.join(id);
  while (p.bladeCount < total) giveBlade(r.state, p);
  return p;
}

test("mort : 70 % des lames en orbite tombent au sol, avec échéance et verrou", () => {
  const r = new TestRoom(clock);
  const victim = armed(r, "victim", 20);
  const killer = r.join("killer");
  r.room.killPlayer(victim, killer, "blades");
  const drops = groundBlades(r.state);
  assert.equal(drops.length, 14);
  for (const b of drops) {
    assert.equal(b.expiresAt, clock.now + GROUND_BLADE_TTL_MS);
    assert.equal(b.pickupLockUntil, clock.now + 400);
    assert.deepEqual([b.x, b.y], [victim.x, victim.y]);
  }
  assert.equal(victim.alive, false);
  assert.equal(victim.bladeCount, 0);
  assert.equal(ownedBlades(r.state, victim).length, 0);
  assert.equal(killer.kills, 1);
  assert.ok(killer.score >= 15);
  assert.equal(r.eventsOf("playerKilled")[0].killerId, killer.id);
});

test("mort : les lames perdues dans les 10 dernières secondes tombent aussi", () => {
  const r = new TestRoom(clock);
  const victim = armed(r, "victim", 10);
  for (const b of ownedBlades(r.state, victim).slice(0, 4)) r.room.handleBladeDestroyed(b);
  assert.equal(victim.bladeCount, 6);
  r.room.killPlayer(victim, null, "wall");
  // floor(6 × 0,7) = 4 lames en orbite + 4 pertes récentes.
  assert.equal(groundBlades(r.state).length, 8);

  const r2 = new TestRoom(clock);
  const old = armed(r2, "old", 10);
  for (const b of ownedBlades(r2.state, old).slice(0, 4)) r2.room.handleBladeDestroyed(b);
  clock.advance(11_000);
  r2.room.killPlayer(old, null, "wall");
  assert.equal(groundBlades(r2.state).length, 4);
});

test("drops : clignotent puis disparaissent, les lames ambiantes restent", () => {
  const r = new TestRoom(clock);
  const victim = armed(r, "victim", 20);
  const far = r.join("far");
  victim.x = 0; victim.y = -20;
  far.x = 150; far.y = 150;
  r.tick(120);
  const ambient = groundBlades(r.state).map((b) => b.id);
  assert.ok(ambient.length > 0);
  r.room.killPlayer(victim, null, "wall");
  const drops = groundBlades(r.state).filter((b) => b.expiresAt > 0);
  assert.equal(drops.length, 14);
  const killedAt = clock.now;
  while (clock.now - killedAt < 13_100) r.tick();
  for (const b of drops) assert.equal(r.state.blades.get(b.id)?.expiring, true);
  while (clock.now - killedAt < 16_100) r.tick();
  for (const b of drops) assert.equal(r.state.blades.has(b.id), false);
  for (const id of ambient) assert.equal(r.state.blades.has(id), true);
});

test("input : valeurs bornées, non finies ignorées", () => {
  const r = new TestRoom(clock);
  const p = r.join("p1");
  r.room.handleInput(fakeClient("p1"), { dx: 5, dy: Number.NEGATIVE_INFINITY, boost: 1, throw: true, seq: 7 });
  assert.equal(p.inputDx, 1);
  assert.equal(p.inputDy, 0);
  assert.equal(p.inputBoost, true);
  assert.equal(p.inputThrow, true);
  assert.equal(p.lastSeq, 7);
  r.room.handleInput(fakeClient("p1"), { dx: Number.NaN, dy: -0.5 });
  assert.equal(p.inputDx, 0);
  assert.equal(p.inputDy, -0.5);
});

test("input : visée normalisée, lue seulement avec le lancer", () => {
  const r = new TestRoom(clock);
  const p = r.join("p1");
  // Sans lancer, la visée est ignorée.
  r.room.handleInput(fakeClient("p1"), { dx: 1, dy: 0, aimX: 3, aimY: 4 });
  assert.equal(p.aimX, 0);
  assert.equal(p.aimY, 0);
  r.room.handleInput(fakeClient("p1"), { dx: 1, dy: 0, throw: true, aimX: 3, aimY: 4 });
  assert.equal(p.inputThrow, true);
  assert.ok(Math.abs(p.aimX - 0.6) < 1e-12 && Math.abs(p.aimY - 0.8) < 1e-12);
  // Un message sans lancer arrivé dans le même tick ne l'efface pas.
  r.room.handleInput(fakeClient("p1"), { dx: 1, dy: 0, aimX: -1, aimY: 0 });
  assert.ok(Math.abs(p.aimX - 0.6) < 1e-12);
  // Visée non finie, nulle ou absente : pas de visée, le lancer suivra le
  // déplacement.
  for (const bad of [
    { aimX: Number.NaN, aimY: 1 },
    { aimX: Number.POSITIVE_INFINITY, aimY: 0 },
    { aimX: 0, aimY: 0 },
    { aimX: "1", aimY: {} },
    {},
  ]) {
    r.room.handleInput(fakeClient("p1"), { dx: 1, dy: 0, throw: true, ...bad });
    assert.equal(p.aimX, 0);
    assert.equal(p.aimY, 0);
  }
});

test("lancer visé bout à bout : on lance derrière soi en fuyant", () => {
  const r = new TestRoom(clock);
  const p = r.join("p1");
  p.x = 0; p.y = -30;
  for (let i = 0; i < 5; i++) giveBlade(r.state, p);
  r.room.handleInput(fakeClient("p1"), { dx: 1, dy: 0 });
  r.tick(10);
  r.room.handleInput(fakeClient("p1"), { dx: 1, dy: 0, throw: true, aimX: -1, aimY: 0 });
  r.tick();
  const [ev] = r.eventsOf("bladeThrown");
  assert.ok(ev, "aucun lancer");
  assert.equal(ev.dirX, -1);
  assert.ok(p.dirX > 0.99, "le joueur continue de fuir vers +x");
  const blade = r.state.blades.get(ev.bladeId)!;
  assert.ok(blade.vx < 0 && blade.x < p.x);
});

test("input : un joueur muet depuis 500 ms s'arrête", () => {
  const r = new TestRoom(clock);
  const p = r.join("p1");
  p.x = 0; p.y = -20;
  r.room.handleInput(fakeClient("p1"), { dx: 1, dy: 0 });
  r.tick(120);
  assert.ok(Math.abs(p.x - PLAYER_SPEED * 0.5) < 0.2, `x = ${p.x}`);
});

test("anti-flood : 200 inputs/s expulsent en 3 s, 60/s jamais", () => {
  const r = new TestRoom(clock);
  r.join("flood");
  r.join("normal");
  const flood = fakeClient("flood");
  const start = clock.now;
  let kickedAfter = -1;
  while (clock.now - start < 5000 && kickedAfter < 0) {
    clock.advance(5);
    r.room.handleInput(flood, { dx: 0, dy: 0 });
    if (flood.leaveCodes.length > 0) kickedAfter = clock.now - start;
  }
  assert.deepEqual(flood.leaveCodes, [CLOSE_CODE_INPUT_FLOOD]);
  assert.ok(kickedAfter >= 2900 && kickedAfter <= 3200, `expulsé après ${kickedAfter} ms`);

  const normal = fakeClient("normal");
  for (let i = 0; i < 600; i++) {
    clock.advance(1000 / 60);
    r.room.handleInput(normal, { dx: 0, dy: 0 });
  }
  assert.deepEqual(normal.leaveCodes, []);
});

test("anti-flood : deux rafales de 2 s séparées d'une seconde normale ne font pas expulser", () => {
  const r = new TestRoom(clock);
  r.join("bursty");
  const bursty = fakeClient("bursty");
  const send = (ms: number, perSecond: number) => {
    const end = clock.now + ms;
    while (clock.now < end) {
      clock.advance(1000 / perSecond);
      r.room.handleInput(bursty, { dx: 0, dy: 0 });
    }
  };
  send(2000, 200);
  send(1000, 60);
  send(2000, 200);
  send(500, 60);
  assert.deepEqual(bursty.leaveCodes, []);
});

test("trophées : crédités en fin de vie en public, jamais en privé ni pour un bot", async () => {
  const pub = new TestRoom(clock);
  const guest = pub.join("guest", { guestId: "g-1" });
  guest.score = 50;
  pub.room.killPlayer(guest, null, "wall");
  const user = pub.join("user", { userId: "u-1" });
  user.score = 30;
  pub.room.killPlayer(user, null, "wall");
  const leaver = pub.join("leaver", { guestId: "g-3" });
  leaver.score = 12;
  await pub.room.onLeave({ sessionId: "leaver" }, true);
  const broke = pub.join("broke", { guestId: "g-4" });
  broke.score = 0;
  pub.room.killPlayer(broke, null, "wall");
  assert.deepEqual(credits, [["guest", "g-1", 50], ["user", "u-1", 30], ["guest", "g-3", 12]]);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].userId, "u-1");
  assert.equal(recorded[0].score, 30);

  credits = [];
  recorded = [];
  const priv = new TestRoom(clock, { code: "ABCDE" });
  const friend = priv.join("friend", { guestId: "g-2" });
  friend.score = 50;
  priv.room.killPlayer(friend, null, "wall");
  const bot = pub.join("bot", { guestId: "g-5" });
  bot.isBot = true;
  bot.score = 40;
  pub.room.killPlayer(bot, null, "wall");
  assert.deepEqual(credits, []);
  assert.deepEqual(recorded, []);
});

test("trophées : un ramassage juste avant la mort ne réduit pas le score crédité", () => {
  const r = new TestRoom(clock);
  const p = r.join("p1", { guestId: "g-9" });
  p.kills = 3;
  r.tick(); // updateScore : 3 × 15 + record de 3 lames
  const composite = p.score;
  giveBlade(r.state, p);
  r.room.killPlayer(p, null, "wall");
  assert.deepEqual(credits, [["guest", "g-9", composite]]);
});

test("respawn : 3 lames, statistiques remises à zéro, protection de spawn", () => {
  const r = new TestRoom(clock);
  const p = armed(r, "p1", 12);
  p.kills = 3;
  r.room.killPlayer(p, null, "wall");
  r.room.handleRespawn(fakeClient("p1"), {});
  assert.equal(p.alive, true);
  assert.equal(p.bladeCount, 3);
  assert.equal(ownedBlades(r.state, p).length, 3);
  assert.equal(p.kills, 0);
  assert.equal(p.maxBladeCount, 3);
  assert.equal(p.spawnProtectionUntil, clock.now + SPAWN_PROTECTION_MS);
});

test("boost : les lames les moins rares sont dépensées en premier", () => {
  const r = new TestRoom(clock);
  const p = r.join("p1"); // 3 Common
  const legendary = giveBlade(r.state, p, BladeRarity.Legendary);
  const rare = giveBlade(r.state, p, BladeRarity.Rare);
  r.room.removePlayerBlades(p, 3);
  const left = (): Blade[] => ownedBlades(r.state, p);
  assert.deepEqual(left().map((b) => b.id).sort(), [legendary.id, rare.id].sort());
  r.room.removePlayerBlades(p, 1);
  assert.deepEqual(left().map((b) => b.id), [legendary.id]);
  assert.equal(p.bladeCount, 1);
});

test("tick : tier recalculé d'après le nombre de lames, avec un évènement tierUp", () => {
  const r = new TestRoom(clock);
  const p = armed(r, "p1", 10);
  p.x = 0; p.y = -20;
  // armed() tient le tier à jour ; on repart de l'état d'avant le tick.
  p.tier = 0;
  r.tick();
  assert.equal(p.tier, 1);
  assert.deepEqual(r.eventsOf("tierUp").map((e) => [e.playerId, e.tier]), [[p.id, 1]]);
});

test("mur : une lame désintégrée est signalée au-delà du bord de l'arène", () => {
  // Le client reconnaît une lame détruite par le mur à sa position
  // (WALL_ZAP_RADIUS dans client/src/main.ts) : ce test fige ce contrat.
  const r = new TestRoom(clock);
  const p = armed(r, "p1", 3);
  const killRadius = MAP_RADIUS - WALL_KILL_THICKNESS;
  p.x = killRadius - 1; // corps dans l'arène, orbite (1,8 u) qui déborde
  p.y = 0;
  r.tick(30);
  const events = r.eventsOf("bladeDestroyed");
  assert.equal(events.length, 3);
  for (const e of events) assert.ok(Math.hypot(e.x, e.y) > killRadius - 0.5, `rayon ${Math.hypot(e.x, e.y)}`);
  assert.equal(p.alive, true);
});

test("tick : l'état publie l'heure du serveur (référence des échéances côté client)", () => {
  const r = new TestRoom(clock);
  r.tick();
  assert.equal(r.state.serverTime, clock.now);
  const p = r.join("p1");
  // Les échéances sont dans la même horloge que serverTime.
  assert.ok(Math.abs(p.spawnedAt - r.state.serverTime) < 50);
});
