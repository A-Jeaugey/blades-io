// Modes équipe (tâche 7.2) : répartition, alliés intouchables, Team
// Deathmatch, dernière équipe en vie, capture du drapeau, bots.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { Decoder } from "@colyseus/schema";
import {
  BUSHES,
  BladeRarity,
  CTF_CAPTURE_POINTS,
  CTF_CAPTURE_TARGET,
  CTF_DURATION_MS,
  CTF_FLAG_RETURN_MS,
  CTF_RETURN_POINTS,
  INITIAL_BLADE_COUNT,
  LTS_DURATION_MS,
  MAP_RADIUS,
  MatchPhase,
  ROUND_FINAL_RADIUS,
  ROUND_SHRINK_MS,
  TDM_DURATION_MS,
  TDM_KILL_TARGET,
  TEAM_NONE,
  TEAM_SPAWN_RADIUS,
  teamBase,
} from "@bladeio/shared";
import * as matches from "../src/auth/matches";
import * as wallet from "../src/auth/wallet";
import * as telemetry from "../src/telemetry";
import { ArenaState } from "../src/state/ArenaState";
import { Blade } from "../src/state/Blade";
import { Player } from "../src/state/Player";
import { resolveCollisions } from "../src/systems/collisions";
import { OrbitPositionCache } from "../src/systems/orbitPositions";
import { processThrows, resolveProjectileCollisions } from "../src/systems/throws";
import { FakeClock, addPlayer, giveBlade, ownedBlades, seedRandom } from "./helpers";
import { TestRoom } from "./testRoom";

let clock: FakeClock;
let restoreRandom: () => void;

beforeEach(() => {
  clock = new FakeClock();
  restoreRandom = seedRandom(31);
  (telemetry as any).recordLife = () => {};
  (matches as any).recordMatch = async () => {};
  (wallet as any).creditWallet = async () => {};
  (wallet as any).creditGuestWallet = async () => {};
});
afterEach(() => {
  clock.restore();
  restoreRandom();
});

function place(p: Player, x: number, y: number): void {
  p.x = x;
  p.y = y;
}

// État tel que le reçoit ce client (vue filtrée), décodé.
function received(r: TestRoom, sessionId: string): ArenaState {
  const client = { sessionId, view: (r.room as any).interest.viewers.get(sessionId).view };
  const bytes: Buffer = r.room._serializer.getFullState(client);
  const state = new ArenaState();
  new Decoder(state).decode(bytes, { offset: 1 });
  return state;
}

// Rappels de collision réduits à ce que ces tests regardent.
function collisionLog(state: ArenaState) {
  const log = {
    clashes: 0,
    kills: [] as Array<[string, string | null]>,
    onBladeDestroyed: (b: Blade) => { state.blades.delete(b.id); },
    onPlayerKilled: (victim: Player, killer: Player | null) => {
      log.kills.push([victim.id, killer?.id ?? null]);
      victim.alive = false;
    },
    onCrateHit: () => {},
    onCrateDestroyed: () => {},
    onClash: () => { log.clashes++; },
    onBladeThrown: () => {},
    onProjectileImpact: () => {},
  };
  return log;
}

test("équipes : chaque arrivant rejoint la moins nombreuse, à égalité la moins armée, et apparaît dans son camp", () => {
  const r = new TestRoom(clock, { mode: "tdm" });
  const players = ["a", "b", "c", "d"].map((id) => r.join(id));
  assert.deepEqual(players.map((p) => p.team), [1, 2, 1, 2]);
  for (let i = 0; i < 5; i++) giveBlade(r.state, players[0]);
  assert.equal(r.join("e").team, 2);
  assert.equal(r.join("f").team, 1);
  for (const p of players) {
    const base = teamBase(p.team);
    assert.ok(Math.hypot(p.x - base.x, p.y - base.y) <= TEAM_SPAWN_RADIUS + 1e-6, `${p.id} à ${p.x.toFixed(1)}, ${p.y.toFixed(1)}`);
  }
  // Hors modes équipe : personne n'a d'équipe.
  assert.equal(new TestRoom(clock).join("x").team, TEAM_NONE);
});

test("alliés : ni clash, ni lame qui tue, ni corps à corps entre eux ; adversaires, si", () => {
  const state = new ArenaState();
  const cache = new OrbitPositionCache();
  // Lames face à face, comme un duel.
  const a = addPlayer(state, { x: 0, y: 0, blades: 1 });
  const b = addPlayer(state, { x: 4, y: 0, blades: 1 });
  cache.set(ownedBlades(state, a)[0].id, 1.8, 0);
  cache.set(ownedBlades(state, b)[0].id, 2.2, 0);
  a.team = 1;
  b.team = 1;
  const log = collisionLog(state);
  resolveCollisions(state, cache, log, new Map());
  assert.equal(log.clashes, 0);
  b.team = 2;
  resolveCollisions(state, cache, log, new Map());
  assert.equal(log.clashes, 1);

  // Une lame contre le corps d'un allié, puis d'un adversaire.
  const s2 = new ArenaState();
  const c2 = new OrbitPositionCache();
  const owner = addPlayer(s2, { x: 0, y: 0, blades: 1 });
  const body = addPlayer(s2, { x: 2.5, y: 0 });
  c2.set(ownedBlades(s2, owner)[0].id, 1.8, 0);
  owner.team = 2;
  body.team = 2;
  const log2 = collisionLog(s2);
  resolveCollisions(s2, c2, log2, new Map());
  assert.deepEqual(log2.kills, []);
  body.team = 1;
  resolveCollisions(s2, c2, log2, new Map());
  assert.deepEqual(log2.kills, [[body.id, owner.id]]);

  // Deux alliés sans lame au contact : personne ne meurt.
  const s3 = new ArenaState();
  const x = addPlayer(s3, { x: 0, y: 0 });
  const y = addPlayer(s3, { x: 0.8, y: 0 });
  x.team = 1;
  y.team = 1;
  const log3 = collisionLog(s3);
  resolveCollisions(s3, new OrbitPositionCache(), log3, new Map());
  assert.deepEqual(log3.kills, []);
});

test("alliés : un projectile traverse les alliés de son lanceur, même parti, et touche les adversaires", () => {
  const state = new ArenaState();
  const thrower = addPlayer(state, { x: 0, y: 0, rarities: [BladeRarity.Common, BladeRarity.Epic] });
  thrower.team = 1;
  thrower.dirX = 1;
  thrower.dirY = 0;
  thrower.inputThrow = true;
  const log = collisionLog(state);
  processThrows(state, log);
  const proj = [...state.blades.values()].find((b) => b.isProjectile)!;
  assert.equal(proj.thrownTeam, 1);
  const ally = addPlayer(state, { x: 10, y: 0 });
  ally.team = 1;
  const foe = addPlayer(state, { x: 20, y: 0 });
  foe.team = 2;
  state.players.delete(thrower.id);
  proj.x = 10.3;
  proj.y = 0;
  resolveProjectileCollisions(state, log, new OrbitPositionCache());
  assert.deepEqual(log.kills, []);
  assert.equal(proj.pierceLeft, 2);
  proj.x = 20.3;
  resolveProjectileCollisions(state, log, new OrbitPositionCache());
  assert.deepEqual(log.kills, [[foe.id, null]]);
});

test("buissons : un allié caché reste visible de son équipe, pas des adversaires", () => {
  const r = new TestRoom(clock, { mode: "tdm" });
  const me = r.join("me");
  const foe = r.join("foe");
  const hidden = r.join("hidden");
  assert.deepEqual([me.team, foe.team, hidden.team], [1, 2, 1]);
  const bush = BUSHES[0];
  place(hidden, bush.x, bush.y);
  place(me, bush.x, bush.y + 25);
  place(foe, bush.x, bush.y - 25);
  r.tick(2); // vues recalculées un tick sur deux
  assert.ok(received(r, "me").players.has("hidden"));
  assert.ok(!received(r, "foe").players.has("hidden"));
});

test("Team Deathmatch : une élimination d'un adversaire vaut un point, le mur rien ; fin à 30", () => {
  const r = new TestRoom(clock, { mode: "tdm" });
  assert.equal(r.state.phaseEndsAt, clock.now + TDM_DURATION_MS);
  const a = r.join("a");
  const b = r.join("b");
  const c = r.join("c");
  r.room.killPlayer(b, a, "blades");
  assert.deepEqual([r.state.teamScore1, r.state.teamScore2], [1, 0]);
  r.room.killPlayer(c, null, "wall");
  assert.deepEqual([r.state.teamScore1, r.state.teamScore2], [1, 0]);
  r.room.handleRespawn({ sessionId: "b" }, {});
  assert.equal(b.alive, true);
  r.state.teamScore1 = TDM_KILL_TARGET - 1;
  r.room.killPlayer(b, a, "blades");
  r.tick();
  assert.equal(r.state.phase, MatchPhase.Over);
  const [end] = r.eventsOf("matchEnd");
  assert.deepEqual(end.teams, { scores: [TDM_KILL_TARGET, 0], winner: 1 });
  // Meilleur joueur : celui de l'équipe gagnante qui a le plus de points.
  assert.equal(end.mvp, "a");
  assert.equal(end.standings[0].id, "a");
  assert.deepEqual(end.standings.map((s: any) => [s.id, s.team, s.kills]).sort(), [["a", 1, 2], ["b", 2, 0], ["c", 1, 0]]);
  // Partie suivante : scores à zéro.
  clock.now = end.nextAt;
  r.tick();
  assert.equal(r.state.phase, MatchPhase.Playing);
  assert.deepEqual([r.state.teamScore1, r.state.teamScore2], [0, 0]);
});

test("Team Deathmatch : au bout de 5 minutes, la meilleure équipe ; égalité possible", () => {
  const r = new TestRoom(clock, { mode: "tdm" });
  r.join("a");
  r.join("b");
  clock.now = r.state.phaseEndsAt;
  r.tick();
  const [end] = r.eventsOf("matchEnd");
  assert.deepEqual(end.teams, { scores: [0, 0], winner: TEAM_NONE });
  // À égalité, le meilleur de tous.
  assert.equal(end.mvp, end.standings[0].id);
});

test("dernière équipe en vie : pas de réapparition, l'arrivant en cours de manche attend la suivante", () => {
  const r = new TestRoom(clock, { mode: "lts" });
  assert.equal(r.state.phaseEndsAt, clock.now + LTS_DURATION_MS);
  const a = r.join("a");
  const b = r.join("b");
  const c = r.join("c");
  r.tick();
  assert.deepEqual([r.state.teamScore1, r.state.teamScore2], [2, 1]);
  r.room.killPlayer(c, b, "blades");
  r.room.handleRespawn({ sessionId: "c" }, {});
  assert.equal(c.alive, false);
  r.tick();
  assert.deepEqual([r.state.teamScore1, r.state.teamScore2], [1, 1]);
  // Spectateur : il suit un coéquipier en vie (zone d'intérêt, caméra).
  assert.deepEqual([c.x, c.y], [a.x, a.y]);
  // Dix secondes après le début : on regarde, sans lames.
  clock.advance(10_000);
  const late = r.join("late");
  assert.equal(late.alive, false);
  assert.equal(late.team, 2);
  assert.equal(ownedBlades(r.state, late).length, 0);
  r.tick();
  assert.deepEqual([late.x, late.y], [b.x, b.y]);
  // L'équipe 2 n'a plus personne en vie : manche finie, l'équipe 1 gagne.
  r.room.killPlayer(b, a, "blades");
  r.tick();
  assert.equal(r.state.phase, MatchPhase.Over);
  const [end] = r.eventsOf("matchEnd");
  assert.deepEqual(end.teams, { scores: [1, 0], winner: 1 });
  // Manche suivante : tout le monde en jeu, retardataire compris.
  clock.now = end.nextAt;
  r.tick();
  assert.ok([a, b, c, late].every((p) => p.alive));
  assert.equal(ownedBlades(r.state, late).length, INITIAL_BLADE_COUNT);
});

test("dernière équipe en vie : seule, une équipe ne gagne pas d'office ; à l'échéance, survivants puis lames", () => {
  const r = new TestRoom(clock, { mode: "lts" });
  const a = r.join("a");
  r.tick(30);
  assert.equal(r.state.phase, MatchPhase.Playing);
  const b = r.join("b");
  for (let i = 0; i < 4; i++) giveBlade(r.state, b);
  // Au centre, loin l'un de l'autre : l'arène qui se resserre ne les
  // touche pas.
  place(a, -10, 0);
  place(b, 10, 0);
  clock.now = r.state.phaseEndsAt - ROUND_SHRINK_MS / 2;
  r.tick();
  assert.ok(Math.abs(r.state.mapRadius - (MAP_RADIUS + ROUND_FINAL_RADIUS) / 2) < 0.5);
  clock.now = r.state.phaseEndsAt;
  r.tick();
  const [end] = r.eventsOf("matchEnd");
  assert.deepEqual(end.teams, { scores: [1, 1], winner: 2 });
});

test("dernière équipe en vie : les bots complètent les équipes au début de la manche seulement", () => {
  const r = new TestRoom(clock, { mode: "lts", bots: true });
  r.join("h");
  r.tick();
  const bots = [...r.state.players.values()].filter((p) => p.isBot);
  assert.ok(bots.length >= 2);
  const sizes = [0, 0, 0];
  r.state.players.forEach((p) => sizes[p.team]++);
  assert.ok(Math.abs(sizes[1] - sizes[2]) <= 1, `équipes ${sizes[1]} contre ${sizes[2]}`);
  clock.advance(11_000);
  r.room.killPlayer(bots[0], null, "wall");
  r.tick(2);
  const ids = new Set(bots.map((p) => p.id));
  r.state.players.forEach((p) => assert.ok(!p.isBot || ids.has(p.id), `bot ${p.id} arrivé en cours de manche`));
  // Éliminé, il reste au classement jusqu'à la fin de la manche.
  assert.equal(r.state.players.get(bots[0].id)?.alive, false);
  clock.now = r.state.phaseEndsAt;
  r.tick();
  assert.ok(r.eventsOf("matchEnd")[0].standings.some((s: any) => s.id === bots[0].id));
  clock.now = r.state.phaseEndsAt;
  r.tick();
  assert.equal(r.state.players.has(bots[0].id), false);
});

test("drapeau : pris au contact, suit son porteur, capturé dans sa base si son drapeau y est", () => {
  const r = new TestRoom(clock, { mode: "ctf" });
  assert.equal(r.state.phaseEndsAt, clock.now + CTF_DURATION_MS);
  const a = r.join("a");
  const b = r.join("b");
  const [f1, f2] = r.state.flags;
  assert.deepEqual([f1.team, f1.x, f1.y, f1.atBase, f2.team, f2.x], [1, teamBase(1).x, 0, true, 2, teamBase(2).x]);
  place(b, 0, -150);
  // Son propre drapeau, à la base : rien.
  place(a, teamBase(1).x + 1, 0);
  r.tick();
  assert.equal(f1.carrierId, "");
  // Celui d'en face : pris, et le porteur ne se cache plus ; c'est une
  // attaque, sa grâce s'arrête (les bots normaux le laissaient pendant la
  // rampe, tâche 4.5).
  a.graceUntil = clock.now + 5000;
  a.graceRampUntil = clock.now + 45000;
  place(a, teamBase(2).x - 2, 1);
  r.tick();
  assert.equal(f2.carrierId, "a");
  assert.equal(f2.atBase, false);
  assert.equal(a.revealed, true);
  assert.equal(a.graceUntil, 0);
  assert.equal(a.graceRampUntil, 0);
  place(a, 50, 20);
  r.tick();
  assert.deepEqual([f2.x, f2.y], [50, 20]);
  // b emporte le drapeau de a : pas de capture tant qu'il n'est pas rentré.
  place(b, teamBase(1).x, 0);
  r.tick();
  assert.equal(f1.carrierId, "b");
  place(b, 0, 100);
  r.tick();
  place(a, teamBase(1).x + 3, 0);
  r.tick();
  assert.equal(r.state.teamScore1, 0);
  assert.equal(f2.carrierId, "a");
  // b meurt : le drapeau tombe ; a le touche, il rentre (points de retour).
  r.room.killPlayer(b, a, "blades");
  assert.deepEqual([f1.carrierId, f1.atBase, f1.x, f1.y, f1.returnsAt], ["", false, 0, 100, clock.now + CTF_FLAG_RETURN_MS]);
  const bonus = a.bonusScore;
  place(a, 1, 101);
  r.tick();
  assert.equal(f1.atBase, true);
  assert.equal(a.bonusScore, bonus + CTF_RETURN_POINTS);
  // Capture.
  place(a, teamBase(1).x + 3, 0);
  r.tick();
  assert.equal(r.state.teamScore1, 1);
  assert.deepEqual([f2.carrierId, f2.atBase, f2.x], ["", true, teamBase(2).x]);
  assert.equal(a.revealed, false);
  assert.equal(a.bonusScore, bonus + CTF_RETURN_POINTS + CTF_CAPTURE_POINTS);
  assert.deepEqual(
    r.eventsOf("flag").map((e) => [e.kind, e.team, e.playerId ?? null]),
    [["take", 2, "a"], ["take", 1, "b"], ["drop", 1, "b"], ["return", 1, "a"], ["capture", 2, "a"]],
  );
});

test("drapeau lâché : rentre seul au bout de 20 s ; lâché dans le mur ou au départ du porteur", () => {
  const r = new TestRoom(clock, { mode: "ctf" });
  const a = r.join("a");
  const b = r.join("b");
  const f2 = r.state.flags[1];
  place(b, 0, -150);
  const take = () => {
    if (!a.alive) {
      r.room.handleRespawn({ sessionId: "a" }, {});
      a.spawnProtectionUntil = 0;
    }
    place(a, teamBase(2).x, 0);
    r.tick();
    assert.equal(f2.carrierId, "a");
  };
  take();
  place(a, 0, 0);
  r.tick();
  r.room.killPlayer(a, null, "blades");
  clock.advance(CTF_FLAG_RETURN_MS - 100);
  r.tick();
  assert.equal(f2.atBase, false);
  clock.advance(200);
  r.tick();
  assert.equal(f2.atBase, true);
  assert.deepEqual(r.eventsOf("flag").at(-1), { kind: "return", team: 2, tick: r.state.tick });
  // Porteur tué par le mur : le drapeau, hors d'atteinte, rentre aussitôt.
  take();
  place(a, MAP_RADIUS - 1, 0);
  r.tick();
  assert.equal(a.alive, false);
  assert.equal(f2.atBase, true);
  // Porteur qui s'en va : le drapeau tombe où il était.
  take();
  place(a, 30, 40);
  r.tick();
  r.room.cleanupPlayer("a");
  assert.deepEqual([f2.carrierId, f2.atBase, f2.x, f2.y], ["", false, 30, 40]);
});

test("drapeau : le porteur reste visible dans un buisson ; trois captures finissent la partie", () => {
  const r = new TestRoom(clock, { mode: "ctf" });
  const a = r.join("a");
  const b = r.join("b");
  const [f1, f2] = r.state.flags;
  place(a, teamBase(1).x, 40);
  place(b, teamBase(1).x, 0);
  r.tick();
  assert.equal(f1.carrierId, "b");
  const bush = BUSHES[0];
  place(b, bush.x, bush.y);
  place(a, bush.x, bush.y + 25);
  r.tick(2); // vues recalculées un tick sur deux
  assert.ok(received(r, "a").players.has("b"));
  const summary = r.room.buildSummary();
  assert.ok(summary.map.some(([i]: number[]) => summary.board[i][0] === "b"));
  // Troisième capture de l'équipe 2 : fin de partie, victoire.
  r.state.teamScore2 = CTF_CAPTURE_TARGET - 1;
  place(a, 0, 150);
  place(b, teamBase(2).x, 2);
  r.tick();
  assert.equal(r.state.phase, MatchPhase.Over);
  const [end] = r.eventsOf("matchEnd");
  assert.deepEqual(end.teams, { scores: [0, CTF_CAPTURE_TARGET], winner: 2 });
  assert.equal(end.mvp, "b");
  // Partie suivante : drapeaux à leur base.
  clock.now = end.nextAt;
  r.tick();
  assert.ok(f1.atBase && f2.atBase);
  assert.equal(r.state.teamScore2, 0);
});

test("bots : en capture du drapeau, ils vont chercher le drapeau d'en face et le rapportent", () => {
  const r = new TestRoom(clock, { mode: "ctf", bots: true });
  const h = r.join("h");
  place(h, 0, -200);
  let ticks = 0;
  while (r.state.phase === MatchPhase.Playing && ticks++ < 4 * 60 * 60) r.tick();
  const flags = r.eventsOf("flag");
  const takes = flags.filter((e) => e.kind === "take" && e.playerId.startsWith("bot_")).length;
  const captures = flags.filter((e) => e.kind === "capture").length;
  assert.ok(takes >= 2, `${takes} prises`);
  assert.ok(captures >= 1, `${captures} captures`);
});
