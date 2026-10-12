// Évènements de carte (tâche 4.4, retours du 2026-10-12) : rythme, pluie de
// lames, coffre-fort, chute de processeurs, zone dorée, bilan pour la
// télémétrie, bots.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  BladeRarity,
  CHIP_CRATE_HP,
  CHIP_CRATE_MAX_MS,
  CHIP_HITBOX,
  CrateKind,
  DECOR_COLLIDERS,
  DropState,
  GOLDEN_DURATION_MS,
  GOLDEN_RADIUS,
  GOLDEN_WARNING_MS,
  GROUND_BLADE_TTL_MS,
  INITIAL_BLADE_COUNT,
  MAP_EVENT_INTERVAL_MAX_MS,
  MAP_EVENT_INTERVAL_MIN_MS,
  MapEventKind,
  PROCESSOR_LOOT_MAX,
  PROCESSOR_LOOT_MIN,
  PROCESSOR_SPREAD_MS,
  PROCESSOR_WARNING_MS,
  ProcessorImpactEvent,
  RAIN_BLADES,
  RAIN_DURATION_MS,
  RAIN_RADIUS,
  RAIN_WARNING_MS,
  SCORE_KILL,
  VAULT_CENTER_DIST,
  VAULT_DROP_SPEED_MAX,
  VAULT_DROP_SPEED_MIN,
  VAULT_HITBOX,
  VAULT_HP,
  VAULT_LOOT_MAX,
  VAULT_LOOT_MIN,
  VAULT_MAX_MS,
  WALL_KILL_THICKNESS,
  processorCount,
} from "@bladeio/shared";
import * as matches from "../src/auth/matches";
import * as wallet from "../src/auth/wallet";
import * as telemetry from "../src/telemetry";
import { Player } from "../src/state/Player";
import { MapEventSystem } from "../src/systems/mapEvents";
import { LOOT_WALL_MARGIN, areaShare, zoneInner } from "../src/systems/spawnPoint";
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

// Lance tout de suite un évènement du type voulu (comme la triche /event).
function startEvent(r: TestRoom, kind: number): void {
  assert.ok(events(r).force(r.state, clock.now, kind));
  assert.equal(r.state.mapEvent.kind, kind);
}

// Retire les caisses d'un évènement (coffre, puces entières) : le système
// seul, sans la room, ne les casse ni ne les expire.
function dropEventCrates(r: TestRoom): void {
  const ev = r.state.mapEvent;
  if (ev.crateId) r.state.crates.delete(ev.crateId);
  ev.drops.forEach((d) => { if (d.crateId) r.state.crates.delete(d.crateId); });
}

test("rythme : un évènement 50 à 70 s après la fin du précédent, jamais deux fois le même de suite, aucun sans humain en vie", () => {
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
    dropEventCrates(r);
    last = k;
  }
  // Au moins un toutes les ~95 s (délai et durée des plus longs) ; une
  // douzaine en 20 min, deux fois moins avant le 2026-10-12 (90 à 120 s).
  assert.ok(kinds.length >= 12, `${kinds.length} évènements en 20 min`);
  for (const gap of starts) assert.ok(gap >= MAP_EVENT_INTERVAL_MIN_MS && gap <= MAP_EVENT_INTERVAL_MAX_MS + 1000, `écart ${gap}`);
  for (let i = 1; i < kinds.length; i++) assert.notEqual(kinds[i], kinds[i - 1]);
  assert.deepEqual([...new Set(kinds)].sort(), [1, 2, 3, 4]);
  // Plus personne en vie : l'évènement en cours finit, aucun autre ne
  // commence.
  r.room.killPlayer(h, null, "wall");
  dropEventCrates(r);
  clock.now += MAP_EVENT_INTERVAL_MAX_MS;
  events(r).update(r.state, clock.now, 0, () => {});
  assert.equal(r.state.mapEvent.kind, MapEventKind.None);
  clock.now += MAP_EVENT_INTERVAL_MAX_MS * 2;
  events(r).update(r.state, clock.now, 0, () => {});
  assert.equal(r.state.mapEvent.kind, MapEventKind.None);
});

// Bancs de bots seuls (snowball, serveur) : ils doivent jouer à
// l'identique, donc les évènements n'y tirent rien au sort.
test("room sans humain : ni minuterie ni tirage au sort", () => {
  const r = new TestRoom(clock, { bots: true });
  r.tick(60 * 5);
  let human = false;
  r.state.players.forEach((p) => { if (!p.isBot) human = true; });
  assert.equal(human, false);
  const rnd = Math.random;
  let calls = 0;
  Math.random = () => {
    calls++;
    return rnd();
  };
  try {
    for (let i = 0; i < 600; i++) {
      clock.now += 1000;
      events(r).update(r.state, clock.now, 0, () => {});
    }
  } finally {
    Math.random = rnd;
  }
  assert.equal(calls, 0);
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

test("coffre-fort : à côté du pilier central, hors du décor, dans l'arène ; très solide ; retiré au bout de 120 s", () => {
  for (let seed = 1; seed <= 12; seed++) {
    restoreRandom();
    restoreRandom = seedRandom(seed);
    const r = new TestRoom(clock);
    // Un joueur là où le coffre pourrait tomber : il se pose à côté.
    const h = r.join("h");
    h.x = VAULT_CENTER_DIST;
    h.y = 0;
    startEvent(r, MapEventKind.Crate);
    const ev = r.state.mapEvent;
    const c = r.state.crates.get(ev.crateId)!;
    assert.equal(c.kind, CrateKind.Vault);
    assert.deepEqual([c.hp, c.maxHp], [VAULT_HP, VAULT_HP]);
    assert.deepEqual([ev.x, ev.y], [c.x, c.y]);
    const d = Math.hypot(c.x, c.y);
    assert.ok(Math.abs(d - VAULT_CENTER_DIST) < 0.01, `à ${d} u du centre`);
    for (const col of DECOR_COLLIDERS) {
      assert.ok(Math.hypot(c.x - col.x, c.y - col.y) >= col.radius + VAULT_HITBOX, `dans le décor (${col.x}, ${col.y})`);
    }
    assert.ok(d + VAULT_HITBOX < r.state.mapRadius - WALL_KILL_THICKNESS);
    assert.ok(Math.hypot(c.x - h.x, c.y - h.y) >= VAULT_HITBOX + 3, "sur le joueur");
    assert.equal(ev.endsAt, clock.now + VAULT_MAX_MS);
  }
  // Personne ne l'ouvre : retiré au bout de 120 s, sans butin.
  const r = new TestRoom(clock);
  const h = r.join("h");
  h.x = 0;
  h.y = -100;
  startEvent(r, MapEventKind.Crate);
  const id = r.state.mapEvent.crateId;
  const before = groundBlades(r.state).length;
  clock.now += VAULT_MAX_MS - 1000;
  r.tick();
  assert.equal(r.state.crates.has(id), true);
  clock.now += 1000;
  r.tick();
  assert.equal(r.state.crates.has(id), false);
  assert.equal(r.state.mapEvent.kind, MapEventKind.None);
  assert.ok(groundBlades(r.state).length <= before + 1);
  assert.deepEqual(records.map((o) => o.kind), ["crate"]);
});

test("coffre-fort : 24 à 30 lames, rares, épiques ou légendaires, projetées autour de lui, qui expirent comme le butin", () => {
  const r = new TestRoom(clock);
  const h = r.join("h");
  h.x = 0;
  h.y = -100;
  const rarities: number[] = [];
  let withLegendary = 0;
  const runs = 30;
  for (let i = 0; i < runs; i++) {
    startEvent(r, MapEventKind.Crate);
    const c = r.state.crates.get(r.state.mapEvent.crateId)!;
    const before = new Set(groundBlades(r.state).map((b) => b.id));
    r.room.handleCrateDestroyed(c, null);
    const loot = groundBlades(r.state).filter((b) => !before.has(b.id));
    assert.ok(loot.length >= VAULT_LOOT_MIN && loot.length <= VAULT_LOOT_MAX, `${loot.length} lames`);
    for (const b of loot) {
      assert.notEqual(b.rarity, BladeRarity.Common);
      assert.equal(b.expiresAt, clock.now + GROUND_BLADE_TTL_MS);
      // Du bord du coffre, vers l'extérieur : à disputer autour de lui.
      assert.ok(Math.abs(Math.hypot(b.x - c.x, b.y - c.y) - VAULT_HITBOX) < 0.01);
      const speed = Math.hypot(b.vx, b.vy);
      assert.ok(speed >= VAULT_DROP_SPEED_MIN - 1e-3 && speed <= VAULT_DROP_SPEED_MAX + 1e-3);
      rarities.push(b.rarity);
    }
    if (loot.some((b) => b.rarity === BladeRarity.Legendary)) withLegendary++;
    for (const b of loot) r.state.blades.delete(b.id);
    r.tick();
    assert.equal(r.state.mapEvent.kind, MapEventKind.None);
  }
  // Tirage 0,55 / 0,33 / 0,12.
  const share = (k: BladeRarity) => rarities.filter((x) => x === k).length / rarities.length;
  assert.ok(share(BladeRarity.Rare) > 0.45 && share(BladeRarity.Rare) < 0.65, `rares ${share(BladeRarity.Rare)}`);
  assert.ok(share(BladeRarity.Legendary) > 0.06 && share(BladeRarity.Legendary) < 0.18, `légendaires ${share(BladeRarity.Legendary)}`);
  assert.ok(withLegendary >= runs - 3, `${withLegendary} coffres sur ${runs} avec une légendaire`);
  assert.equal(records.length, runs);
  assert.ok(records.every((o) => o.kind === "crate"));
});

// Temps d'ouverture pour des joueurs posés sur le coffre (comme les bots,
// qui vont à sa position), lames du mélange donné.
function vaultBreakSeconds(mixes: Array<Array<[BladeRarity, number]>>): number {
  const r = new TestRoom(clock);
  const players: Player[] = mixes.map((mix, i) => {
    const p = r.join(`p${i}`);
    // Mêmes alliés : leurs orbites se chevauchent sans clash.
    p.team = 1;
    for (const [rarity, n] of mix) {
      const extra = rarity === BladeRarity.Common ? n - INITIAL_BLADE_COUNT : n;
      r.room.giveBlades(p, extra, rarity);
    }
    return p;
  });
  startEvent(r, MapEventKind.Crate);
  const c = r.state.crates.get(r.state.mapEvent.crateId)!;
  const t0 = clock.now;
  for (let t = 0; t < 60 * 130 && r.state.crates.has(c.id); t++) {
    players.forEach((p, i) => {
      p.x = c.x + (players.length > 1 ? (i === 0 ? -1 : 1) : 0);
      p.y = c.y;
    });
    r.tick();
  }
  return (clock.now - t0) / 1000;
}

// Mélange courant d'un joueur à 40 lames : surtout des communes (tirage
// ambiant 70 / 22 / 7 / 1 %), un peu relevé par les caisses.
const MIX_40: Array<[BladeRarity, number]> = [
  [BladeRarity.Common, 26], [BladeRarity.Rare, 10], [BladeRarity.Epic, 3], [BladeRarity.Legendary, 1],
];
const MIX_80: Array<[BladeRarity, number]> = [
  [BladeRarity.Common, 50], [BladeRarity.Rare, 20], [BladeRarity.Epic, 8], [BladeRarity.Legendary, 2],
];
const MIX_20: Array<[BladeRarity, number]> = [[BladeRarity.Common, 14], [BladeRarity.Rare, 5], [BladeRarity.Epic, 1]];

test("coffre-fort : calibrage, ~20 s seul à 40 lames, pas plus vite avec une plus grosse orbite, bien plus vite à deux", () => {
  const alone = vaultBreakSeconds([MIX_40]);
  assert.ok(alone >= 15 && alone <= 25, `seul à 40 lames : ${alone} s`);
  const big = vaultBreakSeconds([MIX_80]);
  assert.ok(big >= 15, `seul à 80 lames : ${big} s`);
  const small = vaultBreakSeconds([MIX_20]);
  assert.ok(small >= 30, `seul à 20 lames : ${small} s`);
  const two = vaultBreakSeconds([MIX_40, MIX_40]);
  // Pas tout à fait deux fois : deux corps ne se superposent pas, chacun
  // le frôle plus qu'il ne s'y pose.
  assert.ok(two <= alone * 0.7, `à deux : ${two} s (seul ${alone} s)`);
});

test("chute de processeurs : 3 à 5 puces selon l'arène, réparties hors du décor, annoncées puis échelonnées", () => {
  assert.equal(processorCount(0.38), 3);
  assert.equal(processorCount(0.47), 3);
  assert.equal(processorCount(0.7), 4);
  assert.equal(processorCount(1), 5);
  for (const radius of [155, 250]) {
    for (let seed = 1; seed <= 8; seed++) {
      restoreRandom();
      restoreRandom = seedRandom(seed);
      const r = new TestRoom(clock);
      r.join("h");
      r.state.mapRadius = radius;
      r.state.arenaTarget = 0;
      startEvent(r, MapEventKind.Processors);
      const ev = r.state.mapEvent;
      const drops = [...ev.drops];
      assert.equal(drops.length, processorCount(areaShare(r.state)));
      assert.equal(drops.length, radius === 155 ? 3 : 5);
      const zone = zoneInner(r.state, LOOT_WALL_MARGIN);
      drops.forEach((d, i) => {
        assert.equal(d.state, DropState.Falling);
        assert.ok(Math.hypot(d.x, d.y) <= zone + 1e-3, `contre le mur (${Math.hypot(d.x, d.y)} u)`);
        for (const col of DECOR_COLLIDERS) {
          assert.ok(Math.hypot(d.x - col.x, d.y - col.y) >= col.radius + CHIP_HITBOX, "dans le décor");
        }
        for (let j = 0; j < i; j++) {
          assert.ok(Math.hypot(d.x - drops[j].x, d.y - drops[j].y) >= 30, "deux puces collées");
        }
        assert.equal(d.at, clock.now + PROCESSOR_WARNING_MS + Math.round((i * PROCESSOR_SPREAD_MS) / (drops.length - 1)));
      });
      assert.deepEqual([ev.startsAt, ev.endsAt], [drops[0].at, drops[drops.length - 1].at]);
    }
  }
});

test("chute de processeurs : explosion de 5 à 10 lames rares ou mieux, ou puce entière (30 PV, même butin) qui disparaît au bout de 60 s ; aucun dégât", () => {
  let exploded = 0;
  let standing = 0;
  for (let seed = 1; seed <= 6; seed++) {
    restoreRandom();
    restoreRandom = seedRandom(seed);
    records.length = 0;
    const r = new TestRoom(clock);
    r.join("h");
    const bystander = r.join("b");
    startEvent(r, MapEventKind.Processors);
    const ev = r.state.mapEvent;
    const drops = [...ev.drops];
    // Un joueur sous la première puce : rien ne lui arrive.
    bystander.x = drops[0].x;
    bystander.y = drops[0].y;
    const before = new Set(groundBlades(r.state).map((b) => b.id));
    const impacts: ProcessorImpactEvent[] = [];
    clock.now = drops[0].at;
    r.tick();
    assert.equal(bystander.alive, true);
    assert.equal(drops[0].state === DropState.Falling, false);
    // Les suivantes, chacune à son heure : le système seul (comme la room),
    // son bilan va dans records.
    const onEnd = (o: object) => records.push(o as telemetry.MapEventRecord);
    for (const d of drops.slice(1)) {
      clock.now = d.at;
      events(r).update(r.state, clock.now, 0, onEnd, (e) => impacts.push(e));
    }
    assert.equal(impacts.length + 1, drops.length);
    assert.equal(r.eventsOf("processorImpact").length, 1);
    const fresh = groundBlades(r.state).filter((b) => !before.has(b.id));
    for (const d of drops) {
      const mine = fresh.filter((b) => Math.hypot(b.x - d.x, b.y - d.y) < 1.5);
      if (d.state === DropState.Exploded) {
        exploded++;
        assert.ok(mine.length >= PROCESSOR_LOOT_MIN && mine.length <= PROCESSOR_LOOT_MAX, `${mine.length} lames`);
        for (const b of mine) {
          assert.notEqual(b.rarity, BladeRarity.Common);
          assert.ok(b.expiresAt > 0);
        }
        assert.equal(d.crateId, "");
      } else {
        assert.equal(d.state, DropState.Standing);
        standing++;
        assert.equal(mine.length, 0);
        const c = r.state.crates.get(d.crateId)!;
        assert.deepEqual([c.kind, c.hp, c.maxHp, c.x, c.y], [CrateKind.Chip, CHIP_CRATE_HP, CHIP_CRATE_HP, d.x, d.y]);
        // Au tick de l'impact (pas de 1/60 s).
        assert.ok(c.expiresAt >= d.at + CHIP_CRATE_MAX_MS && c.expiresAt < d.at + CHIP_CRATE_MAX_MS + 20);
      }
    }
    // La première puce entière, cassée : son butin.
    const chip = drops.find((d) => d.state === DropState.Standing);
    if (chip) {
      const c = r.state.crates.get(chip.crateId)!;
      const prev = new Set(groundBlades(r.state).map((b) => b.id));
      r.room.handleCrateDestroyed(c, null);
      const loot = groundBlades(r.state).filter((b) => !prev.has(b.id));
      assert.ok(loot.length >= PROCESSOR_LOOT_MIN && loot.length <= PROCESSOR_LOOT_MAX);
      assert.ok(loot.every((b) => b.rarity !== BladeRarity.Common && b.expiresAt === clock.now + GROUND_BLADE_TTL_MS));
      events(r).update(r.state, clock.now, 0, onEnd);
      assert.equal(chip.state, DropState.Gone);
    }
    // Les autres disparaissent au bout de 60 s ; l'évènement finit.
    const left = drops.some((d) => d.state === DropState.Standing);
    if (left) {
      clock.now = drops[drops.length - 1].at + CHIP_CRATE_MAX_MS - 100;
      r.tick();
      assert.equal(r.state.mapEvent.kind, MapEventKind.Processors);
      clock.now += 200;
      r.tick();
    } else {
      r.tick();
    }
    assert.equal(r.state.mapEvent.kind, MapEventKind.None);
    let chips = 0;
    r.state.crates.forEach((c) => { if (c.kind === CrateKind.Chip) chips++; });
    assert.equal(chips, 0);
    assert.deepEqual(records.map((o) => o.kind), ["processors"]);
  }
  assert.ok(exploded > 0 && standing > 0, `${exploded} explosées, ${standing} entières`);
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
  const h = r.join("h");
  h.x = 0;
  h.y = -100;
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

test("bots : ils convergent vers la pluie, le coffre-fort, la zone dorée et les puces", () => {
  const r = new TestRoom(clock, { bots: true });
  // Le seul humain, intouchable : sans lui, pas d'évènement.
  const h = r.join("h", {}, { protected: true });
  h.spawnProtectionUntil = Number.MAX_SAFE_INTEGER;
  h.x = 0; h.y = -200;
  r.tick(60 * 30);
  for (const kind of [MapEventKind.Rain, MapEventKind.Crate, MapEventKind.Golden, MapEventKind.Processors]) {
    startEvent(r, kind);
    let ticks = 0;
    while (r.state.mapEvent.kind !== MapEventKind.None && ticks++ < 60 * 125) r.tick();
  }
  assert.deepEqual(records.map((o) => o.kind), ["rain", "crate", "golden", "processors"]);
  // La pluie (11 s) n'attire que les bots déjà proches ; le coffre, au
  // moins ceux qui le cassent ; la zone dorée et les puces, plusieurs.
  const [, vault, golden, processors] = records;
  assert.ok(vault.botsReached >= 2, `coffre : ${vault.botsReached} bots sur ${vault.bots}`);
  assert.ok(golden.botsReached >= 2, `zone dorée : ${golden.botsReached} bots sur ${golden.bots}`);
  assert.ok(processors.botsReached >= 2, `puces : ${processors.botsReached} bots sur ${processors.bots}`);
});
