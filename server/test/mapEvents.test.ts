// Évènements de carte (tâche 4.4) : rythme, pluie de lames, caisse
// légendaire, zone dorée, bilan pour la télémétrie, bots.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  BladeRarity,
  GOLDEN_DURATION_MS,
  GOLDEN_RADIUS,
  GOLDEN_WARNING_MS,
  GROUND_BLADE_TTL_MS,
  LEGENDARY_CRATE_HP,
  LEGENDARY_CRATE_LOOT,
  LEGENDARY_CRATE_MAX_MS,
  MAP_EVENT_INTERVAL_MAX_MS,
  MAP_EVENT_INTERVAL_MIN_MS,
  MapEventKind,
  RAIN_BLADES,
  RAIN_DURATION_MS,
  RAIN_RADIUS,
  RAIN_WARNING_MS,
  SCORE_KILL,
} from "@bladeio/shared";
import * as matches from "../src/auth/matches";
import * as wallet from "../src/auth/wallet";
import * as telemetry from "../src/telemetry";
import { MapEventSystem } from "../src/systems/mapEvents";
import { FakeClock, groundBlades, seedRandom } from "./helpers";
import { TestRoom } from "./testRoom";

let clock: FakeClock;
let restoreRandom: () => void;
let records: telemetry.MapEventRecord[];

beforeEach(() => {
  clock = new FakeClock();
  restoreRandom = seedRandom(44);
  records = [];
  (telemetry as any).recordLife = () => {};
  (telemetry as any).recordMapEvent = (rec: telemetry.MapEventRecord) => { records.push(rec); };
  (matches as any).recordMatch = async () => {};
  (wallet as any).creditWallet = async () => {};
  (wallet as any).creditGuestWallet = async () => {};
});
afterEach(() => {
  clock.restore();
  restoreRandom();
});

function events(r: TestRoom): MapEventSystem {
  return (r.room as any).mapEvents;
}

// Lance tout de suite un évènement du type voulu : le tirage du type est
// le premier appel à Math.random de start().
function startEvent(r: TestRoom, kind: number): void {
  const sys = events(r) as any;
  sys.lastKind = MapEventKind.None;
  sys.nextAt = clock.now;
  const rnd = Math.random;
  let first = true;
  Math.random = () => {
    if (first) {
      first = false;
      return (kind - 1) / 3 + 0.01;
    }
    return rnd();
  };
  try {
    sys.update(r.state, clock.now, r.state.phaseEndsAt, () => {});
  } finally {
    Math.random = rnd;
  }
  assert.equal(r.state.mapEvent.kind, kind);
}

test("rythme : un évènement entre 90 et 120 s, jamais deux fois le même de suite, aucun sans humain en vie", () => {
  const r = new TestRoom(clock);
  const h = r.join("h");
  const start = clock.now;
  const kinds: number[] = [];
  const starts: number[] = [];
  let ended = start;
  let last: number = MapEventKind.None;
  // Pas à pas d'une seconde : le système seul, sans simulation.
  for (let t = 0; t < 20 * 60; t++) {
    clock.now = start + t * 1000;
    events(r).update(r.state, clock.now, 0, () => { ended = clock.now; });
    const k = r.state.mapEvent.kind;
    if (k !== MapEventKind.None && last === MapEventKind.None) {
      kinds.push(k);
      starts.push(clock.now - ended);
    }
    if (k === MapEventKind.Crate) r.state.crates.delete(r.state.mapEvent.crateId);
    last = k;
  }
  assert.ok(kinds.length >= 7, `${kinds.length} évènements en 20 min`);
  for (const gap of starts) assert.ok(gap >= MAP_EVENT_INTERVAL_MIN_MS && gap <= MAP_EVENT_INTERVAL_MAX_MS + 1000, `écart ${gap}`);
  for (let i = 1; i < kinds.length; i++) assert.notEqual(kinds[i], kinds[i - 1]);
  assert.deepEqual([...new Set(kinds)].sort(), [1, 2, 3]);
  // Plus personne en vie : l'évènement en cours finit, aucun autre ne
  // commence.
  r.room.killPlayer(h, null, "wall");
  if (r.state.mapEvent.kind === MapEventKind.Crate) r.state.crates.delete(r.state.mapEvent.crateId);
  clock.now += MAP_EVENT_INTERVAL_MAX_MS;
  events(r).update(r.state, clock.now, 0, () => {});
  assert.equal(r.state.mapEvent.kind, MapEventKind.None);
  clock.now += MAP_EVENT_INTERVAL_MAX_MS * 2;
  events(r).update(r.state, clock.now, 0, () => {});
  assert.equal(r.state.mapEvent.kind, MapEventKind.None);
});

test("modes : pas d'évènement en dernière équipe ni au drapeau, ni pendant la fin d'une manche", () => {
  for (const mode of ["lts", "ctf"]) {
    const r = new TestRoom(clock, { mode });
    r.join("h");
    for (let i = 0; i < 4; i++) {
      clock.advance(MAP_EVENT_INTERVAL_MAX_MS / 2);
      r.tick();
    }
    assert.equal(r.state.mapEvent.kind, MapEventKind.None, mode);
  }
  const rounds = new TestRoom(clock, { mode: "rounds" });
  rounds.join("h");
  (events(rounds) as any).nextAt = rounds.state.phaseEndsAt - 60_000;
  clock.now = rounds.state.phaseEndsAt - 60_000;
  rounds.tick();
  assert.equal(rounds.state.mapEvent.kind, MapEventKind.None);
});

test("pluie : annoncée 5 s avant, puis 28 lames dans la zone en 6 s, qui expirent comme le butin", () => {
  const r = new TestRoom(clock);
  const h = r.join("h");
  const before = new Set(groundBlades(r.state).map((b) => b.id));
  startEvent(r, MapEventKind.Rain);
  const ev = r.state.mapEvent;
  // L'état de l'évènement est remis à zéro à sa fin : on garde la zone.
  const zone = { x: ev.x, y: ev.y };
  assert.equal(ev.radius, RAIN_RADIUS);
  assert.equal(ev.startsAt, clock.now + RAIN_WARNING_MS);
  assert.equal(ev.endsAt, ev.startsAt + RAIN_DURATION_MS);
  // Lames de la pluie : au sol, avec une échéance (l'ambiant n'en a pas).
  const fresh = () => groundBlades(r.state).filter((b) => !before.has(b.id) && b.expiresAt > 0 && Math.hypot(b.x - zone.x, b.y - zone.y) <= RAIN_RADIUS + 0.01);
  clock.now = ev.startsAt - 100;
  r.tick();
  assert.equal(fresh().length, 0);
  // Le joueur arrive dans la zone pendant la pluie.
  h.x = zone.x;
  h.y = zone.y;
  clock.now = ev.startsAt + RAIN_DURATION_MS / 2;
  r.tick();
  const half = fresh().length + h.bladeCount - 3;
  assert.ok(half >= RAIN_BLADES / 2 - 2 && half <= RAIN_BLADES / 2 + 2, `${half} lames à mi-pluie`);
  clock.now = ev.endsAt;
  r.tick();
  assert.equal(r.state.mapEvent.kind, MapEventKind.None);
  const rained = fresh();
  assert.equal(rained.length + (h.bladeCount - 3), RAIN_BLADES);
  for (const b of rained) assert.ok(b.expiresAt > 0 && b.expiresAt <= clock.now + GROUND_BLADE_TTL_MS);
  assert.deepEqual(records.map((o) => [o.kind, o.humans, o.humansReached, o.gameMode, o.roomPrivate]), [["rain", 1, 1, "ffa", false]]);
  // De l'annonce à la dernière lame, au tick près.
  assert.ok(Math.abs(records[0].durationMs - (RAIN_WARNING_MS + RAIN_DURATION_MS)) < 20);
});

test("caisse légendaire : solide, son butin fixe ; l'évènement finit à sa destruction ou au bout de 90 s", () => {
  const r = new TestRoom(clock);
  r.join("h");
  startEvent(r, MapEventKind.Crate);
  const crate = r.state.crates.get(r.state.mapEvent.crateId)!;
  assert.equal(crate.legendary, true);
  assert.equal(crate.hp, LEGENDARY_CRATE_HP);
  assert.deepEqual([r.state.mapEvent.x, r.state.mapEvent.y], [crate.x, crate.y]);
  const before = new Set(groundBlades(r.state).map((b) => b.id));
  r.room.handleCrateDestroyed(crate, null);
  const loot = groundBlades(r.state).filter((b) => !before.has(b.id)).map((b) => b.rarity).sort();
  assert.deepEqual(loot, [...LEGENDARY_CRATE_LOOT].sort());
  assert.ok(loot.includes(BladeRarity.Legendary));
  r.tick();
  assert.equal(r.state.mapEvent.kind, MapEventKind.None);
  assert.deepEqual(records.map((o) => o.kind), ["crate"]);
  // Personne ne la casse : retirée au bout de 90 s.
  startEvent(r, MapEventKind.Crate);
  const id = r.state.mapEvent.crateId;
  clock.now += LEGENDARY_CRATE_MAX_MS;
  r.tick();
  assert.equal(r.state.crates.has(id), false);
  assert.equal(r.state.mapEvent.kind, MapEventKind.None);
});

test("zone dorée : au centre, annoncée 5 s avant ; ce qui est gagné dedans compte double, dehors non", () => {
  const r = new TestRoom(clock);
  const inside = r.join("inside");
  const outside = r.join("outside");
  const victim = r.join("victim");
  inside.x = 3; inside.y = 0;
  outside.x = 0; outside.y = GOLDEN_RADIUS + 30;
  victim.x = -100; victim.y = 0;
  startEvent(r, MapEventKind.Golden);
  const ev = r.state.mapEvent;
  assert.deepEqual([ev.x, ev.y, ev.radius], [0, 0, GOLDEN_RADIUS]);
  assert.equal(ev.startsAt, clock.now + GOLDEN_WARNING_MS);
  assert.equal(ev.endsAt, ev.startsAt + GOLDEN_DURATION_MS);
  // Pendant l'annonce : rien de doublé.
  r.room.killPlayer(victim, inside, "blades");
  r.tick();
  assert.equal(inside.bonusScore, 0);
  clock.now = ev.startsAt;
  r.tick();
  r.tick();
  const [b0, s0] = [inside.bonusScore, inside.score];
  // Le temps de deux éliminations, la victime revient loin de la zone.
  const respawnFar = () => {
    r.room.handleRespawn({ sessionId: "victim" }, {});
    victim.x = -100;
    victim.y = 0;
  };
  respawnFar();
  r.tick();
  const [b1, s1] = [inside.bonusScore, inside.score];
  r.room.killPlayer(victim, inside, "blades");
  respawnFar();
  r.room.killPlayer(victim, outside, "blades");
  r.tick();
  // Dedans : l'élimination rapporte deux fois SCORE_KILL ; dehors, une fois.
  assert.deepEqual([b1, s1], [b0, s0]);
  assert.equal(inside.bonusScore - b0, SCORE_KILL);
  assert.equal(inside.score - s0, 2 * SCORE_KILL);
  assert.equal(outside.bonusScore, 0);
  clock.now = ev.endsAt;
  r.tick();
  assert.equal(r.state.mapEvent.kind, MapEventKind.None);
  const [o] = records;
  assert.deepEqual([o.kind, o.humans, o.humansReached], ["golden", 3, 1]);
});

test("nouvelle manche : l'évènement en cours s'arrête, le suivant après le délai habituel", () => {
  const r = new TestRoom(clock, { mode: "rounds" });
  r.join("h");
  startEvent(r, MapEventKind.Crate);
  clock.now = r.state.phaseEndsAt;
  r.tick();
  clock.now = r.state.phaseEndsAt;
  r.tick();
  assert.equal(r.state.mapEvent.kind, MapEventKind.None);
  assert.equal(r.state.crates.size, 0);
  r.tick();
  const next = (events(r) as any).nextAt;
  assert.ok(next >= clock.now + MAP_EVENT_INTERVAL_MIN_MS && next <= clock.now + MAP_EVENT_INTERVAL_MAX_MS);
});

test("bots : ils convergent vers la pluie, la caisse et la zone dorée", () => {
  const r = new TestRoom(clock, { bots: true });
  // Le seul humain, intouchable : sans lui, pas d'évènement.
  const h = r.join("h", {}, { protected: true });
  h.spawnProtectionUntil = Number.MAX_SAFE_INTEGER;
  h.x = 0; h.y = -200;
  r.tick(60 * 30);
  for (const kind of [MapEventKind.Rain, MapEventKind.Crate, MapEventKind.Golden]) {
    startEvent(r, kind);
    let ticks = 0;
    while (r.state.mapEvent.kind !== MapEventKind.None && ticks++ < 60 * 95) r.tick();
  }
  assert.deepEqual(records.map((o) => o.kind), ["rain", "crate", "golden"]);
  // La pluie (11 s) n'attire que les bots déjà proches ; la caisse, au
  // moins celui qui la casse ; la zone dorée, plusieurs.
  const [, crate, golden] = records;
  assert.ok(crate.botsReached >= 1, `caisse : ${crate.botsReached} bots sur ${crate.bots}`);
  assert.ok(golden.botsReached >= 2, `zone dorée : ${golden.botsReached} bots sur ${golden.bots}`);
});
