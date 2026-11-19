// Formes du jeu relues depuis leurs sources (three.js compilé par esbuild,
// comme server/test/bladeShapes.test.ts) et écrites en .obj dans
// art/kit/src/ : les dix lames (une par palier) et les cinq power-ups.
// build_kit.py les retravaille dans Blender sans toucher à leur silhouette :
// la pointe d'une lame est une portée de jeu (BLADE_TIP_REACH).
//
// Lancer avant build_kit.py : node art/kit/dump_shapes.mjs
import { buildSync } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.join(root, "art/kit/src");
const require = createRequire(import.meta.url);

function load(entry) {
  const built = buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    logLevel: "error",
    alias: { "@bladeio/shared": path.join(root, "shared/src/index.ts") },
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", built.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}

// Sommets soudés à 1e-5 près : les géométries du jeu ne sont pas indexées,
// Blender a besoin d'un maillage fermé pour chanfreiner ses arêtes.
function toObj(geo) {
  const pos = geo.getAttribute("position");
  const index = geo.getIndex();
  const ids = new Map();
  const verts = [];
  const remap = [];
  for (let i = 0; i < pos.count; i++) {
    const v = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const key = v.map((n) => Math.round(n * 1e5)).join(",");
    let id = ids.get(key);
    if (id === undefined) {
      id = verts.length;
      ids.set(key, id);
      verts.push(v);
    }
    remap.push(id);
  }
  const lines = verts.map((v) => `v ${v[0]} ${v[1]} ${v[2]}`);
  const n = index ? index.count : pos.count;
  for (let i = 0; i < n; i += 3) {
    const a = remap[index ? index.getX(i) : i];
    const b = remap[index ? index.getX(i + 1) : i + 1];
    const c = remap[index ? index.getX(i + 2) : i + 2];
    if (a !== b && b !== c && a !== c) lines.push(`f ${a + 1} ${b + 1} ${c + 1}`);
  }
  return lines.join("\n") + "\n";
}

mkdirSync(out, { recursive: true });
const blades = load("client/src/entities/bladeGeometries.ts");
const tips = [];
for (let t = 0; t < blades.TIER_SHAPE_COUNT; t++) {
  const geo = blades.createTierGeometry(t, false);
  geo.computeBoundingBox();
  tips.push(geo.boundingBox.max.x);
  writeFileSync(path.join(out, `blade_${t}.obj`), toObj(geo));
}
// Pointe de chaque forme (x le plus grand) : build_kit.py vérifie que le
// chanfrein ne la déplace pas.
writeFileSync(path.join(out, "blade_tips.json"), JSON.stringify(tips));

const powerups = load("client/src/entities/powerUpShapes.ts");
for (let type = 0; type < 5; type++) {
  writeFileSync(path.join(out, `powerup_${type}.obj`), toObj(powerups.powerUpGeometry(type, 12)));
}
console.log(`formes écrites dans ${out} : ${tips.length} lames (pointes ${tips.map((x) => x.toFixed(3)).join(", ")}), 5 power-ups`);
