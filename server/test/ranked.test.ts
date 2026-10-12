// Mode classé (retours du 2026-10-12) : rangs et points de rang (fonctions
// partagées), mode « ranked » (file publique, règles des manches, sans
// améliorations), résultat de fin de manche écrit et envoyé aux comptes,
// abandon pénalisé, rien en salon privé ni pour un invité.
//
// Le test d'arrêt du serveur (restartDeadline) reste le dernier du fichier :
// l'état du module shutdown ne revient pas en arrière (node --test isole
// chaque fichier).
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  GAME_MODES,
  MASTER_PR,
  MatchPhase,
  RANKED_DELTA_MAX,
  RANKED_DELTA_MIN,
  RANKED_LEAVE_PR,
  RANKED_MIN_PRESENCE_MS,
  RANKED_PODIUM_PR,
  RANKED_SEASON_CARRY,
  ROUND_DURATION_MS,
  ROUND_INTERMISSION_MS,
  ROUND_PODIUM_BONUS,
  applyDelta,
  expectedScore,
  isRankedMode,
  modeAllowsUpgrades,
  modeHasAdaptiveArena,
  modeHasMapEvents,
  modeRespawns,
  modeShrinks,
  rankOf,
  rankedDelta,
  roundPresence,
  sameRank,
  seasonAt,
  seasonStartPr,
} from "@bladeio/shared";
import { CloseCode, LocalDriver, RegisteredHandler, initializeRoomCache } from "@colyseus/core";
import * as matches from "../src/auth/matches";
import * as wallet from "../src/auth/wallet";
import * as telemetry from "../src/telemetry";
import * as ranked from "../src/ranked";
import * as supabase from "../src/auth/supabase";
import { beforeShutdown } from "../src/shutdown";
import { ModeHost, createMode } from "../src/modes";
import { RoundsMode } from "../src/modes/rounds";
import { ArenaRoom } from "../src/rooms/ArenaRoom";
import { FakeClock, seedRandom } from "./helpers";
import { TestRoom } from "./testRoom";

// Fonctions d'origine du module de base, avant leur remplacement.
const realRanked = { ...ranked };
const realAdmin = supabase.getAdminClient;

let clock: FakeClock;
let restoreRandom: () => void;
let credits: Array<[string, string, number]>;
// PR en base de chaque compte (lus par getRankedStatus), écritures reçues.
let stored: Map<string, number>;
let writes: Array<[string, number]>;
let statusReads: string[];
let failReads: boolean;

beforeEach(() => {
  clock = new FakeClock();
  restoreRandom = seedRandom(13);
  credits = [];
  stored = new Map();
  writes = [];
  statusReads = [];
  failReads = false;
  (telemetry as any).recordLife = () => {};
  (matches as any).recordMatch = async () => {};
  (wallet as any).creditWallet = async (id: string, n: number) => { credits.push(["user", id, n]); };
  (wallet as any).creditGuestWallet = async (id: string, n: number) => { credits.push(["guest", id, n]); };
  // Base simulée : mêmes règles que la migration 0013 (plancher à 0).
  (ranked as any).getRankedStatus = async (userId: string) => {
    statusReads.push(userId);
    if (failReads) return null;
    const pr = stored.get(userId) ?? 0;
    return { season: { number: 1, endsAt: "" }, pr, games: 0, best: pr, rank: null };
  };
  (ranked as any).applyRankedDelta = async (userId: string, delta: number) => {
    writes.push([userId, delta]);
    const before = stored.get(userId) ?? 0;
    const after = applyDelta(before, delta);
    stored.set(userId, after);
    return { before, after, games: 1, best: after, season: 1 };
  };
});
afterEach(() => {
  clock.restore();
  restoreRandom();
  (supabase as any).getAdminClient = realAdmin;
});

// Laisse finir les lectures et écritures simulées (promesses).
const settle = () => new Promise((resolve) => setImmediate(resolve));

// Room classée dont les évènements ciblés gardent leur destinataire.
function rankedRoom(options: { code?: string } = {}): { r: TestRoom; sent: Array<{ type: string; message: any; to: string[] }> } {
  const r = new TestRoom(clock, { mode: "ranked", ...options });
  const sent: Array<{ type: string; message: any; to: string[] }> = [];
  r.room.sendScoped = (type: string, message: any, scope: { to?: string[] }) => {
    sent.push({ type, message, to: (scope.to ?? []).filter(Boolean) as string[] });
  };
  return { r, sent };
}

function results(sent: Array<{ type: string; message: any; to: string[] }>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const s of sent) if (s.type === "rankedResult") for (const id of s.to) out[id] = s.message;
  return out;
}

// Avance l'horloge jusqu'à `ms` avant l'échéance de la phase, puis un tick.
function jumpTo(r: TestRoom, msBeforeEnd: number): void {
  clock.now = r.state.phaseEndsAt - msBeforeEnd;
  r.tick();
}

test("rangs : six rangs, trois divisions de 100 PR, Maître sans plafond", () => {
  assert.deepEqual(rankOf(0), { tier: "bronze", tierIndex: 0, division: 3, floor: 0, next: 100, progress: 0 });
  assert.equal(rankOf(99).division, 3);
  assert.equal(rankOf(100).division, 2);
  assert.equal(rankOf(250).division, 1);
  assert.equal(rankOf(250).progress, 0.5);
  assert.equal(rankOf(300).tier, "silver");
  assert.equal(rankOf(300).division, 3);
  assert.equal(rankOf(899).tier, "gold");
  assert.equal(rankOf(899).division, 1);
  assert.equal(rankOf(1200).tier, "diamond");
  assert.equal(rankOf(MASTER_PR - 1).tier, "diamond");
  assert.equal(MASTER_PR, 1500);
  assert.deepEqual(rankOf(MASTER_PR), { tier: "master", tierIndex: 5, division: 0, floor: MASTER_PR, next: null, progress: 1 });
  assert.equal(rankOf(9000).tier, "master");
  // Entrées hors domaine : Bronze III.
  assert.equal(rankOf(-5).floor, 0);
  assert.equal(rankOf(Number.NaN).floor, 0);
  assert.ok(sameRank(rankOf(310), rankOf(399)));
  assert.ok(!sameRank(rankOf(399), rankOf(400)));
});

test("points de rang : l'attente monte avec le rang, le gain suit le score, borné", () => {
  // Plus on est haut, plus il faut marquer.
  for (let pr = 0; pr < 3000; pr += 100) assert.ok(expectedScore(pr + 100) > expectedScore(pr));
  const e = expectedScore(600);
  // Au score attendu, hors podium : rien ne bouge.
  assert.equal(rankedDelta({ pr: 600, score: e, rank: 5 }).delta, 0);
  // Le même score rapporte moins haut dans le classement.
  const low = rankedDelta({ pr: 100, score: 300, rank: 5 }).delta;
  const high = rankedDelta({ pr: 1200, score: 300, rank: 5 }).delta;
  assert.ok(low > 0 && high < 0, `${low} / ${high}`);
  // Manche à zéro point : la pire défaite ; très grosse manche : plafonnée.
  assert.equal(rankedDelta({ pr: 600, score: 0, rank: 9 }).delta, RANKED_DELTA_MIN);
  assert.equal(rankedDelta({ pr: 0, score: 10_000, rank: 0 }).delta, RANKED_DELTA_MAX);
  // Podium : prime en plus du score.
  const base = rankedDelta({ pr: 600, score: e, rank: 3 });
  assert.equal(base.podium, 0);
  for (let i = 0; i < RANKED_PODIUM_PR.length; i++) {
    const d = rankedDelta({ pr: 600, score: e, rank: i });
    assert.equal(d.podium, RANKED_PODIUM_PR[i]);
    assert.equal(d.delta, RANKED_PODIUM_PR[i]);
  }
  // Arrivé à mi-manche : attente de moitié.
  const half = rankedDelta({ pr: 600, score: e / 2, rank: 5, presence: 0.5 });
  assert.equal(half.delta, 0);
  assert.equal(half.expected, Math.round(e / 2));
  assert.equal(roundPresence(ROUND_DURATION_MS / 2), 0.5);
  assert.equal(roundPresence(ROUND_DURATION_MS * 2), 1);
  // Jamais sous 0, et la saison suivante repart d'une part des PR.
  assert.equal(applyDelta(12, -30), 0);
  assert.equal(applyDelta(512, 23), 535);
  assert.equal(seasonStartPr(1641), Math.floor(1641 * RANKED_SEASON_CARRY));
  assert.equal(seasonStartPr(-3), 0);
});

test("registre : classé en partie rapide seulement, manches, sans améliorations", () => {
  const info = GAME_MODES.find((m) => m.id === "ranked")!;
  assert.ok(info, "mode ranked absent du registre");
  assert.equal(info.quickPlay, true);
  assert.equal(info.privateRoom, false);
  assert.equal(modeAllowsUpgrades("ranked"), false);
  assert.equal(modeShrinks("ranked"), true);
  assert.equal(modeRespawns("ranked"), true);
  assert.equal(modeHasMapEvents("ranked"), true);
  assert.equal(modeHasAdaptiveArena("ranked"), true);
  assert.ok(isRankedMode("ranked") && !isRankedMode("rounds"));
  const mode = createMode("ranked", {} as ModeHost);
  assert.equal(mode.id, "ranked");
  assert.ok(mode instanceof RoundsMode);
});

test("manche classée : 5 minutes, podium et trophées comme une manche, puis la suivante", () => {
  const { r } = rankedRoom();
  assert.equal(r.state.mode, "ranked");
  assert.equal(r.state.phaseEndsAt, clock.now + ROUND_DURATION_MS);
  const a = r.join("a", { userId: "u-a" });
  a.bonusScore = 200;
  r.tick();
  credits.length = 0;
  jumpTo(r, 0);
  assert.equal(r.state.phase, MatchPhase.Over);
  const [end] = r.eventsOf("matchEnd");
  assert.equal(end.nextAt, clock.now + ROUND_INTERMISSION_MS);
  assert.equal(end.standings[0].bonus, ROUND_PODIUM_BONUS[0]);
  assert.ok(credits.some(([kind, id, n]) => kind === "user" && id === "u-a" && n === ROUND_PODIUM_BONUS[0]));
  clock.now = end.nextAt;
  r.tick();
  assert.equal(r.state.phase, MatchPhase.Playing);
  assert.equal(r.state.phaseEndsAt, clock.now + ROUND_DURATION_MS);
});

test("fin de manche : PR écrits puis envoyés aux comptes, invités et retardataires prévenus", async () => {
  const { r, sent } = rankedRoom();
  stored.set("u-a", 640);
  stored.set("u-c", 900);
  const a = r.join("a", { userId: "u-a" });
  const b = r.join("b", { guestId: "g-b" });
  const anon = r.join("anon");
  await settle();
  assert.deepEqual(statusReads, ["u-a"]);
  a.bonusScore = 400;
  b.bonusScore = 150;
  anon.bonusScore = 20;
  r.tick();
  // c arrive dans la dernière minute : sa manche ne compte pas.
  jumpTo(r, RANKED_MIN_PRESENCE_MS - 1000);
  const c = r.join("c", { userId: "u-c" });
  c.bonusScore = 900;
  await settle();
  jumpTo(r, 0);
  const [end] = r.eventsOf("matchEnd");
  const rankA = end.standings.findIndex((s: any) => s.id === "a");
  const scoreA = end.standings[rankA].score;
  const expectedA = rankedDelta({ pr: 640, score: scoreA, rank: rankA });
  // Écrit pour le compte présent toute la manche, et pour lui seul.
  await settle();
  assert.deepEqual(writes, [["u-a", expectedA.delta]]);
  const res = results(sent);
  assert.deepEqual(res.a, {
    status: "scored",
    before: 640,
    after: applyDelta(640, expectedA.delta),
    score: scoreA,
    expected: expectedA.expected,
    podium: expectedA.podium,
    season: 1,
    tick: res.a.tick,
  });
  assert.equal(res.b.status, "guest");
  assert.equal(res.anon.status, "guest");
  assert.equal(res.c.status, "late");
  // Message ciblé : chaque résultat ne part qu'à son joueur.
  assert.ok(sent.filter((s) => s.type === "rankedResult").every((s) => s.to.length === 1));

  // Manche suivante : elle part des PR écrits, tout le monde présent dès le
  // début (c compris).
  clock.now = end.nextAt;
  r.tick();
  sent.length = 0;
  writes.length = 0;
  jumpTo(r, 0);
  await settle();
  assert.deepEqual(writes.map(([id]) => id).sort(), ["u-a", "u-c"]);
  assert.equal(results(sent).a.before, applyDelta(640, expectedA.delta));
  assert.equal(results(sent).c.before, 900);
});

test("arrivé en cours de manche : attente au prorata du temps joué", async () => {
  const { r, sent } = rankedRoom();
  stored.set("u-a", 600);
  jumpTo(r, ROUND_DURATION_MS / 2);
  const a = r.join("a", { userId: "u-a" });
  await settle();
  a.bonusScore = 100;
  r.tick();
  jumpTo(r, 0);
  await settle();
  const [end] = r.eventsOf("matchEnd");
  const row = end.standings.find((s: any) => s.id === "a");
  const d = rankedDelta({ pr: 600, score: row.score, rank: 0, presence: 0.5 });
  assert.equal(results(sent).a.expected, d.expected);
  assert.deepEqual(writes, [["u-a", d.delta]]);
});

test("base injoignable : manche jouée, rien d'écrit, le joueur le sait", async () => {
  failReads = true;
  const { r, sent } = rankedRoom();
  r.join("a", { userId: "u-a" });
  await settle();
  jumpTo(r, 0);
  await settle();
  assert.deepEqual(writes, []);
  assert.equal(results(sent).a.status, "unavailable");
  // Écriture refusée (migration absente) : indisponible aussi.
  failReads = false;
  (ranked as any).applyRankedDelta = async (userId: string, delta: number) => {
    writes.push([userId, delta]);
    return null;
  };
  const other = rankedRoom();
  other.r.join("b", { userId: "u-b" });
  await settle();
  jumpTo(other.r, 0);
  await settle();
  assert.equal(writes.length, 1);
  assert.equal(results(other.sent).b.status, "unavailable");
});

test("abandon : quitter après une minute de manche coûte la pire défaite", async () => {
  const { r } = rankedRoom();
  r.join("early", { userId: "u-early" });
  r.join("quitter", { userId: "u-quit" });
  r.join("dropped", { userId: "u-drop" });
  r.join("guest", { guestId: "g-1" });
  await settle();
  // Moins d'une minute : on peut encore partir sans pénalité.
  clock.advance(RANKED_MIN_PRESENCE_MS - 5000);
  await r.room.onLeave({ sessionId: "early" }, CloseCode.CONSENTED);
  assert.deepEqual(writes, []);
  clock.advance(10_000);
  await r.room.onLeave({ sessionId: "quitter" }, CloseCode.CONSENTED);
  await r.room.onLeave({ sessionId: "guest" }, CloseCode.CONSENTED);
  // Connexion perdue sans retour (onglet fermé) : même chose.
  r.room.allowReconnection = async () => { throw new Error("timeout"); };
  await r.room.onLeave({ sessionId: "dropped" }, 1006);
  await settle();
  assert.deepEqual(writes, [["u-quit", RANKED_LEAVE_PR], ["u-drop", RANKED_LEAVE_PR]]);
  assert.equal(r.state.players.size, 0);

  // Pendant l'entracte, la manche est finie : partir ne coûte rien.
  const next = rankedRoom();
  next.r.join("a", { userId: "u-a" });
  await settle();
  jumpTo(next.r, 0);
  await settle();
  writes.length = 0;
  await next.r.room.onLeave({ sessionId: "a" }, CloseCode.CONSENTED);
  await settle();
  assert.deepEqual(writes, []);
});

test("salon privé : ni lecture, ni écriture, ni résultat", async () => {
  const { r, sent } = rankedRoom({ code: "ABCDE" });
  r.join("a", { userId: "u-a" });
  await settle();
  clock.advance(2 * 60_000);
  await r.room.onLeave({ sessionId: "a" }, CloseCode.CONSENTED);
  r.join("b", { userId: "u-b" });
  jumpTo(r, 0);
  await settle();
  assert.deepEqual(statusReads, []);
  assert.deepEqual(writes, []);
  assert.deepEqual(sent.filter((s) => s.type === "rankedResult"), []);
});

test("base : saison du jour, gain appliqué, classement masqué et borné ; migration absente sans erreur", async () => {
  const calls: Array<[string, any]> = [];
  let missing = false;
  const fail = { data: null, error: { message: "function public.ranked_status(...) does not exist" } };
  (supabase as any).getAdminClient = () => ({
    rpc: async (name: string, args: any) => {
      calls.push([name, args]);
      if (missing) return fail;
      if (name === "ranked_status") return { data: { pr: 412, games: 7, best: 455, rank: 3 }, error: null };
      if (name === "apply_ranked_delta") return { data: { before: 412, after: 382, games: 8, best: 455 }, error: null };
      return { data: [{ user_id: "u1", username: "Alpha", pr: 900, games: 30 }, { user_id: "u2", username: "admin", pr: 800, games: 2 }], error: null };
    },
  });
  const now = new Date("2026-10-12T12:00:00Z");
  const season = seasonAt(now);
  assert.deepEqual(await realRanked.getRankedStatus("u9", now), {
    season: { number: season.number, endsAt: season.endsAt.toISOString() },
    pr: 412, games: 7, best: 455, rank: 3,
  });
  assert.deepEqual(calls[0], ["ranked_status", { p_user: "u9", p_season: season.number, p_carry: RANKED_SEASON_CARRY }]);
  assert.deepEqual(await realRanked.applyRankedDelta("u9", RANKED_LEAVE_PR, now), { before: 412, after: 382, games: 8, best: 455, season: season.number });
  assert.deepEqual(calls[1], ["apply_ranked_delta", { p_user: "u9", p_season: season.number, p_delta: RANKED_LEAVE_PR, p_carry: RANKED_SEASON_CARRY }]);
  const board = await realRanked.getRankedLeaderboard(5000, "u9", now);
  assert.equal(calls[2][1].p_limit, 50);
  // Pseudo réservé masqué ; le rang du joueur connecté vient de son statut.
  assert.deepEqual(board?.entries.map((e) => [e.username, e.pr]), [["Alpha", 900], ["***", 800]]);
  assert.deepEqual(board?.me, { rank: 3, pr: 412 });
  // Sans la migration : null partout, aucune exception, un avertissement
  // par minute au plus.
  missing = true;
  const warned: unknown[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => { warned.push(args); };
  try {
    assert.equal(await realRanked.getRankedStatus("u9", now), null);
    assert.equal(await realRanked.applyRankedDelta("u9", 10, now), null);
    assert.equal(await realRanked.getRankedLeaderboard(10, null, now), null);
  } finally {
    console.warn = realWarn;
  }
  assert.ok(warned.length <= 1, `${warned.length} avertissements`);
  // Sans base du tout : classement vide, statut inconnu.
  (supabase as any).getAdminClient = () => null;
  assert.deepEqual((await realRanked.getRankedLeaderboard(10, null, now))?.entries, []);
  assert.equal(await realRanked.getRankedStatus("u9", now), null);
});

test("matchmaking : une file publique classée à part", async () => {
  const handler = new RegisteredHandler(ArenaRoom, {}).filterBy(["code", "mode"]);
  const driver = new LocalDriver();
  const register = (roomId: string, r: TestRoom) =>
    driver.persist({ ...initializeRoomCache({ name: "arena", roomId }), metadata: r.room.metadata }, true);
  const find = (options: Record<string, unknown>) =>
    driver.findOne({ locked: false, name: "arena", private: false, ...handler.getFilterOptions(options) });
  register("rounds", new TestRoom(clock, { code: "", mode: "rounds" }));
  const rk = rankedRoom({ code: "" });
  assert.equal(rk.r.room.metadata.mode, "ranked");
  register("ranked", rk.r);
  assert.equal((await find({ code: "", mode: "ranked" }))?.roomId, "ranked");
  assert.equal((await find({ code: "", mode: "rounds" }))?.roomId, "rounds");
  assert.equal(await find({ code: "", mode: "ffa" }), undefined);
});

test("arrêt du serveur : partir pendant le préavis ne coûte rien", async () => {
  const { r } = rankedRoom();
  r.join("a", { userId: "u-a" });
  await settle();
  clock.advance(2 * 60_000);
  // Préavis nul (développement) : beforeShutdown rend la main tout de suite.
  delete process.env.RESTART_NOTICE_MS;
  await beforeShutdown();
  await r.room.onLeave({ sessionId: "a" }, CloseCode.CONSENTED);
  await settle();
  assert.deepEqual(writes, []);
});
