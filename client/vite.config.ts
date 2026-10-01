import { defineConfig, Plugin } from "vite";
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

// Image d'aperçu des liens partagés (balises Open Graph, tâche 5.5) :
// dessinée par programme depuis la palette du thème par défaut, comme tout
// le jeu (aucune image dans le dépôt). Émise au build sous og.jpg, servie
// à la volée par le serveur de dev. Import paresseux : la configuration se
// charge même si le paquet shared n'est pas encore compilé.
function ogImage(): Plugin {
  let jpeg: Promise<Buffer> | null = null;
  const render = () => (jpeg ??= import("./tools/ogImage").then((m) => m.renderOgImage()));
  return {
    name: "bladeio-og-image",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== `${base}og.jpg`) return next();
        render().then((buf) => {
          res.setHeader("Content-Type", "image/jpeg");
          res.end(buf);
        }, next);
      });
    },
    async generateBundle() {
      this.emitFile({ type: "asset", fileName: "og.jpg", source: await render() });
    },
  };
}

export default defineConfig({
  base,
  plugins: [ogImage()],
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
