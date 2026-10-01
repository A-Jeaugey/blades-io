// Power-ups (tâche 4.3) : effets bornés à 25 s, sans cumul, et lames de la
// rareté du power-up Blades.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { BladeRarity, POWERUP_BLADES_COUNT, POWERUP_DURATION, PowerUpType } from "@bladeio/shared";
import { ArenaState } from "../src/state/ArenaState";
import { PowerUp } from "../src/state/PowerUp";
import { PowerUpSystem } from "../src/systems/powerups";
import { FakeClock, addPlayer, seedRandom } from "./helpers";

let clock: FakeClock;
let restoreRandom: () => void;

beforeEach(() => {
  clock = new FakeClock();
  restoreRandom = seedRandom(5);
});
afterEach(() => {
  clock.restore();
  restoreRandom();
});

// Pose un power-up sous le joueur et fait passer le ramassage.
function pickUp(state: ArenaState, sys: PowerUpSystem, type: PowerUpType, rarity: BladeRarity): void {
  const pu = new PowerUp();
  pu.id = `pu-${type}-${rarity}-${clock.now}`;
  pu.type = type;
  pu.rarity = rarity;
  const p = state.players.values().next().value!;
  pu.x = p.x;
  pu.y = p.y;
  state.powerups.set(pu.id, pu);
  sys.update(0, state, false, () => {});
}

test("power-ups : aucun effet ne dure plus de 25 s, un second ramassage ne cumule pas", () => {
  for (const rarity of [BladeRarity.Common, BladeRarity.Rare, BladeRarity.Epic, BladeRarity.Legendary]) {
    assert.ok(POWERUP_DURATION[rarity] <= 25);
  }
  const state = new ArenaState();
  const sys = new PowerUpSystem();
  const p = addPlayer(state, { blades: 3 });
  pickUp(state, sys, PowerUpType.Shield, BladeRarity.Legendary);
  assert.equal(p.shieldUntil, clock.now + 25_000);
  clock.advance(10_000);
  pickUp(state, sys, PowerUpType.Shield, BladeRarity.Legendary);
  assert.equal(p.shieldUntil, clock.now + 25_000);
  // Un Common ne raccourcit pas l'effet en cours.
  pickUp(state, sys, PowerUpType.Shield, BladeRarity.Common);
  assert.equal(p.shieldUntil, clock.now + 25_000);
  for (const type of [PowerUpType.Speed, PowerUpType.Spin, PowerUpType.Magnet]) {
    pickUp(state, sys, type, BladeRarity.Epic);
  }
  assert.equal(p.speedUntil, clock.now + 18_000);
  assert.equal(p.spinUntil, clock.now + 18_000);
  assert.equal(p.magnetUntil, clock.now + 18_000);
});

test("power-up Blades : des lames de sa rareté", () => {
  for (const rarity of [BladeRarity.Common, BladeRarity.Rare, BladeRarity.Epic, BladeRarity.Legendary]) {
    const state = new ArenaState();
    const sys = new PowerUpSystem();
    const p = addPlayer(state, { blades: 3, rarity: BladeRarity.Common });
    pickUp(state, sys, PowerUpType.Blades, rarity);
    // Ordre de ramassage : les trois lames de départ, puis celles du power-up.
    const gained = p.bladeIds.slice(3).map((id) => state.blades.get(id)!);
    assert.equal(p.bladeCount, 3 + POWERUP_BLADES_COUNT[rarity]);
    assert.equal(gained.length, POWERUP_BLADES_COUNT[rarity]);
    assert.ok(gained.every((b) => b.rarity === rarity), `rareté ${rarity}`);
  }
});
