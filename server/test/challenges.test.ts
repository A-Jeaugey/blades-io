// Défis quotidiens et hebdomadaires (tâche 5.3).
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  DAILY_CHALLENGES,
  LifeChallengeStats,
  dailyChallenges,
  nextParisMidnight,
  nextParisWeek,
  parisDayKey,
  parisWeekKey,
  weeklyChallenge,
} from "@bladeio/shared";
import * as challenges from "../src/challenges";
import { challengeItems, toChallengesResponse } from "../src/challenges";
import * as matches from "../src/auth/matches";
import * as wallet from "../src/auth/wallet";
import * as telemetry from "../src/telemetry";
import { FakeClock, seedRandom } from "./helpers";
import { TestRoom } from "./testRoom";

test("périodes : minuit et lundi, heure de Paris, changements d'heure compris", () => {
  // 23 h 59 59 à Paris (heure d'été) : encore le 1er octobre.
  assert.equal(parisDayKey(new Date("2026-10-01T21:59:59Z")), "2026-10-01");
  assert.equal(parisDayKey(new Date("2026-10-01T22:00:00Z")), "2026-10-02");
  assert.equal(nextParisMidnight(new Date("2026-10-01T12:00:00Z")).toISOString(), "2026-10-01T22:00:00.000Z");
  // Journée de 25 h (retour à l'heure d'hiver) puis de 23 h (heure d'été).
  assert.equal(nextParisMidnight(new Date("2026-10-25T08:00:00Z")).toISOString(), "2026-10-25T23:00:00.000Z");
  assert.equal(nextParisMidnight(new Date("2026-03-29T08:00:00Z")).toISOString(), "2026-03-29T22:00:00.000Z");
  // Semaine ISO, lundi minuit ; le 1er janvier 2027 est en semaine 53 de 2026.
  assert.equal(parisWeekKey(new Date("2026-10-01T12:00:00Z")), "2026-W40");
  assert.equal(parisWeekKey(new Date("2027-01-01T12:00:00Z")), "2026-W53");
  assert.equal(nextParisWeek(new Date("2026-10-01T12:00:00Z")).toISOString(), "2026-10-04T22:00:00.000Z");
});

test("tirage : les mêmes pour tous un jour donné, un facile, un moyen, un difficile, jamais deux de survie", () => {
  assert.deepEqual(dailyChallenges("2026-10-01"), dailyChallenges("2026-10-01"));
  for (let i = 0; i < 400; i++) {
    const key = parisDayKey(new Date(Date.UTC(2026, 0, 1) + i * 86400000));
    const set = dailyChallenges(key);
    assert.deepEqual(set.map((c) => c.tier), ["easy", "medium", "hard"]);
    assert.ok(set.filter((c) => c.metric === "survivalTotal" || c.metric === "lifeSurvival").length <= 1, key);
  }
  assert.ok(weeklyChallenge("2026-W40"));
  // Le tirage varie d'un jour à l'autre.
  const seen = new Set<string>();
  for (let d = 1; d <= 20; d++) seen.add(dailyChallenges(`2026-10-${String(d).padStart(2, "0")}`).map((c) => c.id).join());
  assert.ok(seen.size > 10);
});

const life: LifeChallengeStats = {
  throws: 7, crates: 2, kills: 1, powerups: 0, survivalSeconds: 95.6,
  biggerKills: 0, leaderKills: 0, peakBlades: 33, wasLeader: false,
};

test("une vie fait avancer les défis du jour et de la semaine, valeurs nulles écartées", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  const items = challengeItems(life, now);
  const active = [...dailyChallenges("2026-10-01"), weeklyChallenge("2026-W40")];
  for (const item of items) {
    const def = active.find((c) => c.id === item.challenge)!;
    assert.ok(def, item.challenge);
    assert.equal(item.target, def.target);
    assert.equal(item.reward, def.reward);
    assert.ok(item.value > 0);
    assert.equal(item.period, DAILY_CHALLENGES.some((c) => c.id === item.challenge) ? "2026-10-01" : "2026-W40");
  }
  // Survie : secondes entières ; « meilleure vie » pour lifeSurvival.
  const survival = items.find((i) => i.challenge === "survivalTotal" || i.challenge === "lifeSurvival");
  if (survival) assert.equal(survival.value, 95);
});

test("état des défis : progression plafonnée, réussite, échéances", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  const [first] = dailyChallenges("2026-10-01");
  const week = weeklyChallenge("2026-W40");
  const res = toChallengesResponse([
    { period: "2026-10-01", challenge: first.id, progress: first.target + 5, completed_at: "2026-10-01T11:00:00Z" },
    { period: "2026-W40", challenge: week.id, progress: 3, completed_at: null },
    { period: "2026-09-30", challenge: first.id, progress: 1, completed_at: null },
  ], now);
  assert.equal(res.day.key, "2026-10-01");
  assert.equal(res.day.resetsAt, "2026-10-01T22:00:00.000Z");
  assert.equal(res.day.challenges[0].progress, first.target);
  assert.equal(res.day.challenges[0].completed, true);
  assert.equal(res.day.challenges[1].progress, 0);
  assert.equal(res.week.challenge.progress, 3);
  assert.equal(res.week.challenge.completed, false);
});

let clock: FakeClock;
let restoreRandom: () => void;
let calls: Array<{ owner: challenges.ChallengeOwner; life: LifeChallengeStats }>;
let reply: challenges.CompletedChallenge[];
const saved: Record<string, any> = {};

beforeEach(() => {
  clock = new FakeClock();
  restoreRandom = seedRandom(3);
  calls = [];
  reply = [];
  saved.advance = challenges.advanceChallenges;
  saved.recordLife = telemetry.recordLife;
  saved.recordMatch = matches.recordMatch;
  saved.creditWallet = wallet.creditWallet;
  saved.creditGuestWallet = wallet.creditGuestWallet;
  (challenges as any).advanceChallenges = async (owner: challenges.ChallengeOwner, l: LifeChallengeStats) => {
    calls.push({ owner, life: l });
    return reply;
  };
  (telemetry as any).recordLife = () => {};
  (matches as any).recordMatch = async () => {};
  (wallet as any).creditWallet = async () => {};
  (wallet as any).creditGuestWallet = async () => {};
});
afterEach(() => {
  clock.restore();
  restoreRandom();
  (challenges as any).advanceChallenges = saved.advance;
  (telemetry as any).recordLife = saved.recordLife;
  (matches as any).recordMatch = saved.recordMatch;
  (wallet as any).creditWallet = saved.creditWallet;
  (wallet as any).creditGuestWallet = saved.creditGuestWallet;
});

const flush = () => new Promise((r) => setImmediate(r));

test("fin de vie publique : la vie est envoyée aux défis ; récompense = XP et notification", async () => {
  const r = new TestRoom(clock);
  const a = r.join("a", { userId: "u1", xp: 50 });
  const sent: any[] = [];
  (r.room as any).clients.push({ sessionId: "a", send: (type: string, msg: any) => sent.push({ type, msg }) });
  a.lifeThrows = 12;
  a.cratesDestroyed = 3;
  a.maxBladeCount = 41;
  clock.advance(90_000);
  reply = [{ challenge: "throws", reward: 30 }];
  r.room.killPlayer(a, null, "wall");
  await flush();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].owner, { id: "u1", kind: "user" });
  assert.equal(calls[0].life.throws, 12);
  assert.equal(calls[0].life.crates, 3);
  assert.equal(calls[0].life.peakBlades, 41);
  assert.equal(Math.round(calls[0].life.survivalSeconds), 90);
  // 50 d'XP de départ + 30 de récompense (le score de la vie est nul).
  assert.equal(a.xp, 80);
  assert.equal(a.level, 2);
  assert.deepEqual(sent, [{ type: "challengeDone", msg: { challenges: [{ challenge: "throws", reward: 30 }] } }]);
});

test("éliminations d'un plus gros et du leader comptées pour la vie", async () => {
  const r = new TestRoom(clock);
  const killer = r.join("k", { guestId: "g1" });
  const victim = r.join("v");
  // Rapport de force au début de l'échange : la victime en avait plus.
  victim.bladeCount = 12;
  killer.bladeCount = 5;
  r.room.killPlayer(victim, killer, "blades");
  assert.equal(killer.kills, 1);
  assert.equal(killer.lifeBiggerKills, 1);
  r.room.killPlayer(killer, null, "wall");
  await flush();
  const mine = calls.find((c) => c.owner.id === "g1")!;
  assert.deepEqual(mine.owner, { id: "g1", kind: "guest" });
  assert.equal(mine.life.biggerKills, 1);
});

test("room privée, bot ou anonyme : aucun défi", async () => {
  const priv = new TestRoom(clock, { code: "ABCDE" });
  const f = priv.join("f", { userId: "u2" });
  priv.room.killPlayer(f, null, "wall");
  const pub = new TestRoom(clock);
  const anon = pub.join("anon");
  pub.room.killPlayer(anon, null, "wall");
  const bot = (pub.room as any).bots.spawnBot(pub.state, { x: 0, y: 0 });
  bot.userId = null;
  pub.room.killPlayer(bot, null, "wall");
  await flush();
  assert.equal(calls.length, 0);
});
