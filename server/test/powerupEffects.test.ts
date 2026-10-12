// Power-ups rééquilibrés (retours de jeu du 2026-10-12) : Speed court et
// net, Aimant qui attire de loin et vite, Spin qui frappe plus fort, durée
// de l'effet envoyée au ramassage, effets visibles des autres joueurs.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  BladeRarity,
  CRATE_HP,
  PICKUP_MAGNET_RADIUS,
  PICKUP_MAGNET_STRENGTH,
  PLAYER_BOOST_MULT,
  PLAYER_SPEED,
  POWERUP_DURATION,
  POWERUP_MAGNET_MULT,
  POWERUP_MAGNET_PULL,
  POWERUP_MAGNET_PULL_EDGE,
  POWERUP_SPEED_BOOST_CAP,
  POWERUP_SPEED_DURATION,
  POWERUP_SPEED_MULT,
  PowerUpType,
  THROW_PROJECTILE_SPEED,
  basePowerUpDuration,
  powerUpBit,
  powerUpDurationMs,
  stepMovement,
} from "@bladeio/shared";
import { ArenaState } from "../src/state/ArenaState";
import { Crate } from "../src/state/Crate";
import { PowerUp } from "../src/state/PowerUp";
import { CollisionCallbacks, resolveCollisions } from "../src/systems/collisions";
import { updateMovement } from "../src/systems/movement";
import { OrbitPositionCache, updateBladePositions } from "../src/systems/orbitPositions";
import { PowerUpSystem } from "../src/systems/powerups";
import { DT, FakeClock, addGroundBlade, addPlayer, ownedBlades, seedRandom, uid } from "./helpers";
import { TestRoom } from "./testRoom";

const RARITIES = [BladeRarity.Common, BladeRarity.Rare, BladeRarity.Epic, BladeRarity.Legendary];

let clock: FakeClock;
let restoreRandom: () => void;

beforeEach(() => {
  clock = new FakeClock();
  restoreRandom = seedRandom(11);
});
afterEach(() => {
  clock.restore();
  restoreRandom();
});

// Pose un power-up sous le joueur ; renvoie la durée annoncée au ramassage.
function pickUp(state: ArenaState, sys: PowerUpSystem, type: PowerUpType, rarity: BladeRarity): number {
  const p = state.players.values().next().value!;
  const pu = new PowerUp();
  pu.id = uid("pu");
  pu.type = type;
  pu.rarity = rarity;
  pu.x = p.x;
  pu.y = p.y;
  state.powerups.set(pu.id, pu);
  let duration = -1;
  sys.update(0, state, false, (_p, _pu, ms) => { duration = ms; });
  return duration;
}

test("durées : Speed court (4 à 8 s), les autres inchangés, améliorations comprises", () => {
  assert.deepEqual(RARITIES.map((r) => basePowerUpDuration(PowerUpType.Speed, r)), [4, 5, 6.5, 8]);
  for (const type of [PowerUpType.Spin, PowerUpType.Magnet, PowerUpType.Shield]) {
    assert.deepEqual(RARITIES.map((r) => basePowerUpDuration(type, r)), RARITIES.map((r) => POWERUP_DURATION[r]));
  }
  assert.equal(powerUpDurationMs(PowerUpType.Speed, BladeRarity.Epic), 6500);
  // +2,5 % par niveau, +50 % au niveau 20.
  assert.equal(powerUpDurationMs(PowerUpType.Speed, BladeRarity.Legendary, 20), 12_000);
  assert.equal(powerUpDurationMs(PowerUpType.Speed, BladeRarity.Common, 10), 5000);
  // Même amélioré au maximum, aucun effet ne dépasse 30 s (tâche 4.3)...
  for (const type of [PowerUpType.Speed, PowerUpType.Spin, PowerUpType.Magnet, PowerUpType.Shield]) {
    for (const r of RARITIES) assert.ok(powerUpDurationMs(type, r) <= 30_000);
  }
  // ... et Speed reste le plus court.
  for (const r of RARITIES) assert.ok(POWERUP_SPEED_DURATION[r] < POWERUP_DURATION[r]);
});

test("Speed : +60 % de vitesse, et le boost s'y ajoute sous un plafond", () => {
  const free = { speed: false, frozen: false, canBoost: true };
  const run = (speed: boolean, boost: boolean) => {
    const body = { x: 0, y: 0, knockbackVx: 0, knockbackVy: 0 };
    const res = stepMovement(body, { dx: 1, dy: 0, boost }, { ...free, speed }, 1);
    return res.speed;
  };
  assert.ok(Math.abs(run(true, false) - PLAYER_SPEED * POWERUP_SPEED_MULT) < 1e-9);
  // Nettement visible : presque le boost, sans en payer le prix.
  assert.ok(POWERUP_SPEED_MULT >= 1.6);
  assert.ok(Math.abs(run(false, true) - PLAYER_SPEED * PLAYER_BOOST_MULT) < 1e-9);
  const both = run(true, true);
  assert.ok(Math.abs(both - PLAYER_SPEED * POWERUP_SPEED_BOOST_CAP) < 1e-9, `${both}`);
  // Le boost ajoute encore quelque chose sous Speed...
  assert.ok(both > run(true, false) * 1.2);
  // ... sans qu'un lancer cesse de rattraper une cible qui fuit tout droit,
  // ni qu'un pas dépasse le rayon du corps.
  assert.ok(both < THROW_PROJECTILE_SPEED * 0.7);
  assert.ok(both * DT < 0.6);
});

test("Speed : un joueur sous l'effet avance plus vite, un pas par input (serveur)", () => {
  const state = new ArenaState();
  const fast = addPlayer(state, { x: 0, y: -20 });
  const slow = addPlayer(state, { x: 0, y: -30 });
  fast.speedUntil = clock.now + 5000;
  for (const p of [fast, slow]) p.inputDx = 1;
  for (let i = 0; i < 60; i++) {
    clock.advance(DT * 1000);
    for (const p of [fast, slow]) p.inputQueue.push({ dx: 1, dy: 0, boost: false, seq: ++p.lastQueuedSeq });
    updateMovement(DT, state, () => {});
  }
  assert.ok(Math.abs(slow.x - PLAYER_SPEED) < 1e-6, `lent ${slow.x}`);
  assert.ok(Math.abs(fast.x - PLAYER_SPEED * POWERUP_SPEED_MULT) < 1e-6, `rapide ${fast.x}`);
  assert.ok(Math.abs(fast.moveVx - PLAYER_SPEED * POWERUP_SPEED_MULT) < 1e-6);
});

test("aimant : rayon ×3,5 et lames attirées bien plus vite pendant l'effet", () => {
  const state = new ArenaState();
  const p = addPlayer(state, { x: 0, y: -20 });
  const radius = PICKUP_MAGNET_RADIUS * POWERUP_MAGNET_MULT;
  assert.ok(radius >= PICKUP_MAGNET_RADIUS * 3);
  const far = addGroundBlade(state, { x: radius - 0.5, y: -20 });
  const near = addGroundBlade(state, { x: -4, y: -20 });
  // Sans l'effet : la lame lointaine ne bouge pas, la proche vient doucement.
  updateBladePositions(DT, 0, state, new OrbitPositionCache());
  assert.equal(far.x, radius - 0.5);
  const slowPull = near.x - -4;
  assert.ok(Math.abs(slowPull - PICKUP_MAGNET_STRENGTH * (1 - 4 / PICKUP_MAGNET_RADIUS) * DT) < 1e-6);

  near.x = -4;
  p.magnetUntil = clock.now + 1000;
  updateBladePositions(DT, 1, state, new OrbitPositionCache());
  // Au bord du rayon, au moins la vitesse d'un joueur qui marche : la lame
  // le rattrape.
  const edgeSpeed = (radius - 0.5 - far.x) / DT;
  assert.ok(edgeSpeed >= POWERUP_MAGNET_PULL * POWERUP_MAGNET_PULL_EDGE - 1e-6, `bord ${edgeSpeed}`);
  assert.ok(edgeSpeed > PLAYER_SPEED);
  // De près, plus de deux fois plus vite qu'avec l'aimant ordinaire.
  const fastPull = near.x - -4;
  assert.ok(fastPull > slowPull * 2, `${fastPull} vs ${slowPull}`);
  // Une lame à 18 u arrive en un peu plus d'une seconde, joueur à l'arrêt.
  const blade = addGroundBlade(state, { x: 0, y: -2 });
  p.magnetUntil = clock.now + 5000;
  let t = 0;
  while (Math.hypot(blade.x - p.x, blade.y - p.y) > 2.8 && t < 3) {
    updateBladePositions(DT, 2, state, new OrbitPositionCache());
    t += DT;
  }
  assert.ok(t < 1.5, `${t.toFixed(2)} s`);
});

function collisionRecorder(state: ArenaState): CollisionCallbacks & { destroyed: string[] } {
  const r = {
    destroyed: [] as string[],
    onBladeDestroyed: (b: any) => { r.destroyed.push(b.id); state.blades.delete(b.id); },
    onPlayerKilled: (victim: any) => { victim.alive = false; },
    onCrateHit: () => {},
    onCrateDestroyed: () => {},
    onClash: () => {},
  };
  return r;
}

// A en (0, 0) et B en (4, 0), une lame chacun, face à face sur leur anneau.
function duel(state: ArenaState, cache: OrbitPositionCache, rarityA: BladeRarity, rarityB: BladeRarity) {
  const a = addPlayer(state, { x: 0, y: 0, rarity: rarityA, blades: 1 });
  const b = addPlayer(state, { x: 4, y: 0, rarity: rarityB, blades: 1 });
  const [bladeA] = ownedBlades(state, a);
  const [bladeB] = ownedBlades(state, b);
  cache.set(bladeA.id, 1.8, 0);
  cache.set(bladeB.id, 2.2, 0);
  return { a, b, bladeA, bladeB };
}

test("Spin : ×1,5 dégâts (arrondi au supérieur) en clash, le Bouclier d'en face s'applique ensuite", () => {
  // Sans Spin, une Commune ne fait qu'entamer une Rare.
  let state = new ArenaState();
  let cache = new OrbitPositionCache();
  let d = duel(state, cache, BladeRarity.Common, BladeRarity.Rare);
  resolveCollisions(state, cache, collisionRecorder(state), new Map());
  assert.equal(d.bladeB.hp, 1);

  // Avec : 2 dégâts, la Rare casse d'un coup ; la Commune, elle, encaisse
  // comme d'habitude (Spin n'est pas une protection).
  state = new ArenaState();
  cache = new OrbitPositionCache();
  d = duel(state, cache, BladeRarity.Common, BladeRarity.Rare);
  d.a.spinUntil = clock.now + 1000;
  let rec = collisionRecorder(state);
  resolveCollisions(state, cache, rec, new Map());
  assert.deepEqual(new Set(rec.destroyed), new Set([d.bladeA.id, d.bladeB.id]));

  // Épique sous Spin : 6 dégâts, une Légendaire tombe à 2 PV ; contre un
  // Bouclier, 3.
  for (const [shield, left] of [[false, 2], [true, 5]] as const) {
    state = new ArenaState();
    cache = new OrbitPositionCache();
    d = duel(state, cache, BladeRarity.Epic, BladeRarity.Legendary);
    d.a.spinUntil = clock.now + 1000;
    if (shield) d.b.shieldUntil = clock.now + 1000;
    resolveCollisions(state, cache, collisionRecorder(state), new Map());
    assert.equal(d.bladeB.hp, left, shield ? "contre un Bouclier" : "sans Bouclier");
  }

  // Effet fini : dégâts ordinaires.
  state = new ArenaState();
  cache = new OrbitPositionCache();
  d = duel(state, cache, BladeRarity.Epic, BladeRarity.Legendary);
  d.a.spinUntil = clock.now - 1;
  resolveCollisions(state, cache, collisionRecorder(state), new Map());
  assert.equal(d.bladeB.hp, 4);
});

test("Spin : les caisses aussi encaissent ×1,5", () => {
  const state = new ArenaState();
  const cache = new OrbitPositionCache();
  const a = addPlayer(state, { x: 0, y: 0, rarity: BladeRarity.Common, blades: 1 });
  cache.set(ownedBlades(state, a)[0].id, 1.8, 0);
  const crate = new Crate();
  crate.id = uid("c");
  crate.x = 2.5;
  crate.y = 0;
  crate.hp = CRATE_HP;
  crate.maxHp = CRATE_HP;
  state.crates.set(crate.id, crate);
  const cooldowns = new Map<string, number>();
  resolveCollisions(state, cache, collisionRecorder(state), cooldowns);
  assert.equal(crate.hp, CRATE_HP - 1);
  a.spinUntil = clock.now + 5000;
  clock.advance(250);
  resolveCollisions(state, cache, collisionRecorder(state), cooldowns);
  assert.equal(crate.hp, CRATE_HP - 1 - 2);
});

test("ramassage : la durée appliquée (amélioration comprise) part avec l'évènement", () => {
  const r = new TestRoom(clock);
  const p = r.join("p1");
  p.powerUpLevels[PowerUpType.Speed] = 10;
  const place = (type: PowerUpType, rarity: BladeRarity) => {
    const pu = new PowerUp();
    pu.id = uid("pu");
    pu.type = type;
    pu.rarity = rarity;
    pu.x = p.x;
    pu.y = p.y;
    r.state.powerups.set(pu.id, pu);
    r.tick();
    return r.eventsOf("powerupPickup").at(-1);
  };
  const speed = place(PowerUpType.Speed, BladeRarity.Legendary);
  assert.equal(speed.type, PowerUpType.Speed);
  assert.equal(speed.durationMs, powerUpDurationMs(PowerUpType.Speed, BladeRarity.Legendary, 10));
  assert.equal(speed.durationMs, 10_000);
  // speedUntil posé au tick du ramassage, horloge déjà avancée d'un pas.
  assert.ok(Math.abs(p.speedUntil - clock.now - 10_000) < 1, `${p.speedUntil - clock.now}`);
  const shield = place(PowerUpType.Shield, BladeRarity.Rare);
  assert.equal(shield.durationMs, POWERUP_DURATION[BladeRarity.Rare] * 1000);
  const blades = place(PowerUpType.Blades, BladeRarity.Epic);
  assert.equal(blades.durationMs, 0);
});

test("effets visibles de tous : un bit par effet actif, retiré à la fin et à la mort", () => {
  const state = new ArenaState();
  const sys = new PowerUpSystem();
  const p = addPlayer(state, { blades: 3 });
  assert.equal(pickUp(state, sys, PowerUpType.Speed, BladeRarity.Common), 4000);
  assert.equal(p.activeEffects, powerUpBit(PowerUpType.Speed));
  pickUp(state, sys, PowerUpType.Magnet, BladeRarity.Common);
  assert.equal(p.activeEffects, powerUpBit(PowerUpType.Speed) | powerUpBit(PowerUpType.Magnet));
  clock.advance(4001);
  sys.update(DT, state, false, () => {});
  assert.equal(p.activeEffects, powerUpBit(PowerUpType.Magnet));
  p.alive = false;
  sys.update(DT, state, false, () => {});
  assert.equal(p.activeEffects, 0);
});

test("respawn : les effets de la vie précédente ne suivent pas", () => {
  const r = new TestRoom(clock);
  const p = r.join("p1");
  p.speedUntil = clock.now + 8000;
  p.spinUntil = clock.now + 25_000;
  p.magnetUntil = clock.now + 25_000;
  p.shieldUntil = clock.now + 25_000;
  r.room.killPlayer(p, null, "wall");
  r.room.handleRespawn({ sessionId: "p1", send: () => {} }, {});
  assert.equal(p.alive, true);
  assert.deepEqual([p.speedUntil, p.spinUntil, p.magnetUntil, p.shieldUntil], [0, 0, 0, 0]);
  r.tick();
  assert.equal(p.activeEffects, 0);
});
