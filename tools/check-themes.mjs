#!/usr/bin/env node
// Garde-fous de lisibilité des thèmes (tâche 6.3) : vérifie chaque thème du
// registre (client/src/themes) contre le contrat de
// client/src/themes/readability.ts (familles de teinte des raretés, sol
// sombre, contrastes, couleurs réservées au gameplay, shaders sans couleur en
// dur), puis la palette daltonienne sur tous les sols. Code de sortie 1 au
// moindre écart : la CI le lance après le build.
//
//   node tools/check-themes.mjs            rapport complet
//   node tools/check-themes.mjs --quiet    écarts seulement
//
// Les thèmes sont lus depuis les sources TypeScript (esbuild, déjà installé
// avec Vite), sans build préalable.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const quiet = process.argv.includes("--quiet");

const entry = `
export { THEMES } from "./client/src/themes/index.ts";
export { COLORBLIND_RARITY_COLOR } from "./client/src/themes/colorblind.ts";
export {
  READABILITY, RARITY_FAMILIES, checkTheme, checkColorblindPalette,
  contrastRatio, deltaE2000, oklch, relativeLuminance,
} from "./client/src/themes/readability.ts";
`;

const out = await build({
  stdin: { contents: entry, resolveDir: root, loader: "ts", sourcefile: "check-themes-entry.ts" },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "error",
  alias: { "@bladeio/shared": path.join(root, "shared/src/index.ts") },
});
const mod = await import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));
const { THEMES, COLORBLIND_RARITY_COLOR, READABILITY, checkTheme, checkColorblindPalette, contrastRatio, oklch, relativeLuminance } = mod;

const hex = (n) => "#" + n.toString(16).padStart(6, "0");
const RARITY = ["commune", "rare", "épique", "légendaire"];
let failures = 0;

for (const theme of Object.values(THEMES)) {
  const { errors } = checkTheme(theme);
  failures += errors.length;
  console.log(`${errors.length ? "ÉCHEC" : "OK   "} ${theme.id}`);
  if (!quiet) {
    const p = theme.palette;
    const base = theme.ground.colors.base;
    const rar = [0, 1, 2, 3].map((r) => {
      const c = p.rarityColor[r];
      const { h, c: ch } = oklch(c);
      return `${RARITY[r]} ${hex(c)} (H ${h.toFixed(0)}°, C ${ch.toFixed(2)}, contraste ${contrastRatio(c, base).toFixed(1)})`;
    });
    console.log(`        raretés : ${rar.join(" · ")}`);
    const ground = Object.entries(theme.ground.colors).map(([k, c]) => `${k} ${hex(c)} (${relativeLuminance(c).toFixed(3)})`);
    console.log(`        sol (luminance) : ${ground.join(" · ")}`);
  }
  for (const e of errors) console.log(`        ✗ ${e}`);
}

const cb = checkColorblindPalette(COLORBLIND_RARITY_COLOR, Object.values(THEMES));
failures += cb.errors.length;
console.log(`${cb.errors.length ? "ÉCHEC" : "OK   "} palette daltonienne (sur tous les sols)`);
for (const e of cb.errors) console.log(`        ✗ ${e}`);

// Auto-contrôle : le contrat refuse ce que l'audit reprochait (palettes
// d'avant la tâche 6.3). Un seuil relâché par mégarde se verrait ici.
const before = (id, patch) => {
  const t = THEMES[id];
  return {
    ...t,
    palette: { ...t.palette, ...patch.palette, rarityColor: { ...t.palette.rarityColor, ...patch.rarity } },
    ground: { ...t.ground, ...patch.ground },
  };
};
const FIXTURES = [
  ["Forge Vermeille, lames aux couleurs de la lave", before("forge-vermeille", {
    rarity: { 0: 0xc44a2e, 1: 0xff8a3e, 2: 0xffba4a, 3: 0xfff5d4 },
    ground: { colors: { base: 0x0a0606, crack: 0xff5e2e, pool: 0xc44a2e, ember: 0xffba4a } },
  })],
  ["Profondeurs Glacées, sol clair aux arêtes cyan", before("profondeurs-glacees", {
    rarity: { 0: 0xb8d4ec, 1: 0x66c4ff, 3: 0xffd49a },
    ground: { colors: { base: 0x040c1a, mid: 0x1a3045, crystal: 0x66c4ff, aurora: 0x6affb8 } },
  })],
  ["Néon, légendaire rose comme la zone mortelle", before("neon", { rarity: { 3: 0xff2ea8 } })],
  ["Sanctuaire, poussières crème et cercles or", before("sanctuaire", {
    ground: { colors: { ...THEMES.sanctuaire.ground.colors, glow: 0xe8d4f0, sacred: 0xf4d471 } },
  })],
  ["sol à couleur codée en dur", before("neon", {
    ground: { fragRich: "uniform vec3 uBase; void main() { gl_FragColor = vec4(vec3(0.02, 0.024, 0.05), 1.0); }" },
  })],
];
for (const [name, theme] of FIXTURES) {
  const { errors } = checkTheme(theme);
  if (errors.length === 0) {
    failures++;
    console.log(`ÉCHEC auto-contrôle : le contrat accepte « ${name} »`);
  } else if (!quiet) {
    console.log(`OK    refusé : ${name} (${errors.length} écart(s), dont « ${errors[0]} »)`);
  }
}

if (!quiet) {
  console.log(`\nSeuils : luminance du sol ≤ ${READABILITY.groundMaxLuma} (fond ≤ ${READABILITY.groundBaseMaxLuma}), ` +
    `écart entre raretés ≥ ${READABILITY.rarityMinDeltaE}, contraste rareté / fond ≥ ${READABILITY.rarityOnBaseMinContrast}.`);
}
if (failures) {
  console.log(`\n${failures} écart(s) au contrat de lisibilité (client/src/themes/readability.ts).`);
  process.exit(1);
}
