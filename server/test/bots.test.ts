import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  BUSHES,
  BladeThrownEvent,
  MAP_RADIUS,
  SPAWN_GRACE_CHASE_RADIUS,
  SPAWN_GRACE_MS,
  SPAWN_GRACE_RAMP_MS,
  WALL_KILL_THICKNESS,
} from "@bladeio/shared";
import { ArenaState } from "../src/state/ArenaState";
import { Crate } from "../src/state/Crate";
import { Player } from "../src/state/Player";
import { BotController, BotPersonality } from "../src/systems/bots";
import { updateMovement } from "../src/systems/movement";
import { processThrows } from "../src/systems/throws";
import { DT, FakeClock, addGroundBlade, addPlayer, seedRandom } from "./helpers";

let clock: FakeClock;
let state: ArenaState;
let bots: BotController;
let restoreRandom: () => void;

beforeEach(() => {
  clock = new FakeClock();
  state = new ArenaState();
  bots = new BotController();
  restoreRandom = seedRandom(1234);
});
afterEach(() => {
  clock.restore();
  restoreRandom();
});

function simulate(seconds: number, onTick: () => void): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    clock.advance(DT * 1000);
    bots.update(DT, state);
    updateMovement(DT, state, (p: Player, n: number) => { p.bladeCount -= n; });
    onTick();
  }
}

test("nombre de bots : on complète jusqu'à 15 joueurs, 10 bots maximum", () => {
  assert.equal(bots.desiredBotCount(state), 10);
  for (let i = 0; i < 7; i++) addPlayer(state);
  assert.equal(bots.desiredBotCount(state), 8);
  addPlayer(state, { isBot: true });
  assert.equal(bots.desiredBotCount(state), 8);
  for (let i = 0; i < 8; i++) addPlayer(state);
  assert.equal(bots.desiredBotCount(state), 0);
});

test("fuite entre deux menaces symétriques : le bot part sur le côté, sans lancer", () => {
  const bot = addPlayer(state, { x: 0, y: -100, blades: 3, isBot: true });
  addPlayer(state, { x: -10, y: -100, blades: 20 });
  addPlayer(state, { x: 10, y: -100, blades: 20 });
  bots.update(DT, state);
  assert.ok(Math.hypot(bot.inputDx, bot.inputDy) > 0.99);
  // Les menaces s'annulent sur l'axe x : la fuite se fait à la perpendiculaire.
  assert.ok(Math.abs(bot.inputDy) > Math.abs(bot.inputDx));
  assert.equal(bot.inputThrow, false);
});

test("fuite acculé au mur : le bot ne se bloque pas et ne touche pas la zone de mort", () => {
  const bot = addPlayer(state, { x: 0, y: -232, blades: 3, isBot: true });
  const enemy = addPlayer(state, { x: 0, y: -215, blades: 30 });
  const killRadius = MAP_RADIUS - WALL_KILL_THICKNESS;
  let maxRadius = 0;
  let idleTicks = 0;
  let escaped = false;
  let prevX = bot.x;
  let prevY = bot.y;
  simulate(6, () => {
    maxRadius = Math.max(maxRadius, Math.hypot(bot.x, bot.y));
    if (Math.hypot(bot.x - prevX, bot.y - prevY) < 1e-3) idleTicks++;
    prevX = bot.x;
    prevY = bot.y;
    if (Math.hypot(bot.x - enemy.x, bot.y - enemy.y) > 25) escaped = true;
  });
  assert.equal(idleTicks, 0);
  assert.ok(maxRadius < killRadius - 5, `rayon max ${maxRadius}`);
  assert.ok(escaped, "le bot n'est jamais sorti du rayon de menace");
});

test("près du bord, un bot n'avance jamais vers l'extérieur", () => {
  const bot = addPlayer(state, { x: 0, y: -230, blades: 3, isBot: true });
  addPlayer(state, { x: 0, y: -215, blades: 30 });
  bots.update(DT, state);
  // Décision de fuite vers le bord ; un knockback le pousse ensuite à 239 u
  // avant la prochaine décision : le filet de sécurité le renvoie au centre.
  assert.ok(bot.inputDy < 0);
  bot.y = -239;
  clock.advance(DT * 1000);
  bots.update(DT, state);
  assert.ok(bot.inputDy > 0.99, `inputDy = ${bot.inputDy}`);
});

// La personnalité est tirée au hasard à la création de l'état du bot (au
// premier update) : on la fixe ensuite et on force une nouvelle décision.
function setPersonality(bot: Player, personality: BotPersonality): void {
  bots.update(DT, state);
  const internals = bots as unknown as { state: Map<string, { personality: BotPersonality; nextThinkAt: number }> };
  const st = internals.state.get(bot.id)!;
  st.personality = personality;
  st.nextThinkAt = 0;
  bot.inputThrow = false;
  bot.aimX = 0;
  bot.aimY = 0;
}

function throwNow(): BladeThrownEvent[] {
  const thrown: BladeThrownEvent[] = [];
  processThrows(state, {
    onBladeThrown: (ev) => { thrown.push(ev); },
    onProjectileImpact: () => {},
    onPlayerKilled: () => {},
    onCrateHit: () => {},
    onCrateDestroyed: () => {},
    onBladeDestroyed: () => {},
  });
  return thrown;
}

function angleTo(fromX: number, fromY: number, x: number, y: number, dirX: number, dirY: number): number {
  let d = Math.atan2(dirY, dirX) - Math.atan2(y - fromY, x - fromX);
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

test("visée des bots : en fuite, un Hunter lance derrière lui sur son poursuivant", () => {
  const bot = addPlayer(state, { x: 0, y: -100, blades: 6, isBot: true });
  const threat = addPlayer(state, { x: 15, y: -100, blades: 30 });
  setPersonality(bot, BotPersonality.Hunter);
  clock.advance(DT * 1000);
  bots.update(DT, state);
  assert.equal(bot.inputThrow, true);
  assert.ok(bot.inputDx < -0.9, `fuite vers -x, inputDx = ${bot.inputDx}`);
  const err = angleTo(bot.x, bot.y, threat.x, threat.y, bot.aimX, bot.aimY);
  assert.ok(err <= 0.18 + 1e-9, `erreur de visée ${err}`);
  const [ev] = throwNow();
  assert.ok(ev.dirX >= Math.cos(0.18) - 1e-9, `le projectile part vers le poursuivant, dirX = ${ev.dirX}`);
});

test("visée des bots : en fuite, un Farmer court sans lancer", () => {
  const bot = addPlayer(state, { x: 0, y: -100, blades: 12, isBot: true });
  addPlayer(state, { x: 15, y: -100, blades: 30 });
  setPersonality(bot, BotPersonality.Farmer);
  clock.advance(DT * 1000);
  bots.update(DT, state);
  assert.ok(bot.inputDx < -0.9);
  assert.equal(bot.inputThrow, false);
});

test("visée des bots : en chasse, la visée suit la cible, pas la marche", () => {
  const bot = addPlayer(state, { x: 0, y: -100, blades: 10, isBot: true });
  const prey = addPlayer(state, { x: 12, y: -84, blades: 3 });
  setPersonality(bot, BotPersonality.Hunter);
  clock.advance(DT * 1000);
  bots.update(DT, state);
  assert.equal(bot.inputThrow, true);
  const err = angleTo(bot.x, bot.y, prey.x, prey.y, bot.aimX, bot.aimY);
  assert.ok(err <= 0.18 + 1e-9, `erreur de visée ${err}`);
});

test("visée des bots : pas de lancer en errance, même avec un joueur à portée", () => {
  const bot = addPlayer(state, { x: 0, y: -100, blades: 10, isBot: true });
  addPlayer(state, { x: 20, y: -100, blades: 10 });
  setPersonality(bot, BotPersonality.Farmer);
  clock.advance(DT * 1000);
  bots.update(DT, state);
  assert.equal(bot.inputThrow, false);
});

test("visée des bots : un Farmer vise la caisse qu'il récolte", () => {
  const bot = addPlayer(state, { x: 0, y: -100, blades: 12, isBot: true });
  const crate = new Crate();
  crate.id = "c1";
  crate.x = 0;
  crate.y = -80;
  crate.hp = crate.maxHp = 10;
  state.crates.set(crate.id, crate);
  setPersonality(bot, BotPersonality.Farmer);
  clock.advance(DT * 1000);
  bots.update(DT, state);
  assert.equal(bot.inputThrow, true);
  const err = angleTo(bot.x, bot.y, crate.x, crate.y, bot.aimX, bot.aimY);
  assert.ok(err <= 0.3 + 1e-9, `erreur de visée ${err}`);
});

// Période de grâce (tâche 3.2) : un joueur apparu depuis moins de 10 s
// n'est ni poursuivi, ni visé, ni gêné dans sa récolte.
function decision(bot: Player): string {
  const internals = bots as unknown as { state: Map<string, { actionType: string; nextThinkAt: number }> };
  return internals.state.get(bot.id)!.actionType;
}

function rethink(bot: Player): void {
  const internals = bots as unknown as { state: Map<string, { nextThinkAt: number }> };
  internals.state.get(bot.id)!.nextThinkAt = 0;
  clock.advance(DT * 1000);
  bots.update(DT, state);
}

test("grâce : un bot ne poursuit ni ne vise un joueur apparu depuis peu, puis si", () => {
  const bot = addPlayer(state, { x: 0, y: -100, blades: 10, isBot: true });
  const prey = addPlayer(state, { x: 12, y: -84, blades: 3 });
  prey.graceUntil = clock.now + SPAWN_GRACE_MS;
  setPersonality(bot, BotPersonality.Hunter);
  rethink(bot);
  assert.notEqual(decision(bot), "chase");
  assert.equal(bot.inputThrow, false);
  // Grâce terminée (délai écoulé, lancer ou contact) : une proie comme une
  // autre.
  prey.graceUntil = 0;
  rethink(bot);
  assert.equal(decision(bot), "chase");
  assert.equal(bot.inputThrow, true);
  assert.equal(bots.isChasing(bot.id, prey.id), true);
});

test("grâce : après les 10 s, le nouveau venu n'est d'abord poursuivi que de près", () => {
  const bot = addPlayer(state, { x: 0, y: -100, blades: 10, isBot: true });
  const prey = addPlayer(state, { x: 50, y: -100, blades: 3 });
  // Grâce écoulée, début de la rampe : rayon de poursuite réduit.
  prey.graceUntil = clock.now;
  prey.graceRampUntil = clock.now + SPAWN_GRACE_RAMP_MS;
  setPersonality(bot, BotPersonality.Hunter);
  rethink(bot);
  assert.notEqual(decision(bot), "chase");
  prey.x = SPAWN_GRACE_CHASE_RADIUS - 5;
  rethink(bot);
  assert.equal(decision(bot), "chase");
  // Rampe terminée : poursuivi jusqu'au rayon normal, comme tout le monde.
  prey.x = 50;
  prey.graceRampUntil = 0;
  rethink(bot);
  assert.equal(decision(bot), "chase");
});

test("grâce : un Hunter en fuite ne lance pas sur un poursuivant en grâce", () => {
  const bot = addPlayer(state, { x: 0, y: -100, blades: 6, isBot: true });
  const threat = addPlayer(state, { x: 15, y: -100, blades: 30 });
  threat.graceUntil = clock.now + SPAWN_GRACE_MS;
  setPersonality(bot, BotPersonality.Hunter);
  rethink(bot);
  // Il fuit toujours une menace, mais sans lui lancer dessus.
  assert.ok(bot.inputDx < -0.9);
  assert.equal(bot.inputThrow, false);
});

test("grâce : un bot ne va pas récolter au contact d'un joueur en grâce", () => {
  const bot = addPlayer(state, { x: 0, y: -100, blades: 3, isBot: true });
  const newcomer = addPlayer(state, { x: 0, y: -60, blades: 3 });
  newcomer.graceUntil = clock.now + SPAWN_GRACE_MS;
  addGroundBlade(state, { x: 0, y: -63 });
  setPersonality(bot, BotPersonality.Farmer);
  rethink(bot);
  assert.notEqual(decision(bot), "farm_blade");
  newcomer.graceUntil = 0;
  rethink(bot);
  assert.equal(decision(bot), "farm_blade");
});

test("buissons : un bot ne poursuit ni ne vise un joueur caché hors de portée de contact", () => {
  const bush = BUSHES[2];
  const bot = addPlayer(state, { x: bush.x, y: bush.y + 16, blades: 10, isBot: true });
  const prey = addPlayer(state, { x: bush.x, y: bush.y, blades: 3 });
  setPersonality(bot, BotPersonality.Hunter);
  rethink(bot);
  assert.notEqual(decision(bot), "chase");
  assert.equal(bot.inputThrow, false);
  // Sorti du buisson : une proie comme une autre.
  prey.x = bush.x + bush.radius + 2;
  rethink(bot);
  assert.equal(decision(bot), "chase");
});
