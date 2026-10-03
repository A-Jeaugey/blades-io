// Banc des champions (tâche 4.12) : un joueur aguerri à grosse orbite dans
// une room publique dont les bots jouent depuis 5 minutes. Il récolte la
// lame au sol la plus proche (comme le marcheur de bench-survival.js) et
// fuit tout joueur plus gros que lui à moins de 25 u ; mort, il réapparaît
// avec la même orbite. Mesure : champions apparus (taille, record), qui les
// élimine, part du temps avec un champion en vie, plus gros bot, morts du
// joueur et leurs auteurs. Les morts « wall » viennent du script de fuite,
// qui ne regarde pas le bord.
//
// Comme les autres bancs, les tirages dépendent de tout le code simulé :
// comparer deux versions aux mêmes graines.
//
// Prérequis : `npm test` (compile server/dist-test).
// Usage     : node tools/bench-champions.js [lames=150] [minutesParGraine=10] [graines=1,2,3,4]
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const START = Number(process.argv[2] || 150);
const MINUTES = Number(process.argv[3] || 10);
const SEEDS = (process.argv[4] || "1,2,3,4").split(",").map(Number);
const DIST = path.join(ROOT, "server/dist-test");
const { TestRoom } = require(path.join(DIST, "test/testRoom.js"));
const { FakeClock, seedRandom, DT, giveBlade } = require(path.join(DIST, "test/helpers.js"));

const WARMUP_S = 300;
let vetDeaths = 0;
const vetKillers = {};
let champSpawns = 0;
const champStart = [];
const champPeak = [];
let champDeaths = 0;
const champKillers = {};
let champAliveSamples = 0;
let samples = 0;
let vetKills = 0;
let vetKillsOfChamps = 0;
const biggestBot = [];
const vetBlades = [];

for (const seed of SEEDS) {
  const clock = new FakeClock();
  const restore = seedRandom(seed);
  const r = new TestRoom(clock, { bots: true });
  for (let i = 0; i < WARMUP_S / DT; i++) { r.tick(); r.events.length = 0; }
  const client = { sessionId: "v", leave: () => {} };
  const vet = r.join("v", {}, { protected: true, newcomer: false });
  while (vet.bladeCount < START) giveBlade(r.state, vet);
  const seen = new Map();
  let deadSince = -1;
  let seq = 0;
  for (let i = 0; i < (MINUTES * 60) / DT; i++) {
    if (!vet.alive) {
      if (deadSince < 0) deadSince = clock.now;
      if (clock.now - deadSince > 1000) {
        r.room.handleRespawn(client, {});
        while (vet.bladeCount < START) giveBlade(r.state, vet);
        deadSince = -1;
      }
    } else {
      // Fuite devant plus gros que soi à moins de 25 u, sinon récolte.
      let fx = 0, fy = 0;
      r.state.players.forEach((p) => {
        if (p.id === vet.id || !p.alive || p.bladeCount <= vet.bladeCount) return;
        const d = Math.hypot(vet.x - p.x, vet.y - p.y);
        if (d < 25 && d > 0.01) { fx += (vet.x - p.x) / d; fy += (vet.y - p.y) / d; }
      });
      let dx = 0, dy = 0;
      if (fx || fy) {
        const m = Math.hypot(fx, fy);
        dx = fx / m; dy = fy / m;
      } else {
        let best = null, bestD = Infinity;
        r.state.blades.forEach((b) => {
          if (b.ownerId || b.isProjectile || Math.hypot(b.x, b.y) > r.state.mapRadius * 0.72) return;
          const d = Math.hypot(b.x - vet.x, b.y - vet.y);
          if (d < bestD) { bestD = d; best = b; }
        });
        if (best) { dx = (best.x - vet.x) / bestD; dy = (best.y - vet.y) / bestD; }
      }
      r.room.handleInput(client, { dx, dy, seq: ++seq });
    }
    r.tick();
    for (const e of r.events) {
      if (e.type !== "playerKilled") continue;
      const m = e.message;
      const killer = m.killerId ? r.state.players.get(m.killerId) : null;
      const killerKind = !m.killerId ? m.cause : killer?.champion ? "champion" : killer?.isBot ? "bot" : "humain";
      if (m.victimId === "v") { vetDeaths++; vetKillers[killerKind] = (vetKillers[killerKind] || 0) + 1; }
      if (m.killerId === "v") vetKills++;
      if (seen.has(m.victimId)) {
        champDeaths++;
        champKillers[m.killerId === "v" ? "vétéran" : killerKind] = (champKillers[m.killerId === "v" ? "vétéran" : killerKind] || 0) + 1;
        if (m.killerId === "v") vetKillsOfChamps++;
        champPeak.push(seen.get(m.victimId));
        seen.delete(m.victimId);
      }
    }
    r.events.length = 0;
    r.state.players.forEach((p) => {
      if (!p.isBot || !p.champion || !p.alive) return;
      if (!seen.has(p.id)) { champSpawns++; champStart.push(p.bladeCount); seen.set(p.id, p.bladeCount); }
      seen.set(p.id, Math.max(seen.get(p.id), p.bladeCount));
    });
    if (i % 30 === 0) {
      samples++;
      let anyChamp = false, big = 0;
      r.state.players.forEach((p) => {
        if (!p.isBot || !p.alive) return;
        if (p.champion) anyChamp = true;
        big = Math.max(big, p.bladeCount);
      });
      if (anyChamp) champAliveSamples++;
      biggestBot.push(big);
      if (vet.alive) vetBlades.push(vet.bladeCount);
    }
  }
  for (const v of seen.values()) champPeak.push(v);
  restore();
  clock.restore();
}
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : NaN; };
console.log(`Vétéran à ${START} lames, ${SEEDS.length} graines × ${MINUTES} min après 5 min de bots seuls`);
console.log(`  morts du vétéran   : ${vetDeaths} ${JSON.stringify(vetKillers)} ; ses kills : ${vetKills}, dont champions ${vetKillsOfChamps}`);
console.log(`  orbite du vétéran  : médiane ${q(vetBlades, 0.5)}, p10 ${q(vetBlades, 0.1)}, p90 ${q(vetBlades, 0.9)}`);
console.log(`  champions apparus  : ${champSpawns}, taille d'apparition médiane ${q(champStart, 0.5)}, record médian ${q(champPeak, 0.5)}, max ${q(champPeak, 1)}`);
console.log(`  champions tombés   : ${champDeaths} ${JSON.stringify(champKillers)}`);
console.log(`  temps avec un champion en vie : ${((100 * champAliveSamples) / samples).toFixed(0)} %`);
console.log(`  plus gros bot      : médiane ${q(biggestBot, 0.5)}, p90 ${q(biggestBot, 0.9)}, max ${q(biggestBot, 1)}`);
