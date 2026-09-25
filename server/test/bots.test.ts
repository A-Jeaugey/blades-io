import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { BladeThrownEvent, MAP_RADIUS, WALL_KILL_THICKNESS } from "@bladeio/shared";
import { ArenaState } from "../src/state/ArenaState";
import { Crate } from "../src/state/Crate";
import { Player } from "../src/state/Player";
import { BotController, BotPersonality } from "../src/systems/bots";
import { updateMovement } from "../src/systems/movement";
import { processThrows } from "../src/systems/throws";
import { DT, FakeClock, addPlayer, seedRandom } from "./helpers";

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
