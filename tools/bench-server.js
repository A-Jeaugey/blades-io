// Banc de charge serveur : fait tourner une ArenaRoom hors réseau avec N bots
// en temps simulé accéléré, puis mesure le coût du tick, la taille des
// patchs Colyseus (ce que reçoit un client) et le volume d'évènements.
//
// Pourquoi hors réseau : on veut isoler le coût de la simulation et de
// l'encodage d'état, sans le bruit du transport WebSocket. Le temps est
// simulé (Date.now() est remplacé) pour que les cooldowns/hitlag/durées de
// power-ups restent cohérents même quand la boucle tourne plus vite que le
// temps réel.
//
// Prérequis : `npm run build:shared && npm run build --workspace=@bladeio/server`
// Usage     : node tools/bench-server.js <nbBots=60> <secondesSimulées=300> [private]
//
// Attention : s'appuie sur des internes de @colyseus/core 0.16 (__init,
// _simulationInterval). À revalider lors d'une montée de version Colyseus.
const path = require("path");
const { performance } = require("perf_hooks");

const ROOT = path.resolve(__dirname, "..");

// Horloge simulée : tous les systèmes serveur lisent Date.now().
let simNow = Date.now();
const realDateNow = Date.now;
Date.now = () => simNow;

const { ArenaRoom } = require(path.join(ROOT, "server/dist/rooms/ArenaRoom"));
const { pack } = require(require.resolve("@colyseus/msgpackr", { paths: [path.join(ROOT, "server")] }));

const N = parseInt(process.argv[2] || "60", 10);
const SIM_SECONDS = parseInt(process.argv[3] || "300", 10);
const PRIVATE = process.argv[4] === "private";
const DT = 1 / 60;

const room = new ArenaRoom();
room.listing = { metadata: null, save: async () => {}, markModified: () => {} };
room.__init();

const bcast = new Map();
let bcastBytes = 0;
room.broadcast = (type, msg) => {
  const b = pack([type, msg]).length;
  bcastBytes += b;
  const e = bcast.get(type) || { n: 0, bytes: 0 };
  e.n++;
  e.bytes += b;
  bcast.set(type, e);
};

room.onCreate(PRIVATE ? { code: "BENCH", bots: true } : { code: "" });
// On pilote la boucle nous-mêmes : coupe l'intervalle de simulation et
// l'intervalle de patch installés par onCreate.
clearInterval(room._simulationInterval);
room._simulationInterval = undefined;
room.patchRate = null;
// Remplit la room de bots jusqu'à N (au lieu du cap BOT_MAX_TOTAL).
room.bots.desiredBotCount = () => N;

// Client fictif : reçoit les patchs et les évènements comme un vrai client
// connecté. Depuis la zone d'intérêt (tâche 2.4), ce qu'il reçoit dépend de
// sa position : c'est un joueur mort (hors simulation) qui suit un bot, et
// voit donc ce qu'un joueur verrait au milieu des combats.
let patchBytes = 0;
let patchCount = 0;
let maxPatch = 0;
let scopedBytes = 0;
const observer = {
  state: 1, // ClientState.JOINED
  sessionId: "bench-observer",
  raw: (buf) => {
    patchBytes += buf.length;
    patchCount++;
    if (buf.length > maxPatch) maxPatch = buf.length;
  },
  enqueueRaw: () => {},
  send: (type, msg) => {
    const b = pack([type, msg]).length;
    scopedBytes += b;
    const e = bcast.get(type) || { n: 0, bytes: 0 };
    e.n++;
    e.bytes += b;
    bcast.set(type, e);
  },
};
// BENCH_VIEWERS=60 : autant de clients connectés (le premier est mesuré),
// chacun suivant un bot différent, pour le coût serveur des zones
// d'intérêt et de l'encodage par client.
const VIEWERS = Math.max(1, parseInt(process.env.BENCH_VIEWERS || "1", 10));
const watchers = [];
for (let i = 0; i < VIEWERS; i++) {
  const client = i === 0 ? observer : {
    state: 1, sessionId: `bench-viewer-${i}`, raw: () => {}, enqueueRaw: () => {}, send: () => {},
  };
  room.clients.push(client);
  room.onJoin(client, {}, { userId: null, username: null, guestId: null, name: `viewer${i}` });
  const p = room.state.players.get(client.sessionId);
  p.alive = false;
  // Étendue visible d'un écran 16:9 au recul maximal (cf. constantes VIEW_*).
  room.interest.setRadius(client.sessionId, 70);
  watchers.push({ p, followed: null, rank: i });
}
function follow() {
  for (const w of watchers) {
    if (!w.followed || !w.followed.alive || !room.state.players.has(w.followed.id)) {
      w.followed = null;
      let k = 0;
      room.state.players.forEach((p) => {
        if (!w.followed && p.isBot && p.alive && k++ >= w.rank % 30) w.followed = p;
      });
    }
    if (w.followed) { w.p.x = w.followed.x; w.p.y = w.followed.y; }
  }
}

let killsTotal = 0;
const origKill = room.killPlayer.bind(room);
room.killPlayer = (v, k, r) => {
  if (v.alive) killsTotal++;
  return origKill(v, k, r);
};

const tickTimes = [];
const patchTimes = [];
const samples = [];
const totalTicks = Math.round(SIM_SECONDS / DT);
let windowPatchBytes = 0;
let windowStart = 0;
for (let i = 0; i < totalTicks; i++) {
  simNow += DT * 1000;
  follow();
  const t0 = performance.now();
  room.tick(DT);
  tickTimes.push(performance.now() - t0);
  const before = patchBytes;
  const p0 = performance.now();
  room.broadcastPatch();
  patchTimes.push(performance.now() - p0);
  windowPatchBytes += patchBytes - before;
  if ((i + 1) % (60 * 30) === 0) {
    let alive = 0, ground = 0, orbit = 0, proj = 0, maxBlades = 0;
    room.state.players.forEach((p) => {
      if (p.alive) alive++;
      if (p.bladeCount > maxBlades) maxBlades = p.bladeCount;
    });
    room.state.blades.forEach((b) => {
      if (b.isProjectile) proj++;
      else if (b.ownerId) orbit++;
      else ground++;
    });
    const secs = (i + 1 - windowStart) * DT;
    samples.push({
      t: Math.round((i + 1) * DT),
      alive, ground, orbit, proj, maxBlades,
      patchKBs: +(windowPatchBytes / secs / 1024).toFixed(1),
    });
    windowPatchBytes = 0;
    windowStart = i + 1;
  }
}

const sorted = [...tickTimes].sort((a, b) => a - b);
const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
const mean = tickTimes.reduce((a, b) => a + b, 0) / tickTimes.length;
const round = (x, d = 2) => +x.toFixed(d);
console.log(JSON.stringify({
  bots: N,
  simSeconds: SIM_SECONDS,
  private: PRIVATE,
  tickMs: { mean: round(mean), p50: round(pct(0.5)), p95: round(pct(0.95)), p99: round(pct(0.99)), max: round(sorted[sorted.length - 1]) },
  patchEncodeMs: round(patchTimes.reduce((a, b) => a + b, 0) / patchTimes.length),
  viewers: VIEWERS,
  budgetMs: round(1000 / 60),
  patch: {
    avgBytes: Math.round(patchBytes / Math.max(1, patchCount)),
    maxBytes: maxPatch,
    kbPerSecPerClient: round(patchBytes / SIM_SECONDS / 1024, 1),
  },
  eventsKBsPerClient: round((bcastBytes + scopedBytes) / SIM_SECONDS / 1024, 1),
  totalKBsPerClient: round((patchBytes + bcastBytes + scopedBytes) / SIM_SECONDS / 1024, 1),
  broadcastPerSec: Object.fromEntries([...bcast.entries()].map(([k, v]) => [k, round(v.n / SIM_SECONDS, 1)])),
  killsPerMin: round(killsTotal / (SIM_SECONDS / 60), 1),
  samples,
}, null, 1));

Date.now = realDateNow;
process.exit(0);
