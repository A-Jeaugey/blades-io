// Contre-mesures au snowball (tâche 4.2) : prime sur le leader, bonus
// underdog, loot de mort qui privilégie les lames rares.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  BOUNTY_MAX,
  BOUNTY_MIN,
  BladeRarity,
  SCORE_KILL,
  SCORE_UNDERDOG,
  bountyFor,
  isUnderdogKill,
} from "@bladeio/shared";
import * as matches from "../src/auth/matches";
import * as wallet from "../src/auth/wallet";
import * as telemetry from "../src/telemetry";
import { Player } from "../src/state/Player";
import { FakeClock, giveBlade, groundBlades, seedRandom } from "./helpers";
import { TestRoom } from "./testRoom";

let clock: FakeClock;
let restoreRandom: () => void;

beforeEach(() => {
  clock = new FakeClock();
  restoreRandom = seedRandom(21);
  (telemetry as any).recordLife = () => {};
  (matches as any).recordMatch = async () => {};
  (wallet as any).creditWallet = async () => {};
  (wallet as any).creditGuestWallet = async () => {};
});
afterEach(() => {
  clock.restore();
  restoreRandom();
});

function lastKill(r: TestRoom): any {
  const kills = r.eventsOf("playerKilled");
  return kills[kills.length - 1];
}

function armed(r: TestRoom, id: string, total: number, rarity = BladeRarity.Common): Player {
  const p = r.join(id);
  while (p.bladeCount < total) giveBlade(r.state, p, rarity);
  return p;
}

test("prime et loot : bornés, nuls en début de partie", () => {
  assert.equal(bountyFor(29), 0);
  assert.equal(bountyFor(30), BOUNTY_MIN);
  assert.equal(bountyFor(200), 50);
  assert.equal(bountyFor(10_000), BOUNTY_MAX);
  assert.equal(isUnderdogKill(5, 10), true);
  assert.equal(isUnderdogKill(6, 10), false);
  // Contre une petite victime, pas de bonus : 2 contre 4 lames n'a rien
  // d'un exploit.
  assert.equal(isUnderdogKill(2, 4), false);
});

test("leader éliminé : prime au tueur, toutes ses lames au sol", () => {
  const r = new TestRoom(clock);
  const leader = armed(r, "leader", 12);
  leader.kills = 10;
  const killer = armed(r, "killer", 8);
  r.tick(); // scores à jour, leader désigné
  const summary = r.room.buildSummary();
  assert.deepEqual(summary.leader, [0, bountyFor(leader.score)]);
  const bounty = bountyFor(leader.score);
  assert.ok(bounty > 0);
  r.room.killPlayer(leader, killer, "blades");
  const ev = lastKill(r);
  assert.equal(ev.bounty, bounty);
  assert.equal(ev.underdog, false);
  assert.equal(killer.bonusScore, bounty);
  assert.ok(killer.score >= SCORE_KILL + bounty);
  // Le leader lâche tout (12 lames) au lieu de 70 %.
  assert.equal(groundBlades(r.state).filter((b) => b.expiresAt > 0 && b.pickupLockUntil > 0).length, 12);
});

test("leader tué par la bordure : pas de prime, mais tout son loot au sol", () => {
  const r = new TestRoom(clock);
  const leader = armed(r, "leader", 10);
  leader.kills = 10;
  r.join("other");
  r.tick();
  r.room.killPlayer(leader, null, "wall");
  const ev = lastKill(r);
  assert.equal(ev.bounty, 0);
  assert.equal(groundBlades(r.state).filter((b) => b.expiresAt > 0 && b.pickupLockUntil > 0).length, 10);
});

test("underdog : tuer un joueur deux fois plus gros double la valeur du kill", () => {
  const r = new TestRoom(clock);
  const leader = r.join("leader");
  leader.kills = 20; // un tiers est leader : pas de prime en jeu ici
  const big = armed(r, "big", 12);
  const small = armed(r, "small", 5);
  r.tick();
  r.room.killPlayer(big, small, "blades");
  const ev = lastKill(r);
  assert.equal(ev.underdog, true);
  assert.equal(ev.bounty, 0);
  assert.equal(small.bonusScore, SCORE_UNDERDOG);
});

test("loot de mort : les lames rares tombent en premier", () => {
  const r = new TestRoom(clock);
  const victim = r.join("victim");
  // 3 Common de départ, puis 7 Common et 3 Legendary ramassées ensuite :
  // avant, les 70 % lâchés étaient les plus anciennes.
  for (let i = 0; i < 7; i++) giveBlade(r.state, victim, BladeRarity.Common);
  for (let i = 0; i < 3; i++) giveBlade(r.state, victim, BladeRarity.Legendary);
  r.room.killPlayer(victim, null, "wall");
  const drops = groundBlades(r.state).filter((b) => b.expiresAt > 0 && b.pickupLockUntil > 0);
  assert.equal(drops.length, 9); // 70 % de 13
  assert.equal(drops.filter((b) => b.rarity === BladeRarity.Legendary).length, 3);
});
