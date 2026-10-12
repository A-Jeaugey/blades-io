// Noms des bots (retour de jeu du 2026-10-12 : deux bots du même nom dans
// une partie « portent à confusion »).
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  BOT_NAMES,
  CHAMPION_NAME_MARK,
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
  botNameKey,
  nameProblem,
} from "@bladeio/shared";
import { ArenaState } from "../src/state/ArenaState";
import { BotController, pickBotName } from "../src/systems/bots";
import { FakeClock, addPlayer, seedRandom } from "./helpers";

let clock: FakeClock;
let restoreRandom: () => void;

beforeEach(() => {
  clock = new FakeClock();
  restoreRandom = seedRandom(42);
});
afterEach(() => {
  clock.restore();
  restoreRandom();
});

test("liste : au moins 120 noms distincts, courts, acceptés par le filtre des pseudos", () => {
  assert.ok(BOT_NAMES.length >= 120, `${BOT_NAMES.length} noms`);
  const keys = new Set(BOT_NAMES.map(botNameKey));
  assert.equal(keys.size, BOT_NAMES.length, "doublons (sans casse ni accents)");
  for (const name of BOT_NAMES) {
    // La marque de champion comprise.
    assert.ok((CHAMPION_NAME_MARK + name).length <= NAME_MAX_LENGTH, `trop long : ${name}`);
    assert.ok(name.length >= NAME_MIN_LENGTH, `trop court : ${name}`);
    assert.equal(name.trim(), name);
    assert.equal(nameProblem(name), null, `refusé : ${name}`);
  }
});

test("clé de comparaison : sans marque de champion, casse, accents ni séparateurs", () => {
  assert.equal(botNameKey(CHAMPION_NAME_MARK + "Raclette"), botNameKey("raclette"));
  assert.equal(botNameKey("Crêpe"), botNameKey("CREPE"));
  assert.equal(botNameKey("Raton Laveur"), botNameKey("Raton-Laveur"));
  assert.notEqual(botNameKey("Raclette"), botNameKey("Raclette 2"));
});

test("60 bots dans une room : tous les noms distincts, humains compris", () => {
  const state = new ArenaState();
  const bots = new BotController();
  // Des humains qui portent déjà des noms de la liste, vivants ou morts.
  const human = addPlayer(state);
  human.name = "raclette";
  const dead = addPlayer(state);
  dead.name = "Croissant";
  dead.alive = false;
  for (let i = 0; i < 60; i++) bots.spawnBot(state, { x: 0, y: -100 }, i % 7 === 0);
  const keys: string[] = [];
  state.players.forEach((p) => keys.push(botNameKey(p.name)));
  assert.equal(new Set(keys).size, keys.length, "doublon");
  state.players.forEach((p) => {
    if (!p.isBot) return;
    assert.ok(p.name.length <= NAME_MAX_LENGTH, p.name);
    // Aucun repli numéroté tant que la liste n'est pas épuisée.
    const bare = p.champion ? p.name.slice(CHAMPION_NAME_MARK.length) : p.name;
    assert.ok(BOT_NAMES.includes(bare), p.name);
    assert.equal(p.name.startsWith(CHAMPION_NAME_MARK), p.champion);
  });
});

test("champion et bot ordinaire : jamais le même nom", () => {
  const state = new ArenaState();
  // Tous les noms pris sauf un : le champion doit le prendre, sans la marque.
  for (const name of BOT_NAMES.slice(1)) addPlayer(state, { isBot: true }).name = name;
  const bots = new BotController();
  const champ = bots.spawnBot(state, { x: 0, y: -100 }, true);
  assert.equal(champ.name, CHAMPION_NAME_MARK + BOT_NAMES[0]);
  // Le suivant ne reprend pas « BOT_NAMES[0] » sans la marque.
  const next = pickBotName(state);
  assert.notEqual(botNameKey(next), botNameKey(BOT_NAMES[0]));
});

test("liste épuisée : repli numéroté, toujours unique et à la bonne longueur", () => {
  const state = new ArenaState();
  const bots = new BotController();
  const total = BOT_NAMES.length + 40;
  for (let i = 0; i < total; i++) bots.spawnBot(state, { x: 0, y: -100 }, i % 5 === 0);
  const names: string[] = [];
  state.players.forEach((p) => names.push(p.name));
  assert.equal(names.length, total);
  assert.equal(new Set(names.map(botNameKey)).size, total, "doublon");
  // Les 40 de trop : « Nom N », Nom pris dans la liste.
  const bare = names.map((n) => (n.startsWith(CHAMPION_NAME_MARK) ? n.slice(CHAMPION_NAME_MARK.length) : n));
  const numbered = bare.filter((n) => !BOT_NAMES.includes(n));
  assert.equal(numbered.length, 40);
  for (const n of numbered) {
    const m = / (\d+)$/.exec(n);
    assert.ok(m && Number(m[1]) >= 2 && BOT_NAMES.includes(n.slice(0, m.index)), n);
  }
  for (const n of names) assert.ok(n.length <= NAME_MAX_LENGTH, n);
});
