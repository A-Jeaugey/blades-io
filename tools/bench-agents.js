// Banc d'équilibrage des agents (docs/AGENTS.md, §7) : rooms de bots seuls,
// agents répartis à tour de rôle (chaque nouveau bot prend le suivant),
// plusieurs graines. Par agent : score et éliminations par minute de vie,
// morts par minute, rapport éliminations / morts, durée moyenne d'une vie,
// pic de lames, capacités et ultimes lancés par minute.
//
// Critère : score par minute de chaque agent à ±15 % de la moyenne, rapport
// éliminations / morts entre 0,8 et 1,25. Les bots jouent les capacités
// avec des règles simples (server/src/systems/botAbilities.ts) : le banc
// mesure la puissance brute de chaque kit joué ainsi, pas le talent d'un
// joueur ; il écarte les déséquilibres grossiers.
//
// BENCH_NOCAST=1 : mêmes rooms, capacités coupées (le rythme du jeu sans
// elles, pour comparer).
//
// Prérequis : `npm test` (compile server/dist-test, dont TestRoom et
// l'horloge simulée).
// Usage     : [BENCH_NOCAST=1] node tools/bench-agents.js [minutesParGraine=10] [graines=1,2,3,4,5,6]
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "server/dist-test");
const { TestRoom } = require(path.join(DIST, "test/testRoom.js"));
const { FakeClock, seedRandom, DT } = require(path.join(DIST, "test/helpers.js"));
const shared = require(require.resolve("@bladeio/shared", { paths: [path.join(ROOT, "server")] }));
const { AGENT_IDS } = shared;

const args = process.argv.slice(2);
const MINUTES = Number(args[0] || 10);
const SEEDS = (args[1] || "1,2,3,4,5,6").split(",").map(Number);
const NOCAST = process.env.BENCH_NOCAST === "1";
// Les premières secondes (arène qui se remplit, tout le monde à 3 lames)
// ne sont pas comptées.
const WARMUP_S = 60;

const stats = Object.fromEntries(AGENT_IDS.map((a) => [a, {
  lives: 0, deaths: 0, kills: 0, aliveMs: 0, score: 0, peak: 0, ability: 0, ultimate: 0,
}]));

for (const [si, seed] of SEEDS.entries()) {
  const clock = new FakeClock();
  const restoreRandom = seedRandom(seed);
  const r = new TestRoom(clock, { bots: true });
  const room = r.room;
  // Agents à tour de rôle, décalés d'une graine à l'autre.
  let next = si;
  room.giveBotAgent = (p) => {
    room.abilities.setAgent(p, AGENT_IDS[next++ % AGENT_IDS.length]);
    room.abilities.startLife(p);
  };
  if (NOCAST) room.abilities.cast = () => null;
  const startMs = clock.now;
  const measuring = () => clock.now - startMs >= WARMUP_S * 1000;
  const born = new Map();
  const closeLife = (p, died) => {
    const t0 = born.get(p.id);
    born.delete(p.id);
    if (t0 === undefined || !p.agent) return;
    const s = stats[p.agent];
    s.lives++;
    if (died) s.deaths++;
    s.aliveMs += clock.now - t0;
    s.score += p.score;
    s.peak += p.maxBladeCount;
  };
  const killPlayer = room.killPlayer.bind(room);
  room.killPlayer = (victim, killer, reason) => {
    if (victim.alive && measuring()) {
      closeLife(victim, true);
      if (killer && killer.agent && killer.id !== victim.id) stats[killer.agent].kills++;
    }
    return killPlayer(victim, killer, reason);
  };
  for (let i = 0; i < (MINUTES * 60) / DT; i++) {
    r.tick();
    if (measuring()) {
      r.state.players.forEach((p) => {
        if (p.alive && p.agent && !born.has(p.id)) born.set(p.id, clock.now);
      });
      for (const e of r.events) {
        if (e.type !== "abilityCast") continue;
        const s = stats[e.message.agent];
        if (s) s[e.message.slot === 2 ? "ultimate" : "ability"]++;
      }
    }
    r.events.length = 0;
  }
  // Vies en cours à la fin de la série : comptées sans mort.
  r.state.players.forEach((p) => { if (p.alive) closeLife(p, false); });
  restoreRandom();
  clock.restore();
}

const rows = AGENT_IDS.map((a) => {
  const s = stats[a];
  const min = s.aliveMs / 60000;
  return {
    agent: a,
    lives: s.lives,
    scorePerMin: s.score / Math.max(1e-9, min),
    killsPerMin: s.kills / Math.max(1e-9, min),
    deathsPerMin: s.deaths / Math.max(1e-9, min),
    kd: s.kills / Math.max(1, s.deaths),
    lifeS: s.aliveMs / 1000 / Math.max(1, s.deaths),
    peak: s.peak / Math.max(1, s.lives),
    abilityPerMin: s.ability / Math.max(1e-9, min),
    ultPerMin: s.ultimate / Math.max(1e-9, min),
  };
});
const meanScore = rows.reduce((t, r) => t + r.scorePerMin, 0) / rows.length;
const pad = (s, n) => String(s).padStart(n);
console.log(`Agents${NOCAST ? " (capacités coupées)" : ""}. Graines ${SEEDS.join(",")}, ${MINUTES} min chacune (${WARMUP_S} s d'échauffement non comptées), 10 bots`);
console.log(`${"agent".padEnd(8)}${pad("vies", 6)}${pad("score/min", 11)}${pad("écart", 8)}${pad("élim/min", 10)}${pad("morts/min", 11)}${pad("É/M", 7)}${pad("vie (s)", 9)}${pad("pic", 7)}${pad("capa/min", 10)}${pad("ulti/min", 10)}`);
for (const r of rows) {
  const dev = (100 * (r.scorePerMin - meanScore)) / meanScore;
  console.log(
    `${r.agent.padEnd(8)}${pad(r.lives, 6)}${pad(r.scorePerMin.toFixed(1), 11)}${pad((dev >= 0 ? "+" : "") + dev.toFixed(0) + " %", 8)}` +
    `${pad(r.killsPerMin.toFixed(2), 10)}${pad(r.deathsPerMin.toFixed(2), 11)}${pad(r.kd.toFixed(2), 7)}${pad(r.lifeS.toFixed(0), 9)}` +
    `${pad(r.peak.toFixed(1), 7)}${pad(r.abilityPerMin.toFixed(2), 10)}${pad(r.ultPerMin.toFixed(2), 10)}`,
  );
}
const spread = Math.max(...rows.map((r) => Math.abs(r.scorePerMin - meanScore) / meanScore));
const kdOk = rows.every((r) => r.kd >= 0.8 && r.kd <= 1.25);
console.log(`Écart maximal du score par minute : ${(100 * spread).toFixed(0)} % (critère ±15 %) ; rapports É/M ${kdOk ? "dans" : "hors de"} [0,8 ; 1,25]`);
