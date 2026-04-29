import { defineConfig } from "vite";
import path from "path";

// Base URL pour servir sous un sous-chemin (ex: arthurjeaugey.com/spinning-blades/).
// Défaut : "/". Override via VITE_BASE_PATH au build.
const base = process.env.VITE_BASE_PATH ?? "/";

export default defineConfig({
  base,
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
