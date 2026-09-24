import { defineConfig } from "vite";
import path from "path";
import { execSync } from "child_process";

// Base URL pour servir sous un sous-chemin (ex: arthurjeaugey.com/spinning-blades/).
// Défaut : "/". Override via VITE_BASE_PATH au build.
const base = process.env.VITE_BASE_PATH ?? "/";

// Identifiant affiché dans le lobby (« BUILD ») : date du build + commit.
// Remplace une date écrite en dur qui ne suivait pas les déploiements. Les
// plateformes de build n'ont pas toujours le dossier .git : on lit d'abord
// leurs variables, puis git, sinon la date seule.
function buildId(): string {
  let sha = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RENDER_GIT_COMMIT ?? "";
  if (!sha) {
    try {
      sha = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      sha = "";
    }
  }
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
  return sha ? `${date} · ${sha.slice(0, 7)}` : date;
}

export default defineConfig({
  base,
  // Le .env vit à la racine du monorepo (partagé avec le serveur), pas dans client/.
  envDir: "..",
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
  },
  resolve: {
    alias: {
      "@bladeio/shared": path.resolve(__dirname, "../shared/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: "es2020",
    sourcemap: true,
  },
});
