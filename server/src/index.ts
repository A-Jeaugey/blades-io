import "dotenv/config";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import path from "path";
import fs from "fs";
import { ArenaRoom } from "./rooms/ArenaRoom";
import { initSupabase } from "./auth/supabase";
import { buildAuthRouter } from "./auth/routes";
import { ensureWalletSchemaReady } from "./auth/wallet";

initSupabase();
// Self-check : probe Supabase for the wallet schema and log a clear,
// actionable message if anything is missing. Non-blocking — the game loop
// boots regardless ; coin credits will use the fallback path if needed.
void ensureWalletSchemaReady();

const PORT = Number(process.env.PORT ?? 2567);

const app = express();
app.use(cors());
app.use(express.json({ limit: "32kb" }));
app.get("/healthz", (_req, res) => res.status(200).send("ok"));
app.get("/api", (_req, res) => {
  res.json({ name: "blade.io server", status: "ok" });
});
app.use("/api", buildAuthRouter());

// Sert le client statique si dispo (déploiement all-in-one)
const clientDist = [
  path.resolve(__dirname, "../../client/dist"),
  path.resolve(process.cwd(), "client/dist"),
].find((p) => fs.existsSync(p));
if (clientDist) {
  console.log(`[blade.io] serving static client from ${clientDist}`);
  app.use(express.static(clientDist));
  app.get("*", (req, res, next) => {
    if (path.extname(req.path)) return next();
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

const httpServer = createServer(app);

const gameServer = new Server({
  // pingInterval + pingMaxRetries : par défaut Colyseus kick après ~6 s
  // sans pong, beaucoup trop agressif sur réseaux mobiles/4G. On tolère
  // jusqu'à ~45 s avant disconnect.
  transport: new WebSocketTransport({
    server: httpServer,
    pingInterval: 15000,
    pingMaxRetries: 3,
  }),
});

// filterBy["code"] fait que joinOrCreate("arena", { code }) regroupe par
// valeur de code. Public = code vide, private = code à 5 chars.
gameServer.define("arena", ArenaRoom).filterBy(["code"]);

gameServer.listen(PORT).then(() => {
  console.log(`[blade.io] server listening on :${PORT}`);
});
