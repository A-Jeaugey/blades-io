// Tests d'intégration : la room complète, tick par tick, hors réseau.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { CloseCode } from "@colyseus/core";
import {
  BOOST_DROP_BACK,
  DEATH_LOOT_WINDOW_MS,
  BladeRarity,
  CLOSE_CODE_INPUT_FLOOD,
  GROUND_BLADE_TTL_MS,
  MAP_RADIUS,
  PLAYER_SPEED,
  SPAWN_PROTECTION_MS,
  WALL_KILL_THICKNESS,
  outerOrbitRadius,
  tierBladeHitbox,
} from "@bladeio/shared";
import * as matches from "../src/auth/matches";
import * as wallet from "../src/auth/wallet";
import { Blade } from "../src/state/Blade";
import { Crate } from "../src/state/Crate";
import { Player } from "../src/state/Player";
import { attachBladeToPlayer } from "../src/systems/pickup";
import { DT, FakeClock, giveBlade, groundBlades, ownedBlades, seedRandom } from "./helpers";
import { TestRoom } from "./testRoom";

let clock: FakeClock;
let restoreRandom: () => void;
let credits: Array<[string, string, number]>;
let recorded: matches.MatchRecord[];

beforeEach(() => {
  clock = new FakeClock();
  restoreRandom = seedRandom(99);
  credits = [];
  recorded = [];
  // Les modules auth sont remplacés : aucun appel Supabase pendant les tests.
  (wallet as any).creditWallet = async (id: string, n: number) => { credits.push(["user", id, n]); };
  (wallet as any).creditGuestWallet = async (id: string, n: number) => { credits.push(["guest", id, n]); };
  (matches as any).recordMatch = async (rec: matches.MatchRecord) => { recorded.push(rec); };
});
afterEach(() => {
  clock.restore();
  restoreRandom();
});

function fakeClient(sessionId: string) {
  const leaveCodes: number[] = [];
  return { sessionId, leaveCodes, leave: (code: number) => { leaveCodes.push(code); } };
}

function armed(r: TestRoom, id: string, total: number): Player {
  const p = r.join(id);
  while (p.bladeCount < total) giveBlade(r.state, p);
  return p;
}

test("mort : toute l'orbite tombe au sol, avec échéance et verrou", () => {
  const r = new TestRoom(clock);
  const victim = armed(r, "victim", 20);
  const killer = r.join("killer");
  r.room.killPlayer(victim, killer, "blades");
  const drops = groundBlades(r.state);
  assert.equal(drops.length, 20);
  for (const b of drops) {
    assert.equal(b.expiresAt, clock.now + GROUND_BLADE_TTL_MS);
    assert.equal(b.pickupLockUntil, clock.now + 400);
    assert.deepEqual([b.x, b.y], [victim.x, victim.y]);
  }
  assert.equal(victim.alive, false);
  assert.equal(victim.bladeCount, 0);
  assert.equal(ownedBlades(r.state, victim).length, 0);
  assert.equal(killer.kills, 1);
  assert.ok(killer.score >= 15);
  assert.equal(r.eventsOf("playerKilled")[0].killerId, killer.id);
});

// Butin d'une mort : le plus haut nombre de lames de la victime sur les 15
// dernières secondes, pas ce qui lui restait au coup fatal.
test("mort : le butin est le plus haut nombre de lames des 15 dernières secondes", () => {
  const r = new TestRoom(clock);
  const victim = armed(r, "victim", 10);
  r.tick();
  for (const b of ownedBlades(r.state, victim).slice(0, 4)) r.room.handleBladeDestroyed(b);
  r.tick();
  assert.equal(victim.bladeCount, 6);
  r.room.killPlayer(victim, null, "wall");
  assert.equal(groundBlades(r.state).filter((b) => b.expiresAt > 0).length, 10);

  // Pic plus vieux que la fenêtre : le butin retombe à ce qui reste.
  const r2 = new TestRoom(clock);
  const old = armed(r2, "old", 10);
  r2.tick();
  for (const b of ownedBlades(r2.state, old).slice(0, 4)) r2.room.handleBladeDestroyed(b);
  r2.tick(((DEATH_LOOT_WINDOW_MS + 1000) / 1000) * 60);
  assert.equal(old.bladeCount, 6);
  r2.room.killPlayer(old, null, "wall");
  assert.equal(groundBlades(r2.state).filter((b) => b.expiresAt > 0).length, 6);
});

// Le butin d'un combat comprend toutes les lames perdues : plafonné à 12
// avant, tuer une grosse orbite ne rapportait guère plus qu'une petite.
test("mort : toutes les lames perdues au combat tombent, pas seulement 12", () => {
  const r = new TestRoom(clock);
  const victim = armed(r, "victim", 40);
  for (let i = 0; i < 4; i++) giveBlade(r.state, victim, BladeRarity.Legendary);
  r.tick();
  for (const b of ownedBlades(r.state, victim).slice(0, 34)) r.room.handleBladeDestroyed(b);
  r.room.killPlayer(victim, null, "wall");
  // Pic de 44 : 10 en orbite + 34 pertes récentes, raretés comprises.
  const drops = groundBlades(r.state).filter((b) => b.expiresAt > 0);
  assert.equal(drops.length, 44);
  assert.equal(drops.filter((b) => b.rarity === BladeRarity.Legendary).length, 4);
});

// Ce que la victime a laissé dans le monde depuis son pic (traînée de boost,
// lancer) y est déjà : il ne retombe pas une seconde fois à sa mort, même
// ramassé par un autre. Au banc, ce doublon faisait un tiers du butin.
test("mort : la traînée de boost et les lancers ne retombent pas une seconde fois", () => {
  const r = new TestRoom(clock);
  const victim = armed(r, "victim", 20);
  const other = r.join("other");
  victim.x = 0; victim.y = -30;
  r.tick();
  r.room.removePlayerBlades(victim, 5);
  const trail = groundBlades(r.state).filter((b) => b.expiresAt > 0);
  assert.equal(trail.length, 5);
  // Une lame de la traînée chez un autre, une reprise par la victime.
  attachBladeToPlayer(r.state, other, trail[0]);
  attachBladeToPlayer(r.state, victim, trail[1]);
  r.room.handleInput(fakeClient("victim"), { dx: 1, dy: 0, throw: true, aimX: 1, aimY: 0 });
  r.tick();
  assert.equal(r.eventsOf("bladeThrown").length, 1);
  assert.equal(victim.bladeCount, 15);
  const before = new Set(r.state.blades.keys());
  r.room.killPlayer(victim, null, "wall");
  // Pic de 20 : 15 en orbite (lame reprise comprise), 5 encore dans le monde.
  assert.equal(groundBlades(r.state).filter((b) => !before.has(b.id)).length, 15);
});

// Le tueur récupère les lames qu'il a perdues contre sa victime : sinon,
// 100 lames contre 50, on tombait à 50 et on remontait à 100 en ramassant
// son butin, sans rien gagner. Un humain seulement.
test("kill : le tueur récupère les lames qu'il a perdues contre sa victime", () => {
  const r = new TestRoom(clock);
  const killer = armed(r, "killer", 20);
  const victim = armed(r, "victim", 10);
  const other = armed(r, "other", 10);
  const mine = ownedBlades(r.state, killer);
  for (const b of mine.slice(0, 6)) r.room.handleBladeDestroyed(b, victim);
  for (const b of mine.slice(6, 8)) r.room.handleBladeDestroyed(b, other);
  assert.equal(killer.bladeCount, 12);
  r.room.killPlayer(victim, killer, "blades");
  assert.equal(killer.bladeCount, 18, "6 lames rendues, pas celles perdues contre un autre");
  assert.equal(r.eventsOf("playerKilled").at(-1).refund, 6);
  assert.deepEqual(killer.recentLosses.map((l) => l.by), [other.id, other.id]);
  // Pertes plus vieilles que la fenêtre : rien à rendre.
  const late = armed(r, "late", 5);
  for (const b of ownedBlades(r.state, killer).slice(0, 3)) r.room.handleBladeDestroyed(b, late);
  clock.advance(DEATH_LOOT_WINDOW_MS + 1000);
  r.room.killPlayer(late, killer, "blades");
  assert.equal(killer.bladeCount, 15);
  assert.equal(r.eventsOf("playerKilled").at(-1).refund, 0);
  // Un bot n'est pas remboursé : les bots grossissaient entre eux.
  const bot = armed(r, "bot", 10);
  bot.isBot = true;
  const prey = armed(r, "prey", 5);
  for (const b of ownedBlades(r.state, bot).slice(0, 4)) r.room.handleBladeDestroyed(b, prey);
  r.room.killPlayer(prey, bot, "blades");
  assert.equal(bot.bladeCount, 6);
  assert.equal(r.eventsOf("playerKilled").at(-1).refund, 0);
});

test("drops : clignotent puis disparaissent, les lames ambiantes restent", () => {
  const r = new TestRoom(clock);
  const victim = armed(r, "victim", 20);
  const far = r.join("far");
  victim.x = 0; victim.y = -20;
  // Loin, mais dans l'arène à la taille de deux joueurs (tâche 4.5).
  far.x = 100; far.y = 100;
  r.tick(120);
  const ambient = groundBlades(r.state).map((b) => b.id);
  assert.ok(ambient.length > 0);
  r.room.killPlayer(victim, null, "wall");
  const drops = groundBlades(r.state).filter((b) => b.expiresAt > 0);
  assert.equal(drops.length, 20);
  const killedAt = clock.now;
  while (clock.now - killedAt < 13_100) r.tick();
  for (const b of drops) assert.equal(r.state.blades.get(b.id)?.expiring, true);
  while (clock.now - killedAt < 16_100) r.tick();
  for (const b of drops) assert.equal(r.state.blades.has(b.id), false);
  for (const id of ambient) assert.equal(r.state.blades.has(id), true);
});

test("input : valeurs bornées, non finies ignorées, mises en file dans l'ordre", () => {
  const r = new TestRoom(clock);
  const p = r.join("p1");
  r.room.handleInput(fakeClient("p1"), { dx: 5, dy: Number.NEGATIVE_INFINITY, boost: 1, throw: true, seq: 7 });
  assert.deepEqual(p.inputQueue[0], { dx: 1, dy: 0, boost: true, seq: 7 });
  assert.equal(p.inputThrow, true);
  // Sans seq : le suivant. Doublon ou input en retard : ignoré.
  r.room.handleInput(fakeClient("p1"), { dx: Number.NaN, dy: -0.5 });
  r.room.handleInput(fakeClient("p1"), { dx: 1, dy: 1, seq: 8 });
  r.room.handleInput(fakeClient("p1"), { dx: 1, dy: 1, seq: 3 });
  assert.deepEqual(p.inputQueue.map((i: { seq: number }) => i.seq), [7, 8]);
  assert.deepEqual(p.inputQueue[1], { dx: 0, dy: -0.5, boost: false, seq: 8 });
  // Acquitté une fois appliqué.
  r.tick();
  assert.equal(p.lastSeq, 7);
  assert.equal(p.inputDx, 1);
  r.tick();
  assert.equal(p.lastSeq, 8);
});

test("input : mort, les inputs sont acquittés sans être mis en file", () => {
  const r = new TestRoom(clock);
  const p = r.join("p1");
  r.room.killPlayer(p, null, "wall");
  r.room.handleInput(fakeClient("p1"), { dx: 1, dy: 0, seq: 40 });
  assert.equal(p.inputQueue.length, 0);
  assert.equal(p.lastSeq, 40);
});

test("input : visée normalisée, lue seulement avec le lancer", () => {
  const r = new TestRoom(clock);
  const p = r.join("p1");
  // Sans lancer, la visée est ignorée.
  r.room.handleInput(fakeClient("p1"), { dx: 1, dy: 0, aimX: 3, aimY: 4 });
  assert.equal(p.aimX, 0);
  assert.equal(p.aimY, 0);
  r.room.handleInput(fakeClient("p1"), { dx: 1, dy: 0, throw: true, aimX: 3, aimY: 4 });
  assert.equal(p.inputThrow, true);
  assert.ok(Math.abs(p.aimX - 0.6) < 1e-12 && Math.abs(p.aimY - 0.8) < 1e-12);
  // Un message sans lancer arrivé dans le même tick ne l'efface pas.
  r.room.handleInput(fakeClient("p1"), { dx: 1, dy: 0, aimX: -1, aimY: 0 });
  assert.ok(Math.abs(p.aimX - 0.6) < 1e-12);
  // Visée non finie, nulle ou absente : pas de visée, le lancer suivra le
  // déplacement.
  for (const bad of [
    { aimX: Number.NaN, aimY: 1 },
    { aimX: Number.POSITIVE_INFINITY, aimY: 0 },
    { aimX: 0, aimY: 0 },
    { aimX: "1", aimY: {} },
    {},
  ]) {
    r.room.handleInput(fakeClient("p1"), { dx: 1, dy: 0, throw: true, ...bad });
    assert.equal(p.aimX, 0);
    assert.equal(p.aimY, 0);
  }
});

test("lancer visé bout à bout : on lance derrière soi en fuyant", () => {
  const r = new TestRoom(clock);
  const p = r.join("p1");
  p.x = 0; p.y = -30;
  for (let i = 0; i < 5; i++) giveBlade(r.state, p);
  r.room.handleInput(fakeClient("p1"), { dx: 1, dy: 0 });
  r.tick(10);
  r.room.handleInput(fakeClient("p1"), { dx: 1, dy: 0, throw: true, aimX: -1, aimY: 0 });
  r.tick();
  const [ev] = r.eventsOf("bladeThrown");
  assert.ok(ev, "aucun lancer");
  assert.equal(ev.dirX, -1);
  assert.ok(p.dirX > 0.99, "le joueur continue de fuir vers +x");
  const blade = r.state.blades.get(ev.bladeId)!;
  assert.ok(blade.vx < 0 && blade.x < p.x);
});

test("input : un joueur muet s'arrête dès qu'il n'envoie plus rien", () => {
  // Un input vaut un pas : un client déconnecté ou un onglet en arrière-plan
  // ne glisse plus sur son dernier input (500 ms avant la tâche 1.2).
  const r = new TestRoom(clock);
  const p = r.join("p1");
  p.x = 0; p.y = -20;
  r.room.handleInput(fakeClient("p1"), { dx: 1, dy: 0 });
  r.tick(120);
  assert.ok(Math.abs(p.x - PLAYER_SPEED * DT) < 1e-9, `x = ${p.x}`);
});

test("anti-flood : 200 inputs/s expulsent en 3 s, 60/s jamais", () => {
  const r = new TestRoom(clock);
  r.join("flood");
  r.join("normal");
  const flood = fakeClient("flood");
  const start = clock.now;
  let kickedAfter = -1;
  while (clock.now - start < 5000 && kickedAfter < 0) {
    clock.advance(5);
    r.room.handleInput(flood, { dx: 0, dy: 0 });
    if (flood.leaveCodes.length > 0) kickedAfter = clock.now - start;
  }
  assert.deepEqual(flood.leaveCodes, [CLOSE_CODE_INPUT_FLOOD]);
  assert.ok(kickedAfter >= 2900 && kickedAfter <= 3200, `expulsé après ${kickedAfter} ms`);

  const normal = fakeClient("normal");
  for (let i = 0; i < 600; i++) {
    clock.advance(1000 / 60);
    r.room.handleInput(normal, { dx: 0, dy: 0 });
  }
  assert.deepEqual(normal.leaveCodes, []);
});

test("anti-flood : deux rafales de 2 s séparées d'une seconde normale ne font pas expulser", () => {
  const r = new TestRoom(clock);
  r.join("bursty");
  const bursty = fakeClient("bursty");
  const send = (ms: number, perSecond: number) => {
    const end = clock.now + ms;
    while (clock.now < end) {
      clock.advance(1000 / perSecond);
      r.room.handleInput(bursty, { dx: 0, dy: 0 });
    }
  };
  send(2000, 200);
  send(1000, 60);
  send(2000, 200);
  send(500, 60);
  assert.deepEqual(bursty.leaveCodes, []);
});

test("trophées : crédités en fin de vie en public, jamais en privé ni pour un bot", async () => {
  const pub = new TestRoom(clock);
  const guest = pub.join("guest", { guestId: "g-1" });
  guest.score = 50;
  pub.room.killPlayer(guest, null, "wall");
  const user = pub.join("user", { userId: "u-1" });
  user.score = 30;
  pub.room.killPlayer(user, null, "wall");
  const leaver = pub.join("leaver", { guestId: "g-3" });
  leaver.score = 12;
  await pub.room.onLeave({ sessionId: "leaver" }, CloseCode.CONSENTED);
  const broke = pub.join("broke", { guestId: "g-4" });
  broke.score = 0;
  pub.room.killPlayer(broke, null, "wall");
  assert.deepEqual(credits, [["guest", "g-1", 50], ["user", "u-1", 30], ["guest", "g-3", 12]]);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].userId, "u-1");
  assert.equal(recorded[0].score, 30);

  credits = [];
  recorded = [];
  const priv = new TestRoom(clock, { code: "ABCDE" });
  const friend = priv.join("friend", { guestId: "g-2" });
  friend.score = 50;
  priv.room.killPlayer(friend, null, "wall");
  const bot = pub.join("bot", { guestId: "g-5" });
  bot.isBot = true;
  bot.score = 40;
  pub.room.killPlayer(bot, null, "wall");
  assert.deepEqual(credits, []);
  assert.deepEqual(recorded, []);
});

test("trophées : un ramassage juste avant la mort ne réduit pas le score crédité", () => {
  const r = new TestRoom(clock);
  const p = r.join("p1", { guestId: "g-9" });
  p.kills = 3;
  r.tick(); // updateScore : 3 × 15 + record de 3 lames
  const composite = p.score;
  giveBlade(r.state, p);
  r.room.killPlayer(p, null, "wall");
  assert.deepEqual(credits, [["guest", "g-9", composite]]);
});

test("respawn : 3 lames, statistiques remises à zéro, protection de spawn", () => {
  const r = new TestRoom(clock);
  const p = armed(r, "p1", 12);
  p.kills = 3;
  r.room.killPlayer(p, null, "wall");
  r.room.handleRespawn(fakeClient("p1"), {});
  assert.equal(p.alive, true);
  assert.equal(p.bladeCount, 3);
  assert.equal(ownedBlades(r.state, p).length, 3);
  assert.equal(p.kills, 0);
  assert.equal(p.maxBladeCount, 3);
  assert.equal(p.spawnProtectionUntil, clock.now + SPAWN_PROTECTION_MS);
});

test("boost : les lames les moins rares sont dépensées en premier", () => {
  const r = new TestRoom(clock);
  const p = r.join("p1"); // 3 Common
  const legendary = giveBlade(r.state, p, BladeRarity.Legendary);
  const rare = giveBlade(r.state, p, BladeRarity.Rare);
  r.room.removePlayerBlades(p, 3);
  const left = (): Blade[] => ownedBlades(r.state, p);
  assert.deepEqual(left().map((b) => b.id).sort(), [legendary.id, rare.id].sort());
  r.room.removePlayerBlades(p, 1);
  assert.deepEqual(left().map((b) => b.id), [legendary.id]);
  assert.equal(p.bladeCount, 1);
});

// Lames de boost (tâche 4.13) : elles se posent juste derrière le joueur,
// dans l'axe de la course, comme la traînée de slither.io.
test("boost : les lames dépensées se posent juste derrière le joueur", () => {
  const r = new TestRoom(clock);
  const p = armed(r, "p1", 20);
  p.x = 0; p.y = 0;
  p.moveVx = 18.7; p.moveVy = 0;
  r.room.removePlayerBlades(p, 2);
  assert.equal(p.bladeCount, 18);
  const drops = groundBlades(r.state).filter((b) => b.expiresAt > 0);
  assert.equal(drops.length, 2);
  for (const b of drops) {
    assert.ok(Math.abs(b.x + BOOST_DROP_BACK) < 1e-9, `juste derrière : x = ${b.x}`);
    assert.ok(Math.abs(b.y) <= 0.4 + 1e-9, "dans l'axe de la course");
    assert.ok(b.vx < 0, "élan vers l'arrière");
    assert.equal(b.expiresAt, clock.now + GROUND_BLADE_TTL_MS);
  }
});

// Bout à bout : sa traînée est une lame au sol comme les autres, pour lui
// aussi ; la reprendre coûte un demi-tour.
test("boost : demi-tour sur sa traînée, la lame se reprend", () => {
  const r = new TestRoom(clock);
  const runner = armed(r, "runner", 10);
  runner.x = 0; runner.y = -30;
  let seq = 0;
  const step = (dx: number, boost: boolean) => {
    runner.inputQueue.push({ dx, dy: 0, boost, seq: ++seq });
    r.tick();
  };
  const drops = () => groundBlades(r.state).filter((b) => b.expiresAt > 0);
  // Une seconde de boost : deux lames semées derrière lui.
  for (let i = 0; i < 62; i++) step(1, true);
  const trail = drops();
  assert.equal(trail.length, 2, "deux lames semées");
  assert.equal(runner.bladeCount, 8);
  // Demi-tour à pied sur toute la traînée.
  for (let i = 0; i < 120; i++) step(-1, false);
  assert.deepEqual(trail.map((b) => b.ownerId), [runner.id, runner.id]);
  assert.equal(runner.bladeCount, 10);
});

// Le poursuivant la ramasse en passant (le coureur parti ailleurs).
test("boost : la traînée nourrit le poursuivant", () => {
  const r = new TestRoom(clock);
  const runner = armed(r, "runner", 10);
  const chaser = r.join("chaser");
  runner.x = 0; runner.y = -30;
  chaser.x = -40; chaser.y = -30;
  for (let i = 0; i < 70; i++) {
    runner.inputQueue.push({ dx: 1, dy: 0, boost: true, seq: i + 1 });
    r.tick();
  }
  const drops = groundBlades(r.state).filter((b) => b.expiresAt > 0);
  assert.equal(drops.length, 2);
  runner.y = 60;
  chaser.x = -20;
  for (let i = 0; i < 360; i++) {
    chaser.inputQueue.push({ dx: 1, dy: 0, boost: false, seq: i + 1 });
    r.tick();
  }
  assert.deepEqual(drops.map((b) => b.ownerId), [chaser.id, chaser.id]);
});

test("tick : tier recalculé d'après le nombre de lames, avec un évènement tierUp", () => {
  const r = new TestRoom(clock);
  const p = armed(r, "p1", 10);
  p.x = 0; p.y = -20;
  // armed() tient le tier à jour ; on repart de l'état d'avant le tick.
  p.tier = 0;
  r.tick();
  assert.equal(p.tier, 1);
  assert.deepEqual(r.eventsOf("tierUp").map((e) => [e.playerId, e.tier]), [[p.id, 1]]);
});

test("clash : l'évènement désigne les lames et leurs propriétaires", () => {
  // Le client s'en sert pour faire flasher les deux lames et reconnaître un
  // clash du joueur local (aId/bId sont des ids de lame).
  const r = new TestRoom(clock);
  const p1 = armed(r, "p1", 3);
  const p2 = armed(r, "p2", 3);
  p1.x = 0; p1.y = -20;
  p2.x = 3.4; p2.y = -20;
  for (let i = 0; i < 120 && r.eventsOf("clash").length === 0; i++) r.tick();
  const [ev] = r.eventsOf("clash");
  assert.ok(ev, "aucun clash");
  const owners = new Map([...ownedBlades(r.state, p1), ...ownedBlades(r.state, p2)].map((b) => [b.id, b.ownerId]));
  // Une lame détruite dans le clash n'est plus dans l'état : on vérifie
  // celles qui restent, et que les deux joueurs sont bien désignés.
  for (const [blade, owner] of [[ev.aId, ev.aOwnerId], [ev.bId, ev.bOwnerId]]) {
    if (owners.has(blade)) assert.equal(owners.get(blade), owner);
  }
  assert.deepEqual(new Set([ev.aOwnerId, ev.bOwnerId]), new Set([p1.id, p2.id]));
  // Lame brisée dans ce clash : l'évènement désigne l'autre joueur.
  for (const d of r.eventsOf("bladeDestroyed")) {
    assert.equal(d.byId, d.ownerId === p1.id ? p2.id : p1.id);
  }
});

test("hitlag : pris en étau pendant 3 s, moins de 30 % du temps figé, et on s'en extrait", () => {
  // Tâche 1.6. Les reculs venus des deux côtés s'annulent : le contact
  // dure. Avant, les gels s'enchaînaient (40 % du temps figé, jusqu'à 50 %)
  // et les reculs empilés projetaient les joueurs à plus de 20 u.
  const r = new TestRoom(clock);
  const left = r.join("left");
  const mid = r.join("mid");
  const right = r.join("right");
  for (let i = 0; i < 30; i++) {
    giveBlade(r.state, left, BladeRarity.Common);
    giveBlade(r.state, mid, BladeRarity.Legendary);
    giveBlade(r.state, right, BladeRarity.Common);
  }
  left.x = -12; mid.x = 0; right.x = 12;
  left.y = mid.y = right.y = -40;
  const press = (midDy: number) => {
    r.room.handleInput(fakeClient("left"), { dx: 1, dy: 0 });
    r.room.handleInput(fakeClient("mid"), { dx: 0, dy: midDy });
    r.room.handleInput(fakeClient("right"), { dx: -1, dy: 0 });
    r.tick();
  };
  while (r.eventsOf("clash").length === 0) press(0);
  let frozen = 0;
  let widest = 0;
  for (let i = 0; i < 180; i++) {
    press(0);
    if (mid.hitlagUntil > clock.now) frozen++;
    widest = Math.max(widest, mid.x - left.x, right.x - mid.x);
  }
  assert.ok(frozen / 180 < 0.3, `figé ${((100 * frozen) / 180).toFixed(1)} %`);
  assert.ok(widest < 15, `écart ${widest.toFixed(1)} u`);
  // Il fuit à la perpendiculaire, les deux autres pressent toujours.
  const reach = (a: Player, b: Player) =>
    outerOrbitRadius(a.bladeCount) + tierBladeHitbox(a.tier) + outerOrbitRadius(b.bladeCount) + tierBladeHitbox(b.tier);
  let escapedAfter = -1;
  for (let i = 0; i < 60 && escapedAfter < 0; i++) {
    press(1);
    const free = Math.hypot(mid.x - left.x, mid.y - left.y) > reach(mid, left) &&
      Math.hypot(mid.x - right.x, mid.y - right.y) > reach(mid, right);
    if (free) escapedAfter = i + 1;
  }
  assert.equal(mid.alive, true);
  assert.ok(escapedAfter > 0, "toujours pris dans l'étau après 1 s");
});

test("mur : une lame désintégrée est signalée au-delà du bord de l'arène", () => {
  // Le client reconnaît une lame détruite par le mur à sa position
  // (WALL_ZAP_RADIUS dans client/src/main.ts) : ce test fige ce contrat.
  const r = new TestRoom(clock);
  const p = armed(r, "p1", 3);
  // Le bord du moment : l'arène suit la population (tâche 4.5), le temps
  // qu'elle atteigne la taille d'un joueur.
  r.tick(60);
  const killRadius = r.state.mapRadius - WALL_KILL_THICKNESS;
  p.x = killRadius - 1; // corps dans l'arène, orbite (1,8 u) qui déborde
  p.y = 0;
  // Un tour d'orbite complet (≤ 1,6 s au plus lent), quelle que soit la
  // phase tirée au spawn : chaque lame passe côté mur.
  r.tick(100);
  const events = r.eventsOf("bladeDestroyed");
  assert.equal(events.length, 3);
  for (const e of events) assert.ok(Math.hypot(e.x, e.y) > killRadius - 0.5, `rayon ${Math.hypot(e.x, e.y)}`);
  // Personne n'a brisé ces lames.
  for (const e of events) assert.equal(e.byId, undefined);
  assert.equal(p.alive, true);
});

test("tick : l'état publie l'heure du serveur (référence des échéances côté client)", () => {
  const r = new TestRoom(clock);
  r.tick();
  assert.equal(r.state.serverTime, clock.now);
  const p = r.join("p1");
  // Les échéances sont dans la même horloge que serverTime.
  assert.ok(Math.abs(p.spawnedAt - r.state.serverTime) < 50);
});

test("évènements : cause de chaque mort, auteur d'une caisse brisée", () => {
  // Le client en tire le fil des éliminations et les gains flottants
  // (tâche 3.4), puis la cause affichée à la mort (3.5).
  const r = new TestRoom(clock);
  const a = armed(r, "a", 5);
  for (const cause of ["blades", "throw", "wall"] as const) {
    const victim = r.join(`v-${cause}`);
    r.room.killPlayer(victim, cause === "wall" ? null : a, cause);
  }
  assert.deepEqual(
    r.eventsOf("playerKilled").map((e) => [e.cause, e.killerId, e.killerName, e.victimBlades, e.killerBlades]),
    [["blades", "a", a.name, 3, 5], ["throw", "a", a.name, 3, 5], ["wall", null, "GRID BORDER", 3, null]],
  );
  // Lames perdues juste avant le coup fatal : comptées dans le rapport de
  // force (la victime en avait 3 au début de l'échange).
  const fighter = r.join("fighter");
  r.room.removePlayerBlades(fighter, 3);
  fighter.recentLosses = [1, 2, 3].map(() => ({ rarity: 0, ts: clock.now - 500, by: "a" }));
  r.room.killPlayer(fighter, a, "blades");
  const last = r.eventsOf("playerKilled").at(-1);
  assert.equal(last.victimBlades, 3);
  const crate = new Crate();
  crate.id = "c1";
  crate.x = 10; crate.y = 10;
  r.state.crates.set(crate.id, crate);
  r.room.handleCrateDestroyed(crate, a);
  const [destroyed] = r.eventsOf("crateDestroyed");
  assert.equal(destroyed.byId, "a");
  assert.equal(a.cratesDestroyed, 1);
});
