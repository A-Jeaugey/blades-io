import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { buildSync } from "esbuild";
import {
  BLADE_TIP_REACH,
  BladeRarity,
  CLASH_SHAKE_INTENSITY,
  HITLAG_DURATION_MS,
  KNOCKBACK_TIER_MULT,
  TIER_COUNT,
  TIER_HITBOX_MULT,
  TIER_ROT_MULT,
  TIER_THRESHOLDS,
  TIER_UP_SHAKE,
  TIER_VISUAL_SCALE,
  bladeBodyReach,
  bladeTipReach,
  tierBladeHitbox,
  tierHitlagMs,
  tierKnockback,
  tierRotationMult,
} from "@bladeio/shared";

const RARITIES = [BladeRarity.Common, BladeRarity.Rare, BladeRarity.Epic, BladeRarity.Legendary];

// Formes des lames (client/src/entities/bladeGeometries.ts), lues depuis
// leurs sources avec three.js : compilées par esbuild (installé avec Vite),
// comme le contrôle des thèmes (tools/check-themes.mjs).
interface ShapeGeometry {
  computeBoundingBox(): void;
  boundingBox: { min: { x: number; z: number }; max: { x: number; z: number } } | null;
  getAttribute(name: string): { count: number };
}
interface ShapesModule {
  createTierGeometry(tier: number, simple: boolean): ShapeGeometry;
  TIER_SHAPE_COUNT: number;
}
let shapes: ShapesModule | null = null;
function loadShapes(): ShapesModule {
  if (shapes) return shapes;
  // Tests compilés dans server/dist-test/test/.
  const root = path.resolve(__dirname, "../../..");
  const out = buildSync({
    entryPoints: [path.join(root, "client/src/entities/bladeGeometries.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    logLevel: "error",
    alias: { "@bladeio/shared": path.join(root, "shared/src/index.ts") },
  });
  const mod = { exports: {} as Record<string, unknown> };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  shapes = mod.exports as unknown as ShapesModule;
  return shapes;
}

test("paliers : seuils croissants, une valeur par palier dans chaque table", () => {
  assert.equal(TIER_THRESHOLDS.length, TIER_COUNT);
  for (let t = 1; t < TIER_COUNT; t++) assert.ok(TIER_THRESHOLDS[t] > TIER_THRESHOLDS[t - 1]);
  const tables: Record<string, readonly number[]> = {
    TIER_HITBOX_MULT, TIER_ROT_MULT, TIER_VISUAL_SCALE, BLADE_TIP_REACH,
    KNOCKBACK_TIER_MULT, HITLAG_DURATION_MS, CLASH_SHAKE_INTENSITY, TIER_UP_SHAKE,
  };
  for (const [name, table] of Object.entries(tables)) {
    assert.equal(table.length, TIER_COUNT, `${name} : ${table.length} valeurs pour ${TIER_COUNT} paliers`);
  }
  // L'échelle des lames ne diminue jamais d'un palier au suivant.
  for (let t = 1; t < TIER_COUNT; t++) assert.ok(TIER_VISUAL_SCALE[t] >= TIER_VISUAL_SCALE[t - 1]);
});

// Plafonds de la tâche 4.1 : au-delà de la faux, hitbox de clash, rotation,
// recul et hitlag ne grandissent plus (des hitbox plus grosses doublaient
// les morts précoces des débutants au banc de survie).
test("paliers : clash, rotation, recul et hitlag plafonnés à la faux jusqu'au dernier palier", () => {
  for (let t = 2; t < TIER_COUNT; t++) {
    assert.equal(tierBladeHitbox(t), tierBladeHitbox(2), `hitbox du palier ${t}`);
    assert.equal(tierRotationMult(t), tierRotationMult(2), `rotation du palier ${t}`);
    assert.equal(tierKnockback(t), tierKnockback(2), `recul du palier ${t}`);
    assert.equal(tierHitlagMs(t), tierHitlagMs(2), `hitlag du palier ${t}`);
  }
});

// La lame dessinée tue un corps (tâche 4.10) : sa portée grandit avec le
// palier, et les paliers d'avant les retours du 2026-10-12 la gardent.
test("portée dessinée : croissante d'un palier à l'autre, inchangée jusqu'au palier 5", () => {
  for (const r of RARITIES) {
    for (let t = 1; t < TIER_COUNT; t++) {
      assert.ok(bladeTipReach(t, r) > bladeTipReach(t - 1, r), `rareté ${r}, palier ${t}`);
      assert.ok(bladeBodyReach(t, r) >= bladeBodyReach(t - 1, r), `rareté ${r}, palier ${t}`);
    }
  }
  const before = [0.55, 1.1875, 1.55, 1.716, 1.89, 2.146];
  before.forEach((reach, t) => assert.ok(Math.abs(bladeTipReach(t, BladeRarity.Common) - reach) < 1e-9, `palier ${t}`));
  assert.ok(Math.abs(bladeTipReach(5, BladeRarity.Legendary) - 1.16 * 1.85 * 1.7) < 1e-9);
});

test("formes : une par palier, toutes différentes", () => {
  const { createTierGeometry, TIER_SHAPE_COUNT } = loadShapes();
  assert.equal(TIER_SHAPE_COUNT, TIER_COUNT);
  const signatures = new Set<string>();
  for (let t = 0; t < TIER_COUNT; t++) {
    const geo = createTierGeometry(t, false);
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    signatures.add(`${geo.getAttribute("position").count}|${box.max.x.toFixed(3)}|${box.max.z.toFixed(3)}`);
  }
  assert.equal(signatures.size, TIER_COUNT);
});

// BLADE_TIP_REACH doit suivre la géométrie dessinée : sinon un corps meurt
// à côté de la lame, ou la traverse sans mourir (tâche 4.10).
test("formes : pointe mesurée sur la géométrie = BLADE_TIP_REACH, en qualité pleine et légère", () => {
  const { createTierGeometry } = loadShapes();
  for (let t = 0; t < TIER_COUNT; t++) {
    for (const simple of [false, true]) {
      const geo = createTierGeometry(t, simple);
      geo.computeBoundingBox();
      const tip = geo.boundingBox!.max.x;
      assert.ok(
        Math.abs(tip - BLADE_TIP_REACH[t]) < 0.005,
        `palier ${t}${simple ? " (simple)" : ""} : pointe à ${tip.toFixed(3)}, BLADE_TIP_REACH ${BLADE_TIP_REACH[t]}`,
      );
    }
  }
});
