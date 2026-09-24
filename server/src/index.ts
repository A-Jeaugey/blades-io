import "dotenv/config";
import { Server, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import path from "path";
import fs from "fs";
import { ArenaRoom } from "./rooms/ArenaRoom";
import { initSupabase } from "./auth/supabase";
import { buildAuthRouter } from "./auth/routes";
import { rateLimit } from "./http/rateLimit";

initSupabase();

const PORT = Number(process.env.PORT ?? 2567);

// Nombre de reverse proxies de confiance devant le serveur (Caddy en
// auto-hébergement, le load balancer de Render en cloud). Par défaut 1 :
// req.ip vient alors de X-Forwarded-For, sinon tous les joueurs auraient
// l'IP du proxy et partageraient le même compteur de rate limit. Mettre
// TRUST_PROXY=false si le serveur est exposé directement (X-Forwarded-For
// deviendrait falsifiable par le client).
function parseTrustProxy(raw: string | undefined): boolean | number | string {
  const v = (raw ?? "").trim();
  if (v === "") return 1;
  if (v === "false") return false;
  if (v === "true") return true;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : v;
}

const app = express();
app.set("trust proxy", parseTrustProxy(process.env.TRUST_PROXY));

// CORS : le client est servi par ce même serveur, donc l'API est appelée en
// same-origin et n'a besoin d'aucun en-tête CORS. Une origine externe (client
// hébergé ailleurs) doit être listée dans ALLOWED_ORIGINS. Le matchmaking
// Colyseus (/matchmake) est intercepté avant Express et gère ses propres
// en-têtes : il n'est pas concerné.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter((o) => o.length > 0);
if (allowedOrigins.length > 0) app.use(cors({ origin: allowedOrigins }));

app.use(express.json({ limit: "32kb" }));
app.get("/healthz", (_req, res) => res.status(200).send("ok"));
// Plafond général de l'API, puis plafond serré sur la création de wallet
// invité : chaque appel insère une ligne en base. 20 / 15 min laisse passer
// une salle de classe derrière une même IP, pas un script.
app.use("/api", rateLimit({ windowMs: 60_000, max: 120 }));
app.use("/api/guest/init", rateLimit({ windowMs: 15 * 60_000, max: 20 }));
app.get("/api", (_req, res) => {
  res.json({ name: "blade.io server", status: "ok" });
});

// Statistiques réelles affichées par le lobby (remplacent les compteurs
// aléatoires d'avant). `clients` = connexions WebSocket, donc joueurs
// humains en partie : les bots ne sont pas des clients. Mis en cache 2 s,
// le lobby interroge toutes les 10 s par onglet ouvert.
let statsCache: { at: number; body: { inGame: number; rooms: number } } | null = null;
app.get("/api/stats", async (_req, res) => {
  const now = Date.now();
  if (!statsCache || now - statsCache.at > 2000) {
    const rooms = await matchMaker.query({ name: "arena" });
    const inGame = rooms.reduce((sum, r) => sum + r.clients, 0);
    statsCache = { at: now, body: { inGame, rooms: rooms.length } };
  }
  res.json(statsCache.body);
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
