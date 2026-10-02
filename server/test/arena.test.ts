// Arène dont la taille suit la population (tâche 4.5) : rayon d'après le
// nombre de joueurs, mur qui recule tout de suite, avance après un préavis
// et toujours moins vite qu'un joueur ; apparitions dans la zone.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  ARENA_GROW_RATE,
  ARENA_GROW_SPEED,
  ARENA_MIN_RADIUS,
  ARENA_POPULATION_WINDOW_MS,
  ARENA_SHRINK_NOTICE_MS,
  ARENA_SHRINK_SPEED,
  MAP_RADIUS,
  PLAYER_SPEED,
  ROUND_SHRINK_MS,
  WALL_KILL_THICKNESS,
  populationRadius,
} from "@bladeio/shared";
import * as matches from "../src/auth/matches";
import * as wallet from "../src/auth/wallet";
import * as telemetry from "../src/telemetry";
import { ArenaState } from "../src/state/ArenaState";
import { Crate } from "../src/state/Crate";
import { PowerUp } from "../src/state/PowerUp";
import { ArenaSizer } from "../src/systems/arenaSize";
import { CrateSystem } from "../src/systems/crates";
import { PowerUpSystem } from "../src/systems/powerups";
import { SpawnSystem, ambientCap } from "../src/systems/spawning";
import { LOOT_WALL_MARGIN, pickSpawnPoint, randomSpawnPoint, zoneInner } from "../src/systems/spawnPoint";
import { DT, FakeClock, addPlayer, groundBlades, seedRandom } from "./helpers";
import { TestRoom } from "./testRoom";

let clock: FakeClock;
let restoreRandom: () => void;

beforeEach(() => {
  clock = new FakeClock();
  restoreRandom = seedRandom(45);
  (telemetry as any).recordLife = () => {};
  (telemetry as any).recordMapEvent = () => {};
  (matches as any).recordMatch = async () => {};
  (wallet as any).creditWallet = async () => {};
  (wallet as any).creditGuestWallet = async () => {};
});
afterEach(() => {
  clock.restore();
  restoreRandom();
});

// Fait tourner le sizer `seconds` secondes au pas du serveur et relève le
// plus grand pas du mur dans chaque sens.
function run(sizer: ArenaSizer, state: ArenaState, seconds: number): { radius: number; maxGrow: number; maxShrink: number } {
  let radius = sizer.current;
  let maxGrow = 0;
  let maxShrink = 0;
  const ticks = Math.round(seconds / DT);
  for (let i = 0; i < ticks; i++) {
    clock.advance(DT * 1000);
    const r = sizer.update(state, clock.now, DT);
    maxGrow = Math.max(maxGrow, r - radius);
    maxShrink = Math.max(maxShrink, radius - r);
    radius = r;
  }
  return { radius, maxGrow, maxShrink };
}

function populate(state: ArenaState, n: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(addPlayer(state).id);
  return ids;
}

test("rayon : ~155 u à 3 joueurs, la carte entière à 60, jamais sous le minimum", () => {
  const three = populationRadius(3);
  assert.ok(three > 150 && three < 160, `3 joueurs : ${three}`);
  assert.equal(populationRadius(60), MAP_RADIUS);
  assert.equal(populationRadius(200), MAP_RADIUS);
  let prev = 0;
  for (let n = 0; n <= 80; n++) {
    const r = populationRadius(n);
    assert.ok(r >= ARENA_MIN_RADIUS && r <= MAP_RADIUS);
    assert.ok(r >= prev, `croissant (${n} joueurs)`);
    prev = r;
  }
});

test("mur : bien moins rapide qu'un joueur, dans les deux sens", () => {
  assert.ok(ARENA_SHRINK_SPEED * 5 <= PLAYER_SPEED);
  assert.ok(ARENA_GROW_SPEED < PLAYER_SPEED);
  assert.ok(ARENA_SHRINK_NOTICE_MS >= 10_000);
});

test("plus de monde : le mur recule tout de suite, sans annonce ni saut, vite pour un afflux", () => {
  const state = new ArenaState();
  const sizer = new ArenaSizer();
  assert.equal(sizer.current, populationRadius(0));
  populate(state, 3);
  const a = run(sizer, state, 5);
  assert.ok(Math.abs(a.radius - populationRadius(3)) < 1e-6, `rayon ${a.radius}`);
  // Petit écart : à ARENA_GROW_SPEED.
  assert.ok(a.maxGrow <= ARENA_GROW_SPEED * DT + 1e-9);
  // Afflux (une room pleine d'un coup) : la carte entière en moins de 8 s,
  // sans pas plus grand que la moitié de l'écart par seconde.
  populate(state, 57);
  const b = run(sizer, state, 8);
  assert.equal(b.radius, MAP_RADIUS);
  assert.ok(b.maxGrow <= (MAP_RADIUS - populationRadius(3)) * ARENA_GROW_RATE * DT + 1e-9, `pas ${b.maxGrow}`);
  assert.equal(Math.max(a.maxShrink, b.maxShrink), 0);
  assert.equal(state.arenaShrinkAt, 0);
  assert.equal(state.arenaTarget, 0);
});

test("bots : sans place dégagée, ils apparaissent à l'écart, pas empilés au centre", () => {
  // Petite arène pleine d'un coup : plus aucun point à 25 u de tous.
  const state = new ArenaState();
  state.mapRadius = populationRadius(0);
  for (let i = 0; i < 60; i++) {
    const at = randomSpawnPoint(state);
    addPlayer(state, { x: at.x, y: at.y, isBot: true });
  }
  let nearCenter = 0;
  state.players.forEach((p) => { if (Math.hypot(p.x, p.y) < 3) nearCenter++; });
  assert.ok(nearCenter <= 2, `${nearCenter} bots au centre`);
});

test("moins de monde : resserrement annoncé 10 s avant, puis à 1,5 u/s jusqu'à la cible", () => {
  const state = new ArenaState();
  const sizer = new ArenaSizer();
  const ids = populate(state, 40);
  const full = run(sizer, state, 40).radius;
  assert.ok(Math.abs(full - populationRadius(40)) < 1e-6);
  for (const id of ids.slice(3)) state.players.delete(id);
  // La population retenue est la plus haute de la fenêtre : rien ne bouge.
  const held = run(sizer, state, ARENA_POPULATION_WINDOW_MS / 1000 - 1.5);
  assert.equal(held.radius, full);
  assert.equal(state.arenaShrinkAt, 0);
  // Puis l'annonce : la cible, et l'heure où le mur se met en marche.
  run(sizer, state, 2);
  const target = populationRadius(3);
  assert.ok(state.arenaShrinkAt > clock.now, "resserrement annoncé");
  assert.ok(Math.abs(state.arenaTarget - target) < 1e-3);
  const shrinkAt = state.arenaShrinkAt;
  assert.ok(shrinkAt - clock.now > ARENA_SHRINK_NOTICE_MS - 2000);
  // Pendant le préavis, le mur ne bouge pas.
  const notice = run(sizer, state, (shrinkAt - clock.now) / 1000 - 0.05);
  assert.equal(notice.radius, full);
  // Ensuite, jamais plus vite que ARENA_SHRINK_SPEED.
  const moving = run(sizer, state, (full - target) / ARENA_SHRINK_SPEED + 1);
  assert.ok(Math.abs(moving.radius - target) < 1e-6, `rayon ${moving.radius}`);
  assert.ok(moving.maxShrink <= ARENA_SHRINK_SPEED * DT + 1e-9);
  assert.ok(moving.maxShrink > 0);
  assert.equal(moving.maxGrow, 0);
  // Arrivé : plus d'annonce.
  assert.equal(state.arenaShrinkAt, 0);
  assert.equal(state.arenaTarget, 0);
});

test("départs brefs, petits écarts : le mur ne bouge pas", () => {
  const state = new ArenaState();
  const sizer = new ArenaSizer();
  const ids = populate(state, 20);
  const full = run(sizer, state, 20).radius;
  // Un bot qui meurt et revient, un joueur qui se reconnecte : moins de
  // 20 s sous le nombre habituel.
  const gone = ids.slice(5).map((id) => {
    const p = state.players.get(id)!;
    state.players.delete(id);
    return p;
  });
  run(sizer, state, ARENA_POPULATION_WINDOW_MS / 1000 - 3);
  for (const p of gone) state.players.set(p.id, p);
  const after = run(sizer, state, 30);
  assert.equal(after.radius, full);
  assert.equal(after.maxShrink, 0);
  assert.equal(state.arenaShrinkAt, 0);
  // Un joueur de moins sur 11 (un humain parti, ses bots restent) :
  // l'écart est sous le seuil, pas d'annonce.
  for (const id of ids.slice(11)) state.players.delete(id);
  const eleven = run(sizer, state, 60).radius;
  assert.ok(Math.abs(eleven - populationRadius(11)) < 1e-6, `rayon ${eleven}`);
  state.players.delete(ids[0]);
  const ten = run(sizer, state, 40);
  assert.ok(eleven - populationRadius(10) < 4);
  assert.equal(ten.radius, eleven);
  assert.equal(state.arenaShrinkAt, 0);
});

test("une arrivée pendant le préavis annule le resserrement", () => {
  const state = new ArenaState();
  const sizer = new ArenaSizer();
  const ids = populate(state, 40);
  const full = run(sizer, state, 40).radius;
  const gone = ids.slice(3).map((id) => {
    const p = state.players.get(id)!;
    state.players.delete(id);
    return p;
  });
  run(sizer, state, ARENA_POPULATION_WINDOW_MS / 1000 + 2);
  assert.ok(state.arenaShrinkAt > 0);
  for (const p of gone) state.players.set(p.id, p);
  const back = run(sizer, state, 2);
  assert.equal(state.arenaShrinkAt, 0);
  assert.equal(state.arenaTarget, 0);
  assert.equal(back.radius, full);
});

test("room : petite à la création, elle grandit à l'arrivée des joueurs", () => {
  const r = new TestRoom(clock);
  assert.equal(r.state.mapRadius, populationRadius(0));
  for (let i = 0; i < 3; i++) r.join(`p${i}`);
  let prev = r.state.mapRadius;
  let maxStep = 0;
  for (let i = 0; i < 4 * 60; i++) {
    r.tick();
    maxStep = Math.max(maxStep, Math.abs(r.state.mapRadius - prev));
    prev = r.state.mapRadius;
  }
  assert.ok(Math.abs(r.state.mapRadius - populationRadius(3)) < 1e-3, `rayon ${r.state.mapRadius}`);
  assert.ok(maxStep <= ARENA_GROW_SPEED * DT + 1e-4, `pas ${maxStep}`);
  // Les manches partent du même rayon (rounds.test.ts pour le détail).
  const rounds = new TestRoom(clock, { mode: "rounds" });
  for (let i = 0; i < 3; i++) rounds.join(`q${i}`);
  rounds.tick(4 * 60);
  clock.now = rounds.state.phaseEndsAt - ROUND_SHRINK_MS - 1000;
  rounds.tick();
  assert.ok(Math.abs(rounds.state.mapRadius - populationRadius(3)) < 1e-3, `manche ${rounds.state.mapRadius}`);
});

test("modes équipe : la carte entière, quelle que soit la population", () => {
  for (const mode of ["tdm", "ctf"]) {
    const r = new TestRoom(clock, { mode });
    r.join("a");
    r.join("b");
    r.tick(60);
    assert.equal(r.state.mapRadius, MAP_RADIUS, mode);
    assert.equal(r.state.arenaShrinkAt, 0);
  }
});

test("resserrement annoncé : apparitions et butin dans la cible, pas dans la bande condamnée", () => {
  const state = new ArenaState();
  state.mapRadius = 200;
  state.arenaTarget = 150;
  state.arenaShrinkAt = clock.now + ARENA_SHRINK_NOTICE_MS;
  assert.equal(zoneInner(state, 0), 150 - WALL_KILL_THICKNESS);
  for (let i = 0; i < 200; i++) {
    const a = pickSpawnPoint(state);
    const b = randomSpawnPoint(state);
    assert.ok(Math.hypot(a.x, a.y) < 150 - WALL_KILL_THICKNESS, `joueur à ${Math.hypot(a.x, a.y)}`);
    assert.ok(Math.hypot(b.x, b.y) < 150 - WALL_KILL_THICKNESS, `bot à ${Math.hypot(b.x, b.y)}`);
  }
  // Sans annonce, le rayon du moment.
  state.arenaTarget = 0;
  state.arenaShrinkAt = 0;
  assert.equal(zoneInner(state, 0), 200 - WALL_KILL_THICKNESS);
});

test("mur qui avance : caisses et power-ups restés dehors sont retirés", () => {
  const r = new TestRoom(clock);
  r.join("p").x = 0;
  r.tick();
  const kill = r.state.mapRadius - WALL_KILL_THICKNESS;
  const place = <T extends { id: string; x: number; y: number }>(o: T, id: string, d: number): T => {
    o.id = id;
    o.x = d;
    o.y = 0;
    return o;
  };
  r.state.crates.set("in", place(new Crate(), "in", kill - 5));
  r.state.crates.set("out", place(new Crate(), "out", kill + 3));
  r.state.powerups.set("pu-in", place(new PowerUp(), "pu-in", -(kill - 5)));
  r.state.powerups.set("pu-out", place(new PowerUp(), "pu-out", -(kill + 3)));
  r.tick();
  assert.ok(r.state.crates.has("in"));
  assert.ok(!r.state.crates.has("out"));
  assert.ok(r.state.powerups.has("pu-in"));
  assert.ok(!r.state.powerups.has("pu-out"));
});

test("butin : la densité de la carte entière, quelle que soit la taille de l'arène, hors de la bande du mur", () => {
  // Lames au sol, caisses et power-ups une fois les plafonds atteints, dix
  // joueurs groupés au centre.
  const counts = (radius: number) => {
    const state = new ArenaState();
    state.mapRadius = radius;
    for (let i = 0; i < 10; i++) addPlayer(state, { x: -15 + i * 3, y: 0 });
    const spawner = new SpawnSystem();
    const crates = new CrateSystem();
    const powerups = new PowerUpSystem();
    for (let i = 0; i < 30; i++) {
      spawner.update(1, state, false);
      crates.update(60, state, false);
      powerups.update(60, state, false, () => {});
    }
    // Jamais dans la bande que les bots évitent (LOOT_WALL_MARGIN).
    const inner = zoneInner(state, LOOT_WALL_MARGIN);
    for (const o of [...groundBlades(state), ...state.crates.values(), ...state.powerups.values()]) {
      assert.ok(Math.hypot(o.x, o.y) <= inner + 1e-6, `butin à ${Math.hypot(o.x, o.y).toFixed(1)} u (rayon ${radius})`);
    }
    return { blades: groundBlades(state).length, crates: state.crates.size, powerups: state.powerups.size };
  };
  const full = counts(MAP_RADIUS);
  // Moitié du rayon, quart de la surface.
  const small = counts(MAP_RADIUS / 2);
  assert.equal(full.blades, ambientCap(10, false));
  assert.equal(small.blades, Math.round(ambientCap(10, false) / 4));
  assert.ok(Math.abs(small.crates - full.crates / 4) <= 1, `caisses ${small.crates} / ${full.crates}`);
  assert.ok(Math.abs(small.powerups - full.powerups / 4) <= 1, `power-ups ${small.powerups} / ${full.powerups}`);
});
