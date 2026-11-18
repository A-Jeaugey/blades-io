// Décor interactif (2026-11-18) : racks à butin et obélisques qui se
// chargent puis lâchent une onde (shared/src/interactive.ts,
// server/src/systems/interactive.ts).
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  CrateKind,
  INITIAL_BLADE_COUNT,
  PULSE_CHARGE,
  PULSE_COOLDOWN_MS,
  PULSE_KNOCKBACK,
  PULSE_OBELISKS,
  PULSE_PLAYER_DPS,
  PULSE_RADIUS,
  PULSE_REGEN_DELAY_MS,
  PULSE_SHED_MAX,
  PULSE_WARNING_MS,
  RACK_HP,
  RACK_LOOT_MAX,
  RACK_LOOT_MIN,
  RACK_RESPAWN_MS,
  RACK_SITES,
  TEAM_NONE,
  pulseShedCount,
  resolveDecorCollision,
  PLAYER_BODY_RADIUS,
} from "@bladeio/shared";
import * as matches from "../src/auth/matches";
import * as wallet from "../src/auth/wallet";
import * as telemetry from "../src/telemetry";
import { ArenaState } from "../src/state/ArenaState";
import { Crate } from "../src/state/Crate";
import { Player } from "../src/state/Player";
import { BotController } from "../src/systems/bots";
import { DT, FakeClock, addPlayer, giveBlade, groundBlades, seedRandom } from "./helpers";
import { TestRoom } from "./testRoom";

let clock: FakeClock;
let restoreRandom: () => void;

beforeEach(() => {
  clock = new FakeClock();
  restoreRandom = seedRandom(77);
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

const RACK = RACK_SITES[0];
const OBELISK = PULSE_OBELISKS[0];
// Collé à la pièce, là où le premier anneau la frappe sans que son collider
// repousse le corps.
const RACK_STAND = 1.95;
const OBELISK_STAND = 2.35;

function sites(state: ArenaState, kind: number): Crate[] {
  const out: Crate[] = [];
  state.crates.forEach((c) => { if (c.kind === kind) out.push(c); });
  return out;
}

function withBlades(r: TestRoom, id: string, x: number, y: number, blades: number): Player {
  const p = r.join(id);
  p.x = x;
  p.y = y;
  for (let i = p.bladeCount; i < blades; i++) giveBlade(r.state, p);
  return p;
}

function seconds(r: TestRoom, s: number): void {
  r.tick(Math.round(s / DT));
}

test("les pièces sont en place dès le premier tick, à leurs positions de la carte", () => {
  const r = new TestRoom(clock);
  r.join("a");
  r.tick();
  const racks = sites(r.state, CrateKind.Rack);
  const obelisks = sites(r.state, CrateKind.Obelisk);
  assert.equal(racks.length, RACK_SITES.length);
  assert.equal(obelisks.length, PULSE_OBELISKS.length);
  for (const c of racks) {
    assert.ok(RACK_SITES.some((s) => s.x === c.x && s.y === c.y), "rack hors de sa place");
    assert.equal(c.hp, RACK_HP);
    assert.equal(c.maxHp, RACK_HP);
  }
  for (const c of obelisks) {
    assert.ok(PULSE_OBELISKS.some((s) => Math.abs(s.x - c.x) < 1e-4 && Math.abs(s.y - c.y) < 1e-4), "obélisque hors de sa place");
    assert.equal(c.hp, PULSE_CHARGE);
  }
});

test("les points d'où l'on frappe une pièce ne sont pas dans son collider", () => {
  // Sinon le serveur repousserait le joueur et ces tests ne frapperaient rien.
  for (const [x, y] of [[RACK.x, RACK.y + RACK_STAND], [OBELISK.x, OBELISK.y + OBELISK_STAND]]) {
    const out = resolveDecorCollision(x, y, PLAYER_BODY_RADIUS);
    assert.ok(Math.hypot(out.x - x, out.y - y) < 1e-6);
  }
});

test("rack : cassé, il lâche son butin, compte comme une caisse, puis se recharge", () => {
  const r = new TestRoom(clock);
  const a = withBlades(r, "a", RACK.x, RACK.y + RACK_STAND, 14);
  r.tick();
  const rack = sites(r.state, CrateKind.Rack).find((c) => c.x === RACK.x && c.y === RACK.y)!;
  const id = rack.id;
  let loot = -1;
  for (let i = 0; i < 20 / DT && loot < 0; i++) {
    r.tick();
    if (r.state.crates.has(id)) continue;
    // Butin projeté depuis le bord du rack, au tick même.
    loot = groundBlades(r.state).filter((b) => Math.hypot(b.x - RACK.x, b.y - RACK.y) < 3 && b.pickupLockUntil > clock.now).length;
  }
  assert.ok(loot >= RACK_LOOT_MIN && loot <= RACK_LOOT_MAX, `butin ${loot}`);
  assert.equal(a.cratesDestroyed, 1);
  assert.equal(r.eventsOf("crateDestroyed").filter((e) => e.crateId === id).length, 1);

  // Le joueur s'en va : sinon il le recasserait aussitôt revenu.
  a.x += 30;
  clock.advance(RACK_RESPAWN_MS - 2000);
  r.tick();
  assert.equal(r.state.crates.has(id), false, "revenu trop tôt");
  clock.advance(2100);
  r.tick();
  assert.equal(r.state.crates.get(id)?.hp, RACK_HP);
});

test("obélisque : la charge d'un joueur est plafonnée, quelle que soit son orbite", () => {
  const r = new TestRoom(clock);
  withBlades(r, "a", OBELISK.x, OBELISK.y + OBELISK_STAND, 60);
  r.tick();
  const ob = sites(r.state, CrateKind.Obelisk).find((c) => Math.abs(c.x - OBELISK.x) < 1e-4)!;
  seconds(r, 1);
  assert.ok(ob.hp < PULSE_CHARGE, "aucune lame ne l'a touché");
  // Une seconde : la réserve de départ (une seconde d'avance) plus ce qui
  // s'est rempli depuis.
  assert.ok(ob.hp >= PULSE_CHARGE - 2 * PULSE_PLAYER_DPS - 5, `chargé trop vite : ${PULSE_CHARGE - ob.hp} en 1 s`);
  assert.ok(r.state.crates.has(ob.id), "armé en une seconde");
});

test("obélisque : délaissé, sa charge retombe", () => {
  const r = new TestRoom(clock);
  const a = withBlades(r, "a", OBELISK.x, OBELISK.y + OBELISK_STAND, 20);
  r.tick();
  const ob = sites(r.state, CrateKind.Obelisk).find((c) => Math.abs(c.x - OBELISK.x) < 1e-4)!;
  seconds(r, 0.6);
  const charged = ob.hp;
  assert.ok(charged < PULSE_CHARGE);
  a.x += 40;
  seconds(r, PULSE_REGEN_DELAY_MS / 1000 - 0.3);
  assert.equal(ob.hp, charged, "retombe avant le délai");
  seconds(r, 6);
  assert.equal(ob.hp, PULSE_CHARGE);
});

test("obélisque : chargé à fond il s'arme, puis l'onde repousse et désarme les autres, pas son auteur", () => {
  const r = new TestRoom(clock);
  const a = withBlades(r, "a", OBELISK.x, OBELISK.y + OBELISK_STAND, 10);
  // Dans le rayon : un joueur établi, un nouveau venu à ses lames de
  // départ, un joueur encore protégé. Dehors : un témoin.
  // Assez loin les uns des autres pour que leurs orbites ne se touchent pas.
  const b = withBlades(r, "b", OBELISK.x + 8, OBELISK.y, 20);
  const c = withBlades(r, "c", OBELISK.x - 8, OBELISK.y, INITIAL_BLADE_COUNT);
  const e = withBlades(r, "e", OBELISK.x, OBELISK.y - 8, 10);
  const d = withBlades(r, "d", OBELISK.x, OBELISK.y - (PULSE_RADIUS + 9), 10);
  e.spawnProtectionUntil = clock.now + 60_000;
  r.tick();
  const ob = sites(r.state, CrateKind.Obelisk).find((x) => Math.abs(x.x - OBELISK.x) < 1e-4)!;
  const id = ob.id;
  ob.hp = 1;

  for (let i = 0; i < 3 / DT && r.eventsOf("obeliskArmed").length === 0; i++) r.tick();
  const armed = r.eventsOf("obeliskArmed");
  assert.equal(armed.length, 1);
  assert.equal(armed[0].byId, "a");
  assert.equal(armed[0].delayMs, PULSE_WARNING_MS);
  assert.equal(armed[0].radius, PULSE_RADIUS);
  assert.equal(r.state.crates.has(id), false);
  // Ni points ni caisse cassée : ce n'est pas du butin.
  assert.equal(a.cratesDestroyed, 0);
  assert.equal(r.eventsOf("crateDestroyed").filter((ev) => ev.crateId === id).length, 0);

  // Pendant le préavis, rien.
  seconds(r, PULSE_WARNING_MS / 1000 - 0.15);
  assert.equal(r.eventsOf("obeliskPulse").length, 0);
  assert.equal(b.bladeCount, 20);

  const groundBefore = groundBlades(r.state).length;
  for (let i = 0; i < 0.5 / DT && r.eventsOf("obeliskPulse").length === 0; i++) r.tick();
  const pulse = r.eventsOf("obeliskPulse");
  assert.equal(pulse.length, 1);
  assert.deepEqual([...pulse[0].hit].sort(), ["b", "c"]);

  // b : repoussé plein est, un cinquième de ses lames au sol.
  assert.equal(b.bladeCount, 20 - pulseShedCount(20));
  assert.equal(pulseShedCount(20), 4);
  assert.ok(Math.abs(Math.hypot(b.knockbackVx, b.knockbackVy) - PULSE_KNOCKBACK) < 1e-3);
  assert.ok(b.knockbackVx > 0.95 * PULSE_KNOCKBACK);
  assert.ok(groundBlades(r.state).length >= groundBefore + 4);
  assert.ok(b.released.length >= 4, "lames tombées non relevées (recordRelease)");
  // c : repoussé, mais un nouveau venu ne perd rien.
  assert.equal(c.bladeCount, INITIAL_BLADE_COUNT);
  assert.ok(c.knockbackVx < -0.95 * PULSE_KNOCKBACK);
  // Auteur, joueur protégé, joueur hors du rayon : rien.
  for (const p of [a, e, d]) {
    assert.equal(p.bladeCount, 10, p.id);
    assert.equal(Math.hypot(p.knockbackVx, p.knockbackVy), 0, p.id);
  }

  // Il revient après son repos, déchargé.
  clock.advance(PULSE_COOLDOWN_MS - 2000);
  r.tick();
  assert.equal(r.state.crates.has(id), false, "revenu trop tôt");
  clock.advance(2100);
  a.x += 40;
  r.tick();
  assert.equal(r.state.crates.get(id)?.hp, PULSE_CHARGE);
});

test("onde : les lames perdues sont plafonnées pour les géants", () => {
  assert.equal(pulseShedCount(0), 0);
  assert.equal(pulseShedCount(4), 0);
  assert.equal(pulseShedCount(5), 1);
  assert.equal(pulseShedCount(500), PULSE_SHED_MAX);
});

test("onde en mode équipe : elle épargne les alliés de son auteur", () => {
  const r = new TestRoom(clock, { mode: "tdm" });
  const a = withBlades(r, "a", OBELISK.x, OBELISK.y + OBELISK_STAND, 10);
  const p1 = withBlades(r, "p1", OBELISK.x + 8, OBELISK.y, 20);
  const p2 = withBlades(r, "p2", OBELISK.x - 8, OBELISK.y, 20);
  assert.notEqual(a.team, TEAM_NONE);
  const ally = p1.team === a.team ? p1 : p2;
  const foe = ally === p1 ? p2 : p1;
  assert.equal(ally.team, a.team);
  assert.notEqual(foe.team, a.team);
  // L'apparition de l'équipe a pu les déplacer : remis en place.
  a.x = OBELISK.x; a.y = OBELISK.y + OBELISK_STAND;
  p1.x = OBELISK.x + 8; p1.y = OBELISK.y;
  p2.x = OBELISK.x - 8; p2.y = OBELISK.y;
  r.tick();
  const ob = sites(r.state, CrateKind.Obelisk).find((x) => Math.abs(x.x - OBELISK.x) < 1e-4)!;
  ob.hp = 1;
  for (let i = 0; i < 4 / DT && r.eventsOf("obeliskPulse").length === 0; i++) r.tick();
  const pulse = r.eventsOf("obeliskPulse");
  assert.equal(pulse.length, 1);
  assert.deepEqual(pulse[0].hit, [foe.id]);
  assert.equal(ally.bladeCount, 20);
  assert.equal(foe.bladeCount, 20 - pulseShedCount(20));
});

test("une pièce hors de l'arène du moment ne revient pas", () => {
  const r = new TestRoom(clock);
  r.join("a");
  r.tick();
  const far = Math.max(...RACK_SITES.map((s) => Math.hypot(s.x, s.y)));
  // Arène resserrée sous le rack le plus lointain, puis manche suivante.
  for (const id of [...r.state.crates.keys()]) r.state.crates.delete(id);
  r.state.mapRadius = far - 2;
  r.room.interactive.reset();
  r.tick();
  const back = sites(r.state, CrateKind.Rack);
  assert.ok(back.length < RACK_SITES.length, "rack remis hors de l'arène");
  for (const c of back) assert.ok(Math.hypot(c.x, c.y) < far - 2);
});

test("bots : ils récoltent un rack, pas un obélisque", () => {
  const state = new ArenaState();
  const bots = new BotController() as any;
  const bot = addPlayer(state, { x: OBELISK.x + 8, y: OBELISK.y, blades: 6, isBot: true });
  const ob = new Crate();
  ob.id = "obelisk-0";
  ob.kind = CrateKind.Obelisk;
  ob.x = OBELISK.x;
  ob.y = OBELISK.y;
  ob.hp = ob.maxHp = PULSE_CHARGE;
  state.crates.set(ob.id, ob);
  const st = { personality: 0 };
  assert.equal(bots.scoreFarmCrates(bot, state, st), null);
  ob.kind = CrateKind.Rack;
  const farm = bots.scoreFarmCrates(bot, state, st);
  assert.equal(farm?.type, "farm_crate");
});
