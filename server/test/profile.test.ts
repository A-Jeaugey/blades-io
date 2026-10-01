import { test } from "node:test";
import assert from "node:assert/strict";
import { PROFILE_RECENT_GAMES, countsAsGame } from "@bladeio/shared";
import { MatchRow, PlayerStatsRow, toProfileStats } from "../src/auth/profileStats";

const row: PlayerStatsRow = {
  games: 4,
  kills: 9,
  best_score: 320,
  best_kills: 5,
  best_blades: 61,
  survival_seconds: 1003,
  best_survival_seconds: 410,
  crates: 12,
  powerups: 7,
  first_played_at: "2026-09-20T10:00:00Z",
};

const match = (i: number): MatchRow => ({
  score: 100 + i,
  kills: i % 3,
  max_blades: 20 + i,
  survival_seconds: 60 + i,
  created_at: `2026-10-01T${String(10 + i).padStart(2, "0")}:00:00Z`,
});

test("profil : cumuls, survie moyenne arrondie, rang", () => {
  const s = toProfileStats(row, [match(1), match(0)], 6);
  assert.equal(s.games, 4);
  assert.equal(s.kills, 9);
  assert.equal(s.bestScore, 320);
  assert.equal(s.bestKills, 5);
  assert.equal(s.bestBlades, 61);
  // 1003 s sur 4 parties.
  assert.equal(s.avgSurvivalSeconds, 251);
  assert.equal(s.bestSurvivalSeconds, 410);
  assert.equal(s.crates, 12);
  assert.equal(s.powerups, 7);
  assert.equal(s.firstPlayedAt, "2026-09-20T10:00:00Z");
  // Six joueurs au meilleur score supérieur : septième.
  assert.equal(s.rank, 7);
  assert.deepEqual(s.recent[0], { score: 101, kills: 1, maxBlades: 21, survivalSeconds: 61, at: "2026-10-01T11:00:00Z" });
});

test("profil : XP du niveau transmise telle quelle, inconnue sinon", () => {
  assert.equal(toProfileStats(row, [], 6, 900).xp, 900);
  assert.equal(toProfileStats(row, [], 6).xp, null);
});

test("profil : compte sans partie publique", () => {
  const s = toProfileStats(null, [], null);
  assert.equal(s.games, 0);
  assert.equal(s.avgSurvivalSeconds, 0);
  assert.equal(s.rank, null);
  assert.equal(s.firstPlayedAt, null);
  assert.deepEqual(s.recent, []);
});

test("profil : rang inconnu si le classement ne répond pas, dernières parties plafonnées", () => {
  const many = Array.from({ length: PROFILE_RECENT_GAMES + 5 }, (_, i) => match(i));
  const s = toProfileStats(row, many, null);
  assert.equal(s.rank, null);
  assert.equal(s.recent.length, PROFILE_RECENT_GAMES);
});

test("profil : une vie sans rien fait ne compte pas comme partie", () => {
  assert.equal(countsAsGame(0, 0, 3), false);
  assert.equal(countsAsGame(0, 0, 4), true);
  assert.equal(countsAsGame(1, 0, 0), true);
  assert.equal(countsAsGame(0, 1, 0), true);
});
