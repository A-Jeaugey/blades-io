// Télémétrie de gameplay (tâche 4.8) : une ligne par fin de vie d'un
// joueur humain, avec ce qu'il faut pour équilibrer.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { CloseCode } from "@colyseus/core";
import { BladeRarity, SERVER_DT } from "@bladeio/shared";
import * as matches from "../src/auth/matches";
import * as wallet from "../src/auth/wallet";
import * as telemetry from "../src/telemetry";
import { FakeClock, giveBlade, seedRandom } from "./helpers";
import { TestRoom } from "./testRoom";

let clock: FakeClock;
let restoreRandom: () => void;
let lives: telemetry.LifeRecord[];

beforeEach(() => {
  clock = new FakeClock();
  restoreRandom = seedRandom(11);
  lives = [];
  // Aucun appel Supabase : les écritures sont capturées.
  (telemetry as any).recordLife = (rec: telemetry.LifeRecord) => { lives.push(rec); };
  (matches as any).recordMatch = async () => {};
  (wallet as any).creditWallet = async () => {};
  (wallet as any).creditGuestWallet = async () => {};
});
afterEach(() => {
  clock.restore();
  restoreRandom();
});

test("mort : cause, tueur, durée et rang de la vie ; un respawn ouvre la vie suivante", () => {
  const r = new TestRoom(clock);
  const a = r.join("a", {}, { newcomer: true });
  const bot = r.join("bot");
  bot.isBot = true;
  clock.advance(12_000);
  r.room.killPlayer(a, bot, "blades");
  assert.equal(lives.length, 1);
  assert.deepEqual(
    {
      cause: lives[0].cause, killerKind: lives[0].killerKind, killerTier: lives[0].killerTier,
      lifeIndex: lives[0].lifeIndex, newcomer: lives[0].newcomer, durationMs: lives[0].durationMs,
      roomPrivate: lives[0].roomPrivate, humans: lives[0].humans, bots: lives[0].bots,
    },
    {
      cause: "blades", killerKind: "bot", killerTier: 0,
      lifeIndex: 1, newcomer: true, durationMs: 12_000,
      roomPrivate: false, humans: 1, bots: 1,
    },
  );
  assert.equal(lives[0].victimBlades, 3);
  assert.equal(lives[0].killerBlades, 3);

  r.room.handleRespawn({ sessionId: "a" }, {});
  clock.advance(3_000);
  r.room.killPlayer(a, null, "wall");
  assert.equal(lives.length, 2);
  assert.equal(lives[1].lifeIndex, 2);
  assert.equal(lives[1].cause, "wall");
  assert.equal(lives[1].killerKind, null);
  assert.equal(lives[1].durationMs, 3_000);
});

test("vie : lancers, touches, temps de boost et palier maximal", () => {
  const r = new TestRoom(clock);
  const a = r.join("a");
  const b = r.join("b");
  a.x = 0; a.y = 0; a.dirX = 1; a.dirY = 0;
  b.x = 9; b.y = 0;
  for (let i = 0; i < 9; i++) giveBlade(r.state, a, BladeRarity.Common);
  r.tick(); // 12 lames : palier 1
  assert.equal(a.lifeMaxTier, 1);

  // Un lancer droit sur b : une seule touche, même s'il perce plusieurs
  // cibles.
  a.inputThrow = true;
  r.tick(30);
  assert.equal(a.lifeThrows, 1);
  assert.equal(a.lifeThrowHits, 1);

  // Une demi-seconde de boost.
  let seq = 0;
  for (let i = 0; i < 30; i++) {
    a.inputQueue.push({ dx: 0, dy: 1, boost: true, seq: ++seq });
    r.tick();
  }
  assert.ok(Math.abs(a.lifeBoostMs - 30 * SERVER_DT * 1000) < 1e-6);

  r.room.killPlayer(a, null, "wall");
  const life = lives.find((l) => l.cause === "wall")!;
  assert.equal(life.throws, 1);
  assert.equal(life.throwHits, 1);
  assert.equal(life.maxTier, 1);
  assert.ok(life.boostMs > 0);
  // Le palier retombé avec les lames perdues ne change pas le maximum.
  assert.equal(life.maxBlades, 12);
});

test("fin de vie : départ en vie, bots ignorés, room privée signalée", async () => {
  const pub = new TestRoom(clock);
  pub.join("leaver");
  clock.advance(5_000);
  await pub.room.onLeave({ sessionId: "leaver" }, CloseCode.CONSENTED);
  const bot = pub.join("bot");
  bot.isBot = true;
  pub.room.killPlayer(bot, null, "wall");
  assert.deepEqual(lives.map((l) => [l.cause, l.durationMs]), [["quit", 5_000]]);

  lives = [];
  const priv = new TestRoom(clock, { code: "ABCDE" });
  const friend = priv.join("friend");
  priv.room.killPlayer(friend, null, "wall");
  assert.equal(lives.length, 1);
  assert.equal(lives[0].roomPrivate, true);
});

test("un joueur mort qui quitte n'ouvre pas une seconde fin de vie", async () => {
  const r = new TestRoom(clock);
  const a = r.join("a");
  r.room.killPlayer(a, null, "wall");
  await r.room.onLeave({ sessionId: "a" }, CloseCode.CONSENTED);
  assert.deepEqual(lives.map((l) => l.cause), ["wall"]);
});
