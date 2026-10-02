// Disposition de la carte (tâche 4.7) : structures et buissons là où ils
// servent (dans l'arène d'un humain et de ses bots), symétriques pour les
// modes équipe, sans gêner apparitions, drapeaux ni déplacements.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BUSHES,
  DECOR_COLLIDERS,
  FLOATING_CUBES,
  GOLDEN_RADIUS,
  OBELISKS,
  PLAYER_BODY_RADIUS,
  STRUCTURES,
  TEAM_BASE_X,
  bushAt,
  isInBush,
  populationRadius,
  structureColliders,
} from "@bladeio/shared";

// Rayon de l'arène d'un humain et de ses dix bots, moins la bande au ras
// du mur que les bots évitent (botReachRadius, systems/bots.ts).
const TYPICAL_REACH = populationRadius(11) - 16;

test("structures : de 20 à 25, dans l'arène habituelle, hors de la zone dorée et loin des bases", () => {
  assert.ok(STRUCTURES.length >= 20 && STRUCTURES.length <= 25, `${STRUCTURES.length} structures`);
  for (const st of STRUCTURES) {
    const r = Math.hypot(st.x, st.y);
    assert.ok(r < TYPICAL_REACH - 5, `${st.kind} à ${r.toFixed(1)} u`);
    assert.ok(r > GOLDEN_RADIUS + 4, `${st.kind} dans la zone dorée`);
    for (const bx of [-TEAM_BASE_X, TEAM_BASE_X]) {
      assert.ok(Math.hypot(st.x - bx, st.y) >= 25, `${st.kind} près d'une base`);
    }
  }
});

test("structures et buissons : symétriques de part et d'autre de x = 0", () => {
  for (const st of STRUCTURES) {
    const mirror = STRUCTURES.find((o) => o.kind === st.kind && Math.abs(o.x + st.x) < 1e-6 && Math.abs(o.y - st.y) < 1e-6);
    assert.ok(mirror, `${st.kind} (${st.x}, ${st.y}) sans reflet`);
  }
  for (const b of BUSHES) {
    assert.ok(BUSHES.some((o) => Math.abs(o.x + b.x) < 1e-6 && o.y === b.y && o.radius === b.radius), `buisson (${b.x}, ${b.y})`);
  }
});

test("colliders : un passage d'au moins 2 u entre deux obstacles distincts", () => {
  // Les deux colliders d'un même rack se chevauchent : c'est un seul bloc.
  const owner: number[] = DECOR_COLLIDERS.map(() => -1);
  let i = 1 + OBELISKS.length;
  STRUCTURES.forEach((st, k) => {
    for (const _ of structureColliders(st)) owner[i++] = k;
  });
  assert.equal(i, DECOR_COLLIDERS.length);
  for (let a = 1 + OBELISKS.length; a < DECOR_COLLIDERS.length; a++) {
    for (let b = 0; b < DECOR_COLLIDERS.length; b++) {
      if (a === b || (owner[b] >= 0 && owner[a] === owner[b])) continue;
      const A = DECOR_COLLIDERS[a];
      const B = DECOR_COLLIDERS[b];
      const gap = Math.hypot(A.x - B.x, A.y - B.y) - A.radius - B.radius;
      assert.ok(gap >= 2 * PLAYER_BODY_RADIUS + 0.5, `passage de ${gap.toFixed(2)} u en (${A.x.toFixed(1)}, ${A.y.toFixed(1)})`);
    }
  }
});

test("buissons : dans l'arène habituelle, dégagés de tout obstacle", () => {
  for (const b of BUSHES) {
    assert.ok(Math.hypot(b.x, b.y) + b.radius < TYPICAL_REACH, `buisson (${b.x}, ${b.y})`);
    for (const c of DECOR_COLLIDERS) {
      assert.ok(Math.hypot(b.x - c.x, b.y - c.y) - b.radius - c.radius >= 4, `obstacle dans le buisson (${b.x}, ${b.y})`);
    }
  }
  assert.equal(bushAt(BUSHES[3].x, BUSHES[3].y), 3);
  assert.equal(bushAt(0, 0), -1);
  assert.equal(isInBush(BUSHES[0].x + BUSHES[0].radius - 0.1, BUSHES[0].y), true);
});

test("structures : à l'écart des cubes flottants (rien ne se superpose)", () => {
  for (const st of STRUCTURES) {
    for (const c of FLOATING_CUBES) {
      assert.ok(Math.hypot(st.x - c.x, st.y - c.y) >= 8, `${st.kind} sous un cube flottant`);
    }
  }
});
