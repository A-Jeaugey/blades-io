import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUSHES,
  PLAYER_BODY_RADIUS,
  bladeCountRotationMult,
  getShopItem,
  isInBush,
  outerOrbitRadius,
  outerRingIndex,
  resolveDecorCollision,
  ringAngularVelocity,
  ringCapacity,
  ringRadius,
  shopPrice,
  slotAngle,
  tierBladeHitbox,
  tierFromBladeCount,
  tierRotationMult,
} from "@bladeio/shared";

const close = (actual: number, expected: number, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} ≉ ${expected}`);

test("anneaux : capacité 16 + 8n, rayon 1,8 + 0,8n", () => {
  assert.deepEqual([0, 1, 2].map(ringCapacity), [16, 24, 32]);
  close(ringRadius(0), 1.8);
  close(ringRadius(1), 2.6);
});

test("anneau extérieur occupé selon le nombre de lames", () => {
  assert.equal(outerRingIndex(0), -1);
  assert.equal(outerRingIndex(1), 0);
  assert.equal(outerRingIndex(16), 0);
  assert.equal(outerRingIndex(17), 1);
  assert.equal(outerRingIndex(40), 1);
  assert.equal(outerRingIndex(41), 2);
  assert.equal(outerOrbitRadius(0), 0);
  close(outerOrbitRadius(16), 1.8);
  close(outerOrbitRadius(17), 2.6);
});

test("rotation : sens alterné, -12 % par anneau, multiplicateur appliqué", () => {
  close(ringAngularVelocity(0), 5.5);
  close(ringAngularVelocity(1), -5.5 * 0.88);
  close(ringAngularVelocity(0, 2), 11);
  // Slots répartis uniformément sur l'anneau.
  close(slotAngle(0, 1, 4, 0), Math.PI / 2);
});

test("tiers : paliers à 10 et 20 lames", () => {
  assert.deepEqual([0, 1, 9, 10, 19, 20, 500].map(tierFromBladeCount), [0, 0, 0, 1, 1, 2, 2]);
  close(tierBladeHitbox(0), 0.7 * 1.5);
  close(tierBladeHitbox(2), 0.7 * 3.0);
  // Tier hors bornes : ramené dans [0, 2].
  close(tierBladeHitbox(7), tierBladeHitbox(2));
  close(tierBladeHitbox(-1), tierBladeHitbox(0));
  close(tierRotationMult(1), 1.15);
});

test("bonus de rotation selon le nombre de lames, plafonné à ×2,5", () => {
  close(bladeCountRotationMult(0), 1);
  close(bladeCountRotationMult(50), 1.75);
  close(bladeCountRotationMult(100), 2.5);
  close(bladeCountRotationMult(1000), 2.5);
});

test("décor : un joueur dans le pilier central est repoussé à sa surface", () => {
  const minDist = 1.1 + PLAYER_BODY_RADIUS;
  const pushed = resolveDecorCollision(0.1, 0, PLAYER_BODY_RADIUS);
  close(pushed.x, minDist);
  close(pushed.y, 0);
  // Centre exact : poussé vers +y.
  const center = resolveDecorCollision(0, 0, PLAYER_BODY_RADIUS);
  close(center.x, 0);
  close(center.y, minDist);
  // Loin de tout obstacle : inchangé.
  assert.deepEqual(resolveDecorCollision(0, -20, PLAYER_BODY_RADIUS), { x: 0, y: -20 });
});

test("bushes : détection de présence", () => {
  assert.equal(isInBush(BUSHES[0].x, BUSHES[0].y), true);
  assert.equal(isInBush(0, 0), false);
});

test("boutique : prix du catalogue, items inconnus refusés", () => {
  assert.equal(getShopItem("sanctuaire")?.price, 1500);
  assert.equal(getShopItem("constructor"), undefined);
  assert.equal(getShopItem("__proto__"), undefined);
  assert.equal(shopPrice("neon"), 0);
});
