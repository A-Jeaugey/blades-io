// Banc de synchronisation entre clients : deux joueurs humains dans un salon
// privé, chacun derrière un proxy TCP qui retarde son flux (ping, gigue, et
// pour le troisième scénario des coupures). Chaque client simulé reprend la
// logique du vrai client : prédiction avec rejeu (InputPredictor), un input
// par pas de 60 Hz sur des images à 144 Hz, horloge des inputs
// (InputTickClock) et joueurs distants extrapolés jusqu'à l'instant du
// joueur local (RemoteMotion). La vérité est lue dans la room, dans le même
// processus, au même instant que chaque image.
//
// Mesures, à chaque image :
//  - désaccord entre les écrans : l'écart entre les deux joueurs vu par A,
//    moins celui vu par B (ce qu'un joueur appelle « sur mon écran il était
//    dans mes lames, sur le sien j'étais 5 m derrière ») ;
//  - sur chaque écran, l'autre joueur et soi par rapport au serveur : les
//    deux sont en avance d'un aller-retour (instant du joueur local), et
//    doivent l'être d'autant ;
//  - coupures : file d'inputs de A sur le serveur, et son avance sur le
//    serveur une fois le réseau revenu.
//
// Prérequis : `npm run build` (shared et serveur).
// Usage     : node tools/bench-netcode.js
//   BENCH_PING (aller-retour, ms, 100), BENCH_JITTER (ms, 10),
//   BENCH_STALL (coupure, ms, 300), BENCH_SEED (1), BENCH_PORT (3471).
const path = require("path");
const net = require("net");
const ROOT = path.resolve(__dirname, "..");
const PING = Number(process.env.BENCH_PING ?? 100);
const JITTER = Number(process.env.BENCH_JITTER ?? 10);
const STALL_MS = Number(process.env.BENCH_STALL ?? 300);
const SEED = Number(process.env.BENCH_SEED ?? 1);
const PORT = Number(process.env.BENCH_PORT ?? 3471);
process.env.PORT = String(PORT);
process.env.CHEATS = "1";

const S = require(path.join(ROOT, "shared/dist/index.js"));
const { ArenaRoom } = require(path.join(ROOT, "server/dist/rooms/ArenaRoom.js"));
const rooms = [];
const onCreate = ArenaRoom.prototype.onCreate;
ArenaRoom.prototype.onCreate = function (...args) {
  rooms.push(this);
  return onCreate.apply(this, args);
};
const log = console.log;
console.log = () => {};
require(path.join(ROOT, "server/dist/index.js"));
const { Client } = require(require.resolve("@colyseus/sdk", { paths: [ROOT] }));

const STEP_MS = S.SERVER_DT * 1000;
const FRAME_MS = 1000 / 144;
const ERR_DECAY_TAU = 0.1; // comme Game.ERR_DECAY_TAU (client/src/main.ts)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Proxy TCP : chaque paquet part après oneWay + gigue, dans l'ordre (une
// file par sens). Coupure : tout le flux attend stallMs, puis passe d'un
// bloc, comme TCP après une perte.
function lagProxy(listen, rand, opts) {
  const conns = [];
  const pipe = (src, dst) => {
    const q = [];
    let releaseAt = 0;
    let timer = null;
    let stallUntil = 0;
    let nextStall = opts.stallEveryMs > 0 ? Date.now() + opts.stallEveryMs : Infinity;
    const drain = () => {
      timer = null;
      const t = Date.now();
      while (q.length && q[0].at <= t) { const c = q.shift().chunk; if (!dst.destroyed) dst.write(c); }
      if (q.length) timer = setTimeout(drain, Math.max(0, q[0].at - t));
    };
    src.on("data", (chunk) => {
      const t = Date.now();
      if (opts.stalls && t >= nextStall) {
        stallUntil = t + opts.stallMs;
        nextStall = t + opts.stallEveryMs * (0.75 + rand() * 0.5);
      }
      const at = Math.max(releaseAt, t + opts.oneWay + rand() * opts.jitter, stallUntil > t ? stallUntil + opts.oneWay : 0);
      releaseAt = at;
      q.push({ at, chunk });
      if (!timer) timer = setTimeout(drain, Math.max(0, at - t));
    });
    src.on("error", () => {});
    src.on("close", () => setTimeout(() => dst.destroy(), opts.oneWay + opts.jitter + opts.stallMs + 50));
  };
  const server = net.createServer((client) => {
    const upstream = net.connect(PORT, "127.0.0.1");
    client.setNoDelay(true);
    upstream.setNoDelay(true);
    upstream.on("error", () => client.destroy());
    pipe(client, upstream);
    pipe(upstream, client);
    conns.push(client, upstream);
  });
  server.listen(listen);
  return { opts, close: () => { for (const c of conns) c.destroy(); server.close(); } };
}

// Client simulé : la logique de client/src/main.ts qui place les joueurs.
class BenchClient {
  constructor(port) {
    this.port = port;
    this.clock = { offsetSec: 0, ready: false };
    this.pred = new S.InputPredictor();
    this.ticks = new S.InputTickClock();
    this.remotes = new Map();
    this.seq = 0;
    this.accum = 0;
    this.errX = 0;
    this.errY = 0;
    this.input = { dx: 0, dy: 0, boost: false };
    this.lastFrame = now();
    this.me = null;
  }
  async join(code) {
    this.client = new Client(`ws://localhost:${this.port}`);
    this.room = await this.client.joinOrCreate("arena", { name: "bench", code, bots: false });
    this.id = this.room.sessionId;
    this.room.onMessage("*", () => {});
    this.room.onStateChange((st) => this.onPatch(st));
  }
  // ServerClock.onTick (client/src/net/ServerClock.ts).
  tickAt(ms) {
    return (ms / 1000 + this.clock.offsetSec) / S.SERVER_DT;
  }
  onPatch(st) {
    const t = now();
    const sample = st.tick * S.SERVER_DT - t / 1000;
    if (!this.clock.ready) { this.clock.offsetSec = sample; this.clock.ready = true; }
    else if (Math.abs(sample - this.clock.offsetSec) > 0.25) this.clock.offsetSec = sample;
    else this.clock.offsetSec += (sample - this.clock.offsetSec) * 0.05;
    st.players.forEach((p, id) => {
      if (id === this.id) {
        this.ticks.onAck(p.lastSeq, st.tick);
        if (!p.alive) { this.pred.reset(); return; }
        const was = this.pred.ready;
        const c = this.pred.reconcile({
          seq: p.lastSeq, x: p.x, y: p.y, knockbackVx: p.knockbackVx ?? 0, knockbackVy: p.knockbackVy ?? 0,
          serverTime: st.serverTime, speedUntil: p.speedUntil, hitlagUntil: p.hitlagUntil, bladeCount: p.bladeCount,
        });
        if (was && Math.hypot(c.dx, c.dy) <= 15) { this.errX -= c.dx; this.errY -= c.dy; }
        return;
      }
      let m = this.remotes.get(id);
      if (!m) { m = new S.RemoteMotion(p.x, p.y); this.remotes.set(id, m); }
      m.push(st.tick, p.x, p.y, (p.velX ?? 0) / S.VELOCITY_SYNC_SCALE, (p.velY ?? 0) / S.VELOCITY_SYNC_SCALE);
    });
  }
  frame() {
    const t = now();
    const frameMs = t - this.lastFrame;
    this.lastFrame = t;
    this.accum += frameMs;
    for (let i = 0; i < 5 && this.accum >= STEP_MS; i++) {
      this.accum -= STEP_MS;
      this.seq = (this.seq + 1) >>> 0;
      this.room.send("input", { ...this.input, seq: this.seq });
      this.pred.push(this.seq, this.input);
    }
    if (this.accum >= STEP_MS) this.accum = 0;
    const decay = Math.exp(-(frameMs / 1000) / ERR_DECAY_TAU);
    this.errX *= decay;
    this.errY *= decay;
    const alpha = Math.max(0, Math.min(1, this.accum / STEP_MS));
    this.me = null;
    if (this.pred.ready) {
      const b = this.pred.body;
      this.me = { x: this.pred.prevX + (b.x - this.pred.prevX) * alpha + this.errX, y: this.pred.prevY + (b.y - this.pred.prevY) * alpha + this.errY };
    }
    // Game.presentTick.
    const received = this.clock.ready ? this.tickAt(t) : 0;
    this.shownTick = !this.ticks.isReady ? received
      : Math.min(received + S.SERVER_TICKRATE, Math.max(received, this.ticks.tickOf(this.seq - 1 + alpha)));
    this.leadMs = (this.shownTick - received) * STEP_MS;
    for (const m of this.remotes.values()) m.update(this.shownTick, frameMs / 1000);
  }
  shown(id) {
    const m = this.remotes.get(id);
    return m ? { x: m.renderX, y: m.renderY } : null;
  }
  myServer() {
    return this.room.state.players.get(this.id);
  }
}

const stats = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const q = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : NaN);
  return { med: q(0.5), p95: q(0.95), max: s.length ? s[s.length - 1] : NaN, n: s.length };
};
const fmt = (a, unit = "u") => { const s = stats(a); return `méd ${s.med.toFixed(2)} ${unit}, p95 ${s.p95.toFixed(2)} ${unit}`; };

let scenarioIndex = 0;
async function scenario(name, { stalls, drive, runMs, runs = 3, measureFrom = 600 }) {
  const rand = mulberry32(SEED * 1000 + ++scenarioIndex);
  const base = { oneWay: PING / 2, jitter: JITTER, stallEveryMs: 2000, stallMs: STALL_MS };
  const proxies = [lagProxy(PORT + 1, rand, { ...base, stalls }), lagProxy(PORT + 2, rand, { ...base, stalls: false })];
  const A = new BenchClient(PORT + 1);
  const B = new BenchClient(PORT + 2);
  // Un salon neuf par scénario.
  const code = `NB${scenarioIndex}` + Math.floor(rand() * 1e6).toString(36).toUpperCase().slice(0, 2);
  await A.join(code);
  await B.join(code);
  const room = rooms.filter((r) => r.state.code === code).pop();
  let running = true;
  const truthOf = (id) => room.state.players.get(id);
  const m = { disagree: [], otherA: [], otherB: [], selfA: [], selfB: [], leadA: [], queueA: [], queueEnd: [] };
  let recording = false;
  (async () => {
    while (running) {
      A.frame();
      B.frame();
      if (recording && A.me && B.me) {
        const oB = A.shown(B.id), oA = B.shown(A.id);
        const sA = truthOf(A.id), sB = truthOf(B.id);
        if (oB && oA && sA && sB && sA.alive && sB.alive) {
          // Écart B − A sur chaque écran.
          const gA = [oB.x - A.me.x, oB.y - A.me.y];
          const gB = [B.me.x - oA.x, B.me.y - oA.y];
          m.disagree.push(Math.hypot(gA[0] - gB[0], gA[1] - gB[1]));
          m.otherA.push(Math.hypot(oB.x - sB.x, oB.y - sB.y));
          m.otherB.push(Math.hypot(oA.x - sA.x, oA.y - sA.y));
          m.selfA.push(Math.hypot(A.me.x - sA.x, A.me.y - sA.y));
          m.selfB.push(Math.hypot(B.me.x - sB.x, B.me.y - sB.y));
          m.leadA.push(A.leadMs);
          m.queueA.push(sA.inputQueue.length);
        }
      }
      await sleep(FRAME_MS);
    }
  })();
  await sleep(1500);
  A.room.send("cheat", { blades: 30 });
  B.room.send("cheat", { blades: 30 });
  const steer = async (c, x, y) => {
    for (let i = 0; i < 1000; i++) {
      const p = c.myServer();
      if (!p) { await sleep(50); continue; }
      const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy);
      if (d < 0.6) break;
      const k = Math.min(1, d / 3);
      c.input = { dx: (dx / d) * k, dy: (dy / d) * k, boost: false };
      await sleep(30);
    }
    c.input = { dx: 0, dy: 0, boost: false };
  };
  for (let r = 0; r < runs; r++) {
    // Couloirs dégagés (ni décor ni buisson), orbites assez loin pour ne pas
    // se toucher.
    await Promise.all([steer(A, -55, 22), steer(B, -55, 46)]);
    await sleep(700);
    const t0 = now();
    const stop = drive(A, B);
    while (now() - t0 < runMs) {
      recording = now() - t0 >= measureFrom;
      await sleep(20);
    }
    recording = false;
    stop();
    A.input = B.input = { dx: 0, dy: 0, boost: false };
    const sA = truthOf(A.id);
    if (sA) m.queueEnd.push(sA.inputQueue.length);
    await sleep(500);
    A.room.send("cheat", { blades: 10 });
    B.room.send("cheat", { blades: 10 });
  }
  running = false;
  await A.room.leave();
  await B.room.leave();
  for (const p of proxies) p.close();
  log(`\n${name}`);
  log(`  désaccord entre les écrans  : ${fmt(m.disagree)}`);
  log(`  écran A, B / serveur        : ${fmt(m.otherA)}   écran B, A / serveur : ${fmt(m.otherB)}`);
  log(`  écran A, soi / serveur      : ${fmt(m.selfA)}   écran B, soi / serveur : ${fmt(m.selfB)}`);
  log(`  avance dessinée de A        : ${fmt(m.leadA, "ms")}`);
  if (stalls) log(`  file d'inputs de A          : ${fmt(m.queueA, "")} ; en fin de course : ${m.queueEnd.join(", ")}`);
}

(async () => {
  log(`Banc de synchro : ping ${PING} ms, gigue ${JITTER} ms, graine ${SEED}`);
  await sleep(500);
  const chase = (A, B) => {
    A.input = { dx: 1, dy: 0, boost: true };
    B.input = { dx: 1, dy: 0, boost: true };
    return () => {};
  };
  await scenario("Ligne droite, les deux au boost", { stalls: false, runMs: 3000, drive: chase });
  await scenario("Zigzag : B change de cap (±45°) toutes les 350 ms, au boost", {
    stalls: false, runMs: 3150, measureFrom: 400,
    drive: (A, B) => {
      A.input = { dx: 1, dy: 0, boost: true };
      let k = 0;
      const turn = () => { const s = k++ % 2 ? 1 : -1; B.input = { dx: Math.SQRT1_2, dy: Math.SQRT1_2 * s, boost: true }; };
      turn();
      const iv = setInterval(turn, 350);
      return () => clearInterval(iv);
    },
  });
  await scenario(`Coupures de ${STALL_MS} ms toutes les ~2 s chez A, en marchant`, {
    stalls: true, runMs: 6000, measureFrom: 0,
    drive: (A, B) => {
      A.input = { dx: 1, dy: 0, boost: false };
      B.input = { dx: 1, dy: 0, boost: false };
      return () => {};
    },
  });
  process.exit(0);
})().catch((e) => { log(e); process.exit(1); });
