// Modes de jeu (tâche 7.3) : registre, hooks appelés par la room, cycle
// d'une partie qui a une fin (classement, entracte, partie suivante).
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  GAME_MODES,
  INITIAL_BLADE_COUNT,
  KillCause,
  MatchPhase,
  gameModeOf,
} from "@bladeio/shared";
import * as matches from "../src/auth/matches";
import * as wallet from "../src/auth/wallet";
import * as telemetry from "../src/telemetry";
import { GameMode, ModeHost, createMode } from "../src/modes";
import { Crate } from "../src/state/Crate";
import { Player } from "../src/state/Player";
import { FakeClock, addGroundBlade, giveBlade, groundBlades, ownedBlades, seedRandom } from "./helpers";
import { TestRoom } from "./testRoom";

let clock: FakeClock;
let restoreRandom: () => void;
let lives: telemetry.LifeRecord[];
let recorded: matches.MatchRecord[];

beforeEach(() => {
  clock = new FakeClock();
  restoreRandom = seedRandom(7);
  lives = [];
  recorded = [];
  (telemetry as any).recordLife = (rec: telemetry.LifeRecord) => { lives.push(rec); };
  (matches as any).recordMatch = async (rec: matches.MatchRecord) => { recorded.push(rec); };
  (wallet as any).creditWallet = async () => {};
  (wallet as any).creditGuestWallet = async () => {};
});
afterEach(() => {
  clock.restore();
  restoreRandom();
});

// Mode d'essai : apparition fixe, réapparition interdite, classement aux
// kills, fin de partie au premier kill (entracte de 5 s).
class KillRaceMode implements GameMode {
  readonly id = "ffa" as const;
  joined: string[] = [];
  kills: Array<[string, string | null, KillCause]> = [];
  starts = 0;
  private over = false;
  constructor(private readonly host: ModeHost) {}
  onJoin(p: Player): void { this.joined.push(p.id); }
  spawnPoint(): { x: number; y: number } { return { x: 42, y: -7 }; }
  canRespawn(): boolean { return false; }
  onKill(victim: Player, killer: Player | null, cause: KillCause): void {
    this.kills.push([victim.id, killer?.id ?? null, cause]);
    this.over = true;
  }
  standingScore(p: Player): number { return p.kills * 100; }
  tick(): void { if (this.over) this.host.endMatch(5000); }
  onMatchStart(): void { this.over = false; this.starts++; }
}

function withMode(r: TestRoom): KillRaceMode {
  const host: ModeHost = {
    get state() { return r.room.state; },
    isPrivate: false,
    endMatch: (ms) => r.room.endMatch(ms),
  };
  const mode = new KillRaceMode(host);
  r.room.mode = mode;
  return mode;
}

test("registre : un jeu de règles par mode partagé ; mode absent ou inconnu → arène", () => {
  const host = {} as ModeHost;
  for (const info of GAME_MODES) assert.equal(createMode(info.id, host).id, info.id);
  assert.equal(gameModeOf(undefined), "ffa");
  assert.equal(gameModeOf("battle-royale"), "ffa");
  assert.equal(gameModeOf(42), "ffa");
  assert.equal(gameModeOf("ffa"), "ffa");
});

test("matchmaking : la room s'inscrit sous son mode, même créée par un client d'avant les modes", () => {
  const legacy = new TestRoom(clock);
  assert.equal(legacy.room.listing.mode, "ffa");
  assert.equal(legacy.state.mode, "ffa");
  assert.equal(legacy.room.metadata.mode, "ffa");
  const odd = new TestRoom(clock, { mode: "nope" } as any);
  assert.equal(odd.room.listing.mode, "ffa");
});

test("arène : apparition, réapparition et classement inchangés, jamais de fin", () => {
  const r = new TestRoom(clock);
  const a = r.join("a");
  giveBlade(r.state, a);
  r.tick(30);
  r.room.killPlayer(a, null, "wall");
  r.room.handleRespawn({ sessionId: "a" }, {});
  assert.equal(a.alive, true);
  assert.equal(a.bladeCount, INITIAL_BLADE_COUNT);
  r.tick(60 * 60);
  assert.equal(r.state.phase, MatchPhase.Playing);
  assert.equal(r.eventsOf("matchEnd").length, 0);
  const board = r.room.buildSummary().board;
  assert.deepEqual(board.map((row: any[]) => [row[0], row[2]]), [["a", a.score]]);
});

test("hooks : arrivée et apparition (humains et bots), réapparition, élimination, classement", () => {
  const r = new TestRoom(clock);
  const mode = withMode(r);
  const a = r.join("a");
  assert.deepEqual([a.x, a.y], [42, -7]);
  // Remplissage par les bots de la room : mêmes règles que les humains.
  r.room.maintainBots();
  const bots = [...r.state.players.values()].filter((p) => p.isBot);
  assert.ok(bots.length > 0);
  assert.deepEqual(mode.joined, ["a", ...bots.map((b) => b.id)]);
  for (const b of bots) assert.deepEqual([b.x, b.y], [42, -7]);
  const bot = bots[0];
  r.room.killPlayer(bot, a, "throw");
  assert.deepEqual(mode.kills, [[bot.id, "a", "throw"]]);
  r.room.killPlayer(a, null, "wall");
  r.room.handleRespawn({ sessionId: "a" }, {});
  assert.equal(a.alive, false, "réapparition refusée par le mode");
  r.tick(30);
  const board = r.eventsOf("summary").at(-1).board;
  assert.deepEqual(board.find((row: any[]) => row[0] === "a")[2], 100, "classement aux kills");
});

test("fin de partie : classement, vies enregistrées, entracte immobile, puis partie suivante", () => {
  const r = new TestRoom(clock);
  const mode = withMode(r);
  const winner = r.join("winner", { userId: "u-winner" });
  const loser = r.join("loser", { userId: "u-loser" });
  const idle = r.join("idle", { guestId: "g-idle" });
  for (let i = 0; i < 6; i++) giveBlade(r.state, winner);
  const oldGround = addGroundBlade(r.state, { x: 10, y: 10 });
  const crate = new Crate();
  crate.id = "c1";
  r.state.crates.set(crate.id, crate);

  r.room.killPlayer(loser, winner, "blades");
  lives.length = 0;
  recorded.length = 0;
  r.tick();
  assert.equal(r.state.phase, MatchPhase.Over);
  assert.equal(r.state.phaseEndsAt, clock.now + 5000);
  const [end] = r.eventsOf("matchEnd");
  assert.equal(end.nextAt, r.state.phaseEndsAt);
  assert.deepEqual(end.standings.map((row: any[]) => [row[0], row[2]]), [["winner", 100], ["loser", 0], ["idle", 0]]);
  // Vies en cours closes par la fin de partie, une seule fois.
  assert.deepEqual(lives.map((l) => [l.cause, l.gameMode]).sort(), [["match_end", "ffa"], ["match_end", "ffa"]]);
  assert.deepEqual(recorded.map((m) => m.userId), ["u-winner"]);

  // Entracte : ni mouvement ni réapparition, inputs acquittés sans pas.
  const [x, y] = [winner.x, winner.y];
  r.room.handleInput({ sessionId: "winner" }, { seq: 1, dx: 1, dy: 0, boost: false, throw: false });
  r.room.handleRespawn({ sessionId: "loser" }, {});
  r.tick(60);
  assert.deepEqual([winner.x, winner.y], [x, y]);
  assert.equal(winner.lastSeq, 1);
  assert.equal(winner.inputQueue.length, 0);
  assert.equal(loser.alive, false);
  // Partir pendant l'entracte n'enregistre pas la vie une deuxième fois.
  r.room.onLeave({ sessionId: "idle" }, true);
  assert.equal(lives.length, 2);

  // Jusqu'au tick de la relance (les suivants remettent du butin au sol).
  let guard = 0;
  while (r.state.phase === MatchPhase.Over && guard++ < 10 * 60) r.tick();
  assert.ok(clock.now >= end.nextAt);
  assert.equal(r.state.phase, MatchPhase.Playing);
  assert.equal(r.state.phaseEndsAt, 0);
  assert.equal(mode.starts, 1);
  for (const p of [winner, loser]) {
    assert.equal(p.alive, true);
    assert.equal(p.score, 0);
    assert.equal(p.kills, 0);
    assert.equal(ownedBlades(r.state, p).length, INITIAL_BLADE_COUNT);
    assert.deepEqual([p.x, p.y], [42, -7]);
  }
  assert.equal(groundBlades(r.state).length, 0);
  assert.equal(r.state.blades.has(oldGround.id), false);
  assert.equal(r.state.crates.size, 0);
  assert.equal(r.state.players.has("idle"), false);
  // Et la partie repart : le prochain kill la termine à nouveau.
  r.tick();
  r.room.killPlayer(loser, winner, "blades");
  r.tick();
  assert.equal(r.eventsOf("matchEnd").length, 2);
});
