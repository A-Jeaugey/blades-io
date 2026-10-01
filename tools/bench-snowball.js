// Banc du snowball (tâche 4.2) : dans une room publique de bots, après 5 min
// de chauffe, mesure
//  - la rotation du leader (changements par heure) et la durée de ses
//    règnes : temps pendant lequel le même joueur vivant garde le meilleur
//    score (relevé à 2 Hz, comme le résumé de la room) ; un règne finit
//    quand il est dépassé ou qu'il meurt ; celui en cours à la fin d'une
//    graine compte pour sa durée jusque-là (sinon les plus longs, ceux
//    qu'on cherche à raccourcir, manqueraient) ;
//  - la part des éliminations « underdog » : le tueur avait au plus la
//    moitié des lames de sa victime au début de l'échange ;
//  - les éliminations du leader, et par qui.
//
// Comme bench-survival.js, les tirages dépendent de tout le code simulé :
// comparer deux versions aux mêmes graines, et à l'aune de l'écart entre
// séries de graines.
//
// Prérequis : `npm test` (compile server/dist-test).
// Usage     : node tools/bench-snowball.js [minutesParGraine=15] [graines=1,2,3,4,5,6,7,8]
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "server/dist-test");
const { TestRoom } = require(path.join(DIST, "test/testRoom.js"));
const { FakeClock, seedRandom, DT } = require(path.join(DIST, "test/helpers.js"));

const MINUTES = Number(process.argv[2] || 15);
const SEEDS = (process.argv[3] || "1,2,3,4,5,6,7,8").split(",").map(Number);
const WARMUP_S = 300;
const SAMPLE_EVERY = Math.round(0.5 / DT);

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const reigns = [];
let changes = 0;
let measuredS = 0;
let kills = 0;
let underdogKills = 0;
let leaderKills = 0;
let leaderKillsByUnderdog = 0;
let bountyTotal = 0;

for (const seed of SEEDS) {
  const clock = new FakeClock();
  const restoreRandom = seedRandom(seed);
  const r = new TestRoom(clock, { bots: true });
  let leader = null;
  let since = 0;
  const total = (WARMUP_S + MINUTES * 60) / DT;
  for (let i = 0; i < total; i++) {
    r.tick();
    const measuring = i * DT >= WARMUP_S;
    if (measuring) {
      for (const e of r.events) {
        if (e.type !== "playerKilled" || !e.message.killerId) continue;
        const m = e.message;
        kills++;
        const underdog = m.killerBlades !== null && m.killerBlades * 2 <= m.victimBlades;
        if (underdog) underdogKills++;
        if (m.victimId === leader) {
          leaderKills++;
          if (underdog) leaderKillsByUnderdog++;
        }
        if (m.bounty) bountyTotal += m.bounty;
      }
    }
    r.events.length = 0;
    if (i % SAMPLE_EVERY !== 0) continue;
    let top = null;
    r.state.players.forEach((p) => {
      if (p.alive && (!top || p.score > top.score)) top = p;
    });
    const topId = top ? top.id : null;
    if (topId !== leader) {
      if (measuring) {
        changes++;
        if (leader !== null) reigns.push(i * DT - Math.max(since, WARMUP_S));
      }
      leader = topId;
      since = i * DT;
    }
  }
  if (leader !== null) reigns.push(total * DT - Math.max(since, WARMUP_S));
  measuredS += MINUTES * 60;
  restoreRandom();
  clock.restore();
}

reigns.sort((a, b) => a - b);
const pct = (n, d) => (d ? ((100 * n) / d).toFixed(1) : "—");
console.log(`Graines ${SEEDS.join(",")}, ${MINUTES} min chacune après ${WARMUP_S / 60} min de chauffe`);
console.log(`  changements de leader   : ${changes}, soit ${((changes * 3600) / measuredS).toFixed(1)} par heure`);
console.log(`  règnes du leader        : ${reigns.length}, médiane ${quantile(reigns, 0.5).toFixed(1)} s, quartiles ${quantile(reigns, 0.25).toFixed(1)} / ${quantile(reigns, 0.75).toFixed(1)} s, max ${reigns.length ? reigns[reigns.length - 1].toFixed(0) : "—"} s`);
console.log(`  éliminations            : ${kills}, dont underdog ${underdogKills} (${pct(underdogKills, kills)} %)`);
console.log(`  leader éliminé          : ${leaderKills} fois, dont ${leaderKillsByUnderdog} par un underdog${bountyTotal ? `, primes versées ${bountyTotal}` : ""}`);
