// Banc des grosses orbites : deux joueurs de N lames se chargent en boost
// (recul actif) au milieu des bots d'une arène normale, pendant 6 s
// simulées. Mesure la durée réelle des ticks (moyenne, p99, pire, ticks
// hors budget de 16,7 ms) : un tick trop long gèle toutes les rooms du
// process, Node n'ayant qu'un fil.
//
// Sert à vérifier qu'un changement du combat (collisions, destructions,
// recompactage des anneaux) tient le contact de deux orbites pleines
// (MAX_BLADES_PER_PLAYER). L'issue du combat (lames restantes) doit être la
// même avant et après un changement qui ne touche pas aux règles.
//
// Prérequis : `npm test` (compile server/dist-test, dont TestRoom et
// l'horloge simulée).
// Usage     : node tools/bench-giants.js [lames=500,1000,2000] [graine=7]
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "server/dist-test");
const { TestRoom } = require(path.join(DIST, "test/testRoom.js"));
const { FakeClock, seedRandom } = require(path.join(DIST, "test/helpers.js"));
const shared = require(require.resolve("@bladeio/shared", { paths: [path.join(ROOT, "server")] }));
const { outerOrbitRadius } = shared;

const SIZES = (process.argv[2] || "500,1000,2000").split(",").map(Number);
const SEED = parseInt(process.argv[3] || "7", 10);
const TICKS = 360;
const BUDGET_MS = 1000 / 60;

for (const n of SIZES) {
  const clock = new FakeClock();
  const restore = seedRandom(SEED);
  const r = new TestRoom(clock, { bots: true });
  // Sans champion (tâche 4.12) : deux humains aguerris en feraient
  // apparaître deux à 300 lames au milieu du combat, et le banc mesure le
  // contact de deux orbites, pas leur arrivée.
  r.room.bots.nextChampionAt = Infinity;
  const a = r.join("a");
  const b = r.join("b");
  r.room.giveBlades(a, n - a.bladeCount);
  r.room.giveBlades(b, n - b.bladeCount);
  // Face à face, orbites à 12 u l'une de l'autre.
  const R = outerOrbitRadius(n);
  a.x = -(R + 6); a.y = 0;
  b.x = R + 6; b.y = 0;
  const times = [];
  for (let i = 0; i < TICKS; i++) {
    a.inputQueue.push({ dx: 1, dy: 0, boost: true, seq: i + 1 });
    b.inputQueue.push({ dx: -1, dy: 0, boost: true, seq: i + 1 });
    const t0 = process.hrtime.bigint();
    r.tick(1);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  const sorted = times.slice().sort((x, y) => x - y);
  const mean = times.reduce((s, t) => s + t, 0) / times.length;
  console.log(JSON.stringify({
    blades: n,
    orbitRadius: +R.toFixed(1),
    tickMs: {
      mean: +mean.toFixed(2),
      p99: +sorted[Math.floor(sorted.length * 0.99)].toFixed(1),
      max: +sorted[sorted.length - 1].toFixed(1),
    },
    overBudget: times.filter((t) => t > BUDGET_MS).length,
    ticks: TICKS,
    left: { a: a.alive ? a.bladeCount : "mort", b: b.alive ? b.bladeCount : "mort" },
  }));
  restore();
  clock.restore();
}
