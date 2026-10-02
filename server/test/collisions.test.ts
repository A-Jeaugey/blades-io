import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  BladeRarity,
  CRATE_HP,
  HITLAG_COOLDOWN_MS,
  KNOCKBACK_MAX_SPEED,
  outerOrbitRadius,
  tierBladeHitbox,
  tierHitlagMs,
  tierKnockback,
} from "@bladeio/shared";
import { ArenaState } from "../src/state/ArenaState";
import { Blade } from "../src/state/Blade";
import { Crate } from "../src/state/Crate";
import { Player } from "../src/state/Player";
import { ClashInfo, CollisionCallbacks, resolveCollisions } from "../src/systems/collisions";
import { OrbitPositionCache } from "../src/systems/orbitPositions";
import { FakeClock, addPlayer, giveBlade, ownedBlades, uid } from "./helpers";

let clock: FakeClock;
let state: ArenaState;
let cache: OrbitPositionCache;
let cooldowns: Map<string, number>;

beforeEach(() => {
  clock = new FakeClock();
  state = new ArenaState();
  cache = new OrbitPositionCache();
  cooldowns = new Map();
});
afterEach(() => clock.restore());

interface Recorder extends CollisionCallbacks {
  destroyed: Blade[];
  // Lame détruite → joueur qui l'a brisée.
  breakers: Map<string, string | null>;
  kills: Array<{ victim: Player; killer: Player | null }>;
  clashes: ClashInfo[];
  crateHits: Crate[];
  cratesDestroyed: Crate[];
}

// Reproduit ce que fait la room : une lame détruite quitte l'état, un
// joueur tué n'est plus vivant.
function recorder(): Recorder {
  const r: Recorder = {
    destroyed: [],
    breakers: new Map(),
    kills: [],
    clashes: [],
    crateHits: [],
    cratesDestroyed: [],
    onBladeDestroyed: (b, by) => { r.destroyed.push(b); r.breakers.set(b.id, by?.id ?? null); state.blades.delete(b.id); },
    onPlayerKilled: (victim, killer) => { r.kills.push({ victim, killer }); victim.alive = false; },
    onCrateHit: (c) => { r.crateHits.push(c); },
    onCrateDestroyed: (c) => { r.cratesDestroyed.push(c); },
    onClash: (info) => { r.clashes.push(info); },
  };
  return r;
}

// A en (0, 0) et B en (4, 0), une lame chacun, placées sur leur anneau
// (rayon 1,8) face à face : les lames se touchent, pas les corps.
function duel(rarityA: BladeRarity, rarityB: BladeRarity) {
  const a = addPlayer(state, { x: 0, y: 0, rarity: rarityA, blades: 1 });
  const b = addPlayer(state, { x: 4, y: 0, rarity: rarityB, blades: 1 });
  const [bladeA] = ownedBlades(state, a);
  const [bladeB] = ownedBlades(state, b);
  cache.set(bladeA.id, 1.8, 0);
  cache.set(bladeB.id, 2.2, 0);
  return { a, b, bladeA, bladeB };
}

test("clash : chaque lame encaisse les dégâts de la rareté adverse", () => {
  const { a, b, bladeA, bladeB } = duel(BladeRarity.Legendary, BladeRarity.Common);
  const r = recorder();
  resolveCollisions(state, cache, r, cooldowns);
  assert.equal(bladeA.hp, 8 - 1);
  assert.deepEqual(r.destroyed.map((b) => b.id), [bladeB.id]);
  assert.equal(r.clashes.length, 1);
  assert.equal(r.clashes[0].destroyed, 1);
  assert.equal(r.kills.length, 0);
  // Chaque lame est accompagnée de son propriétaire.
  const owners = new Map<string, string>([
    [r.clashes[0].a.id, r.clashes[0].aOwner.id],
    [r.clashes[0].b.id, r.clashes[0].bOwner.id],
  ]);
  assert.deepEqual(owners, new Map([[bladeA.id, a.id], [bladeB.id, b.id]]));
  // La lame brisée désigne le joueur dont la lame l'a cassée.
  assert.equal(r.breakers.get(bladeB.id), a.id);
});

test("clash entre deux Epic : les deux lames cassent", () => {
  const { a, b, bladeA, bladeB } = duel(BladeRarity.Epic, BladeRarity.Epic);
  const r = recorder();
  resolveCollisions(state, cache, r, cooldowns);
  assert.deepEqual(new Set(r.destroyed.map((b) => b.id)), new Set([bladeA.id, bladeB.id]));
  assert.equal(r.clashes[0].destroyed, 2);
  assert.deepEqual(r.breakers, new Map([[bladeA.id, b.id], [bladeB.id, a.id]]));
});

test("le power-up Shield divise les dégâts reçus par deux, 1 minimum", () => {
  const first = duel(BladeRarity.Epic, BladeRarity.Epic);
  first.b.shieldUntil = clock.now + 1000;
  resolveCollisions(state, cache, recorder(), cooldowns);
  assert.equal(first.bladeB.hp, 4 - 2);

  state = new ArenaState();
  cache = new OrbitPositionCache();
  const second = duel(BladeRarity.Common, BladeRarity.Rare);
  second.b.shieldUntil = clock.now + 1000;
  resolveCollisions(state, cache, recorder(), cooldowns);
  assert.equal(second.bladeB.hp, 2 - 1);
});

test("une même paire de lames ne clashe qu'une fois toutes les 0,2 s", () => {
  // PV = dégâts de la rareté : sans Shield, deux Rare cassent au premier
  // coup. Avec Shield des deux côtés, chacune perd 1 PV par clash.
  const { a, b, bladeA, bladeB } = duel(BladeRarity.Rare, BladeRarity.Rare);
  a.shieldUntil = clock.now + 10_000;
  b.shieldUntil = clock.now + 10_000;
  const r = recorder();
  resolveCollisions(state, cache, r, cooldowns);
  resolveCollisions(state, cache, r, cooldowns);
  assert.equal(bladeA.hp, 1);
  assert.equal(bladeB.hp, 1);
  clock.advance(250);
  resolveCollisions(state, cache, r, cooldowns);
  assert.equal(r.destroyed.length, 2);
  assert.equal(r.clashes.length, 2);
});

test("protection de spawn : ni clash ni dégâts", () => {
  const { a, bladeA, bladeB } = duel(BladeRarity.Rare, BladeRarity.Rare);
  a.spawnProtectionUntil = clock.now + 1000;
  const r = recorder();
  resolveCollisions(state, cache, r, cooldowns);
  assert.equal(r.clashes.length, 0);
  assert.equal(bladeA.hp, 2);
  assert.equal(bladeB.hp, 2);
});

test("un clash applique hitlag et knockback aux deux joueurs", () => {
  const { a, b } = duel(BladeRarity.Legendary, BladeRarity.Legendary);
  resolveCollisions(state, cache, recorder(), cooldowns);
  assert.equal(a.hitlagUntil, clock.now + tierHitlagMs(0));
  assert.equal(b.hitlagUntil, clock.now + tierHitlagMs(0));
  // A est à gauche de B : repoussé vers -x, B vers +x.
  assert.equal(a.knockbackVx, -tierKnockback(0));
  assert.equal(b.knockbackVx, tierKnockback(0));
});

test("hitlag : un seul gel à la fois, puis 250 ms de liberté", () => {
  const { a, b } = duel(BladeRarity.Legendary, BladeRarity.Common);
  // La Common de B casse à chaque clash : on lui en redonne une au même
  // endroit, et on ignore le délai par paire de lames.
  const clashAgain = () => {
    const blade = giveBlade(state, b, BladeRarity.Common);
    cache.set(blade.id, 2.2, 0);
    resolveCollisions(state, cache, recorder(), new Map());
  };
  resolveCollisions(state, cache, recorder(), cooldowns);
  const firstEnd = clock.now + tierHitlagMs(0);
  assert.equal(a.hitlagUntil, firstEnd);
  // Un clash pendant le gel ne le prolonge pas.
  clock.advance(30);
  clashAgain();
  assert.equal(a.hitlagUntil, firstEnd);
  // Pas de nouveau gel avant 250 ms de liberté...
  clock.advance(firstEnd + HITLAG_COOLDOWN_MS - 1 - clock.now);
  clashAgain();
  assert.equal(a.hitlagUntil, firstEnd);
  // ... puis de nouveau.
  clock.advance(1);
  clashAgain();
  assert.equal(a.hitlagUntil, clock.now + tierHitlagMs(0));
  assert.equal(b.hitlagUntil, clock.now + tierHitlagMs(0));
});

test("recul : les clashs s'additionnent, vitesse plafonnée", () => {
  const { a } = duel(BladeRarity.Legendary, BladeRarity.Legendary);
  a.knockbackVx = -20;
  a.knockbackVy = 0;
  resolveCollisions(state, cache, recorder(), cooldowns);
  assert.equal(a.knockbackVx, -KNOCKBACK_MAX_SPEED);
});

test("une lame qui touche un corps tue, le propriétaire est crédité", () => {
  const a = addPlayer(state, { x: 0, y: 0, blades: 1 });
  const b = addPlayer(state, { x: 2.5, y: 0 });
  cache.set(ownedBlades(state, a)[0].id, 1.8, 0);
  const r = recorder();
  resolveCollisions(state, cache, r, cooldowns);
  assert.equal(r.kills.length, 1);
  assert.equal(r.kills[0].victim, b);
  assert.equal(r.kills[0].killer, a);
});

test("corps à corps : un joueur sans lame meurt contre un joueur armé", () => {
  const a = addPlayer(state, { x: 0, y: 0 });
  const b = addPlayer(state, { x: 0.8, y: 0, blades: 1 });
  // Lame de B du côté opposé à A : seul le contact des corps compte.
  cache.set(ownedBlades(state, b)[0].id, 2.6, 0);
  const r = recorder();
  resolveCollisions(state, cache, r, cooldowns);
  assert.deepEqual(r.kills.map((k) => [k.victim.id, k.killer?.id]), [[a.id, b.id]]);
});

test("corps à corps : deux joueurs sans lame meurent tous les deux", () => {
  const a = addPlayer(state, { x: 0, y: 0 });
  const b = addPlayer(state, { x: 0.8, y: 0 });
  const r = recorder();
  resolveCollisions(state, cache, r, cooldowns);
  assert.deepEqual(new Set(r.kills.map((k) => k.victim.id)), new Set([a.id, b.id]));
});

test("débutant en grâce : les bots ne le tuent pas, un humain si ; après, si", () => {
  // Première partie, 10 s de grâce (tâche 4.5) : « les bots te laissent
  // tranquille », lames et corps compris.
  const bot = addPlayer(state, { x: 0, y: 0, blades: 1, isBot: true });
  const newbie = addPlayer(state, { x: 2.5, y: 0 });
  newbie.newcomer = true;
  newbie.graceUntil = clock.now + 5000;
  const blade = ownedBlades(state, bot)[0];
  cache.set(blade.id, 1.8, 0);
  let r = recorder();
  resolveCollisions(state, cache, r, cooldowns);
  assert.equal(r.kills.length, 0);
  // Corps à corps contre un bot sans lame (le bot armé à l'écart) :
  // personne ne meurt.
  bot.x = -50;
  cache.set(blade.id, -48.2, 0);
  const bare = addPlayer(state, { x: 3.3, y: 0, isBot: true });
  r = recorder();
  resolveCollisions(state, cache, r, cooldowns);
  assert.equal(r.kills.length, 0);
  state.players.delete(bare.id);
  bot.x = 0;
  cache.set(blade.id, 1.8, 0);
  // Un humain, lui, le tue.
  bot.isBot = false;
  r = recorder();
  resolveCollisions(state, cache, r, cooldowns);
  assert.deepEqual(r.kills.map((k) => k.victim.id), [newbie.id]);
  // Grâce finie : un bot aussi.
  newbie.alive = true;
  bot.isBot = true;
  newbie.graceUntil = 0;
  r = recorder();
  resolveCollisions(state, cache, r, cooldowns);
  assert.deepEqual(r.kills.map((k) => k.victim.id), [newbie.id]);
});

test("caisse : dégâts de la rareté, destruction à 0 PV", () => {
  const a = addPlayer(state, { x: 0, y: 0, rarity: BladeRarity.Legendary, blades: 1 });
  cache.set(ownedBlades(state, a)[0].id, 1.8, 0);
  const crate = new Crate();
  crate.id = uid("c");
  crate.x = 2.5;
  crate.y = 0;
  crate.hp = CRATE_HP;
  crate.maxHp = CRATE_HP;
  state.crates.set(crate.id, crate);
  const r = recorder();
  resolveCollisions(state, cache, r, cooldowns);
  assert.equal(crate.hp, CRATE_HP - 8);
  assert.equal(r.crateHits.length, 1);
  clock.advance(250);
  resolveCollisions(state, cache, r, cooldowns);
  assert.equal(crate.hp, 0);
  assert.equal(r.cratesDestroyed.length, 1);
});

// Le filtre de la zone de contact (narrowPhaseClash) ne doit écarter
// aucune paire qui se touche : même liste de clashs, dans le même ordre,
// que le test de toutes les paires. Lames indestructibles pour que chaque
// paire au contact donne un clash.
test("grosses orbites : tous les clashs du test de toutes les paires, dans l'ordre", () => {
  const a = addPlayer(state, { x: 0, y: 0, blades: 300 });
  const b = addPlayer(state, { x: 14, y: 0, blades: 300 });
  const R = outerOrbitRadius(300);
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const place = (p: Player): Blade[] => ownedBlades(state, p).map((blade) => {
    const angle = rand() * Math.PI * 2;
    const r = R * Math.sqrt(rand());
    cache.set(blade.id, p.x + Math.cos(angle) * r, p.y + Math.sin(angle) * r);
    blade.hp = 1000;
    return blade;
  });
  const bladesA = place(a);
  const bladesB = place(b);
  // Anneau extérieur resté occupé après des pertes à l'intérieur : au-delà
  // du rayon que donne le nombre de lames.
  cache.set(bladesA[0].id, R + 4, 0);
  const reach = tierBladeHitbox(a.tier) + tierBladeHitbox(b.tier);
  const expected: string[] = [];
  for (const ba of bladesA) {
    const pa = cache.get(ba.id)!;
    for (const bb of bladesB) {
      const pb = cache.get(bb.id)!;
      if (Math.hypot(pa.x - pb.x, pa.y - pb.y) <= reach) expected.push(`${ba.id}|${bb.id}`);
    }
  }
  const r = recorder();
  resolveCollisions(state, cache, r, cooldowns);
  assert.ok(expected.length > 1000);
  assert.ok(expected.some((k) => k.startsWith(`${bladesA[0].id}|`)));
  assert.deepEqual(r.clashes.map((c) => `${c.a.id}|${c.b.id}`), expected);
});
