import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { MAP_RADIUS, WALL_KILL_THICKNESS } from "@bladeio/shared";
import { ArenaState } from "../src/state/ArenaState";
import { Player } from "../src/state/Player";
import { BotController } from "../src/systems/bots";
import { updateMovement } from "../src/systems/movement";
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
