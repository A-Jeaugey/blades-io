// Manches chronométrées (tâche 7.1) : minuterie, arène qui se resserre,
// classement de la manche, podium et manche suivante.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  MAP_RADIUS,
  MatchPhase,
  ROUND_DURATION_MS,
  ROUND_FINAL_RADIUS,
  ROUND_INTERMISSION_MS,
  ROUND_PODIUM_BONUS,
  ROUND_SHRINK_MS,
  WALL_KILL_THICKNESS,
  roundArenaRadius,
} from "@bladeio/shared";
import * as matches from "../src/auth/matches";
import * as wallet from "../src/auth/wallet";
import * as telemetry from "../src/telemetry";
import { pickSpawnPoint, randomSpawnPoint } from "../src/systems/spawnPoint";
import { FakeClock, addGroundBlade, giveBlade, seedRandom } from "./helpers";
import { TestRoom } from "./testRoom";

let clock: FakeClock;
let restoreRandom: () => void;
let credits: Array<[string, string, number]>;
let lives: telemetry.LifeRecord[];

beforeEach(() => {
  clock = new FakeClock();
  restoreRandom = seedRandom(21);
  credits = [];
  lives = [];
  (telemetry as any).recordLife = (rec: telemetry.LifeRecord) => { lives.push(rec); };
  (matches as any).recordMatch = async () => {};
  (wallet as any).creditWallet = async (id: string, n: number) => { credits.push(["user", id, n]); };
  (wallet as any).creditGuestWallet = async (id: string, n: number) => { credits.push(["guest", id, n]); };
});
afterEach(() => {
  clock.restore();
  restoreRandom();
});

// Avance l'horloge jusqu'à `ms` avant l'échéance de la phase, puis un tick.
function jumpTo(r: TestRoom, msBeforeEnd: number): void {
  clock.now = r.state.phaseEndsAt - msBeforeEnd;
  r.tick();
}

test("rayon : plein jusqu'à la dernière minute, puis linéaire jusqu'au rayon final", () => {
  const end = 1_000_000;
  assert.equal(roundArenaRadius(MAP_RADIUS, end - ROUND_DURATION_MS, end), MAP_RADIUS);
  assert.equal(roundArenaRadius(MAP_RADIUS, end - ROUND_SHRINK_MS, end), MAP_RADIUS);
  assert.equal(roundArenaRadius(MAP_RADIUS, end - ROUND_SHRINK_MS / 2, end), (MAP_RADIUS + ROUND_FINAL_RADIUS) / 2);
  assert.equal(roundArenaRadius(MAP_RADIUS, end, end), ROUND_FINAL_RADIUS);
  assert.equal(roundArenaRadius(MAP_RADIUS, end + 5000, end), ROUND_FINAL_RADIUS);
});

test("manche : 5 minutes, podium de 15 s, puis manche suivante", () => {
  const r = new TestRoom(clock, { mode: "rounds" });
  const start = clock.now;
  assert.equal(r.state.mode, "rounds");
  assert.equal(r.state.phase, MatchPhase.Playing);
  assert.equal(r.state.phaseEndsAt, start + ROUND_DURATION_MS);
  r.join("a");
  jumpTo(r, 1000);
  assert.equal(r.state.phase, MatchPhase.Playing);
  jumpTo(r, 0);
  assert.equal(r.state.phase, MatchPhase.Over);
  const [end] = r.eventsOf("matchEnd");
  assert.equal(end.nextAt, clock.now + ROUND_INTERMISSION_MS);
  assert.equal(r.state.phaseEndsAt, end.nextAt);
  clock.now = end.nextAt;
  r.tick();
  assert.equal(r.state.phase, MatchPhase.Playing);
  assert.equal(r.state.phaseEndsAt, clock.now + ROUND_DURATION_MS);
  assert.equal(r.state.mapRadius, MAP_RADIUS);
});

test("arène resserrée : le mur tue au rayon du moment, les apparitions restent dedans", () => {
  const r = new TestRoom(clock, { mode: "rounds" });
  const inside = r.join("inside");
  const outside = r.join("outside");
  jumpTo(r, ROUND_SHRINK_MS / 2);
  const radius = (MAP_RADIUS + ROUND_FINAL_RADIUS) / 2;
  assert.ok(Math.abs(r.state.mapRadius - radius) < 0.5, `rayon ${r.state.mapRadius}`);
  inside.x = radius - WALL_KILL_THICKNESS - 6; inside.y = 0;
  outside.x = 0; outside.y = radius - WALL_KILL_THICKNESS + 3;
  // Butin resté dehors : désintégré par le mur ; celui de dedans reste.
  const lostLoot = addGroundBlade(r.state, { x: -(radius + 20), y: 0 });
  const keptLoot = addGroundBlade(r.state, { x: 0, y: -(radius - 20) });
  r.tick();
  assert.equal(inside.alive, true);
  assert.equal(outside.alive, false);
  assert.deepEqual(r.eventsOf("playerKilled").map((e) => [e.victimId, e.cause]), [["outside", "wall"]]);
  assert.equal(r.state.blades.has(lostLoot.id), false);
  assert.equal(r.state.blades.has(keptLoot.id), true);
  assert.equal(r.eventsOf("bladeDestroyed").length, 0);
  // Apparitions (humains, bots) : à l'intérieur, loin du mur qui avance.
  jumpTo(r, 1000);
  const zone = r.state.mapRadius - WALL_KILL_THICKNESS;
  for (let i = 0; i < 50; i++) {
    const s = pickSpawnPoint(r.state);
    assert.ok(Math.hypot(s.x, s.y) <= zone - 19, `apparition à ${Math.hypot(s.x, s.y).toFixed(1)} pour ${zone}`);
    const b = randomSpawnPoint(r.state);
    assert.ok(Math.hypot(b.x, b.y) <= zone - 4);
  }
});

test("classement : points de toutes les vies de la manche, kills, morts ; podium crédité en public", () => {
  const r = new TestRoom(clock, { mode: "rounds" });
  const a = r.join("a", { userId: "u-a" });
  const b = r.join("b", { guestId: "g-b" });
  const c = r.join("c");
  for (let i = 0; i < 4; i++) giveBlade(r.state, a);
  a.bonusScore = 300; b.bonusScore = 120; c.bonusScore = 10;
  r.tick();
  const bFirstLife = b.score;
  const cLife = c.score;
  r.room.killPlayer(b, a, "blades");
  r.room.handleRespawn({ sessionId: "b" }, {});
  b.bonusScore = 90;
  r.room.killPlayer(c, null, "wall");
  credits.length = 0;
  jumpTo(r, 0);
  const [end] = r.eventsOf("matchEnd");
  // b : sa vie finie plus sa vie en cours ; c : sa seule vie, finie.
  assert.deepEqual(
    end.standings.map((s: any) => [s.id, s.score, s.kills, s.deaths, s.bonus]),
    [
      ["a", a.score, 1, 0, ROUND_PODIUM_BONUS[0]],
      ["b", bFirstLife + b.score, 0, 1, ROUND_PODIUM_BONUS[1]],
      ["c", cLife, 0, 1, 0],
    ],
  );
  assert.equal(end.standings[0].bestBlades, 7);
  // Trophées des vies en cours (a, b) et du podium ; c n'a pas de
  // portefeuille, ni trophées ni bonus.
  assert.deepEqual(credits.slice().sort(), [
    ["guest", "g-b", ROUND_PODIUM_BONUS[1]],
    ["guest", "g-b", b.score],
    ["user", "u-a", ROUND_PODIUM_BONUS[0]],
    ["user", "u-a", a.score],
  ].sort());
  assert.deepEqual(lives.filter((l) => l.cause === "match_end").map((l) => l.gameMode), ["rounds", "rounds"]);

  // Salon privé : ni trophées, ni bonus.
  const priv = new TestRoom(clock, { mode: "rounds", code: "ABCDE" });
  const p = priv.join("p", { userId: "u-p" });
  p.bonusScore = 500;
  credits.length = 0;
  jumpTo(priv, 0);
  assert.equal(priv.eventsOf("matchEnd")[0].standings[0].bonus, 0);
  assert.deepEqual(credits, []);
});

test("manche suivante : classement remis à zéro, tout le monde en jeu", () => {
  const r = new TestRoom(clock, { mode: "rounds" });
  const a = r.join("a");
  a.bonusScore = 200;
  r.tick();
  r.room.killPlayer(a, null, "wall");
  jumpTo(r, 0);
  clock.now = r.state.phaseEndsAt;
  r.tick();
  assert.equal(a.alive, true);
  assert.deepEqual(r.room.buildSummary().board.map((row: any[]) => [row[0], row[2]]), [["a", Math.floor(a.score)]]);
});

test("bots : la dernière minute se joue dans l'arène resserrée sans s'y jeter", () => {
  const r = new TestRoom(clock, { mode: "rounds", bots: true });
  r.join("human");
  r.state.phaseEndsAt = clock.now + ROUND_SHRINK_MS + 5000;
  let ticks = 0;
  while (r.state.phase === MatchPhase.Playing && ticks++ < 70 * 60) r.tick();
  assert.equal(r.state.phase, MatchPhase.Over);
  const botWallDeaths = r.eventsOf("playerKilled").filter((e) => e.cause === "wall" && e.victimId.startsWith("bot_")).length;
  const bots = r.eventsOf("matchEnd")[0].standings.filter((s: any) => s.bot).length;
  assert.ok(bots >= 10, `${bots} bots`);
  assert.ok(botWallDeaths <= 2, `${botWallDeaths} bots tués par le mur`);
});
