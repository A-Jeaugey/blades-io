// Classements temporaires et saisons (tâche 5.4).
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { SEASON_REWARDS, periodBounds, seasonAt, seasonInfo } from "@bladeio/shared";
import * as supabase from "../src/auth/supabase";
import { closeFinishedSeasons, getLeaderboard } from "../src/seasons";

const iso = (d: Date) => d.toISOString();

test("saisons de six semaines, du lundi minuit (Paris) au lundi minuit", () => {
  const s1 = seasonAt(new Date("2026-10-01T19:00:00Z"));
  assert.equal(s1.number, 1);
  assert.equal(iso(s1.startsAt), "2026-09-27T22:00:00.000Z");
  // Fin en heure d'hiver : minuit de Paris = 23 h UTC.
  assert.equal(iso(s1.endsAt), "2026-11-08T23:00:00.000Z");
  assert.equal(seasonAt(new Date("2026-11-08T22:59:59Z")).number, 1);
  assert.equal(seasonAt(new Date("2026-11-08T23:00:00Z")).number, 2);
  assert.equal(seasonAt(new Date("2026-09-20T12:00:00Z")).number, 0);
  assert.equal(iso(seasonInfo(2).startsAt), iso(s1.endsAt));
});

test("bornes des classements : jour, semaine ISO, saison, tous les temps", () => {
  const now = new Date("2026-10-01T19:00:00Z");
  const day = periodBounds("day", now)!;
  assert.deepEqual([iso(day.since), iso(day.until)], ["2026-09-30T22:00:00.000Z", "2026-10-01T22:00:00.000Z"]);
  const week = periodBounds("week", now)!;
  assert.deepEqual([iso(week.since), iso(week.until)], ["2026-09-27T22:00:00.000Z", "2026-10-04T22:00:00.000Z"]);
  // Semaine du retour à l'heure d'hiver : 7 jours et une heure.
  const dst = periodBounds("week", new Date("2026-10-25T12:00:00Z"))!;
  assert.deepEqual([iso(dst.since), iso(dst.until)], ["2026-10-18T22:00:00.000Z", "2026-10-25T23:00:00.000Z"]);
  assert.equal(periodBounds("all", now), null);
  const season = periodBounds("season", now)!;
  assert.equal(iso(season.since), "2026-09-27T22:00:00.000Z");
});

// Faux client Supabase : enregistre les appels de fonctions SQL.
let rpcCalls: Array<{ fn: string; args: any }>;
let rpcReplies: Record<string, any>;
const saved: Record<string, any> = {};
beforeEach(() => {
  rpcCalls = [];
  rpcReplies = {};
  saved.getAdminClient = supabase.getAdminClient;
  (supabase as any).getAdminClient = () => ({
    rpc: async (fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      return { data: rpcReplies[fn] ?? null, error: null };
    },
  });
});
afterEach(() => {
  (supabase as any).getAdminClient = saved.getAdminClient;
});

test("clôture : les deux saisons précédentes, bornes et récompenses ; rien pendant la saison 1", async () => {
  await closeFinishedSeasons(new Date("2026-10-01T19:00:00Z"));
  assert.equal(rpcCalls.length, 0);
  await closeFinishedSeasons(new Date("2027-01-10T12:00:00Z"));
  // Saison 3 en cours : les saisons 1 et 2.
  assert.deepEqual(rpcCalls.map((c) => [c.fn, c.args.p_season]), [["close_season", 1], ["close_season", 2]]);
  const s2 = rpcCalls[1].args;
  assert.equal(s2.p_start, "2026-11-08T23:00:00.000Z");
  assert.equal(s2.p_end, "2026-12-20T23:00:00.000Z");
  assert.deepEqual(s2.p_rewards, SEASON_REWARDS);
  // Juste après minuit : la saison qui finit attend deux minutes.
  rpcCalls = [];
  await closeFinishedSeasons(new Date("2026-11-08T23:01:00Z"));
  assert.equal(rpcCalls.length, 0);
  await closeFinishedSeasons(new Date("2026-11-08T23:02:00Z"));
  assert.deepEqual(rpcCalls.map((c) => c.args.p_season), [1]);
});

test("classement de la semaine : bornes envoyées à la base, rang du joueur connecté", async () => {
  rpcReplies.leaderboard_since = [{ user_id: "u2", username: "Bravo", score: 450, kills: 5, max_blades: 60, survival_seconds: 400, games_played: 3 }];
  rpcReplies.player_rank_since = [{ rank: 4, score: 120 }];
  const res = await getLeaderboard("week", 10, "u1", new Date("2026-10-01T19:00:00Z"));
  assert.equal(res.period, "week");
  assert.equal(res.entries[0].username, "Bravo");
  assert.deepEqual(res.me, { rank: 4, score: 120 });
  assert.deepEqual(res.season, { number: 1, endsAt: "2026-11-08T23:00:00.000Z" });
  const call = rpcCalls.find((c) => c.fn === "leaderboard_since")!;
  assert.deepEqual(call.args, { p_since: "2026-09-27T22:00:00.000Z", p_until: "2026-10-04T22:00:00.000Z", p_limit: 10 });
  // Invité : pas de rang demandé.
  rpcCalls = [];
  const anon = await getLeaderboard("day", 5, null, new Date("2026-10-01T19:00:00Z"));
  assert.equal(anon.me, null);
  assert.deepEqual(rpcCalls.map((c) => c.fn), ["leaderboard_since"]);
});
