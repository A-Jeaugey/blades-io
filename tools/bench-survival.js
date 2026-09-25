// Banc de survie d'un débutant : un joueur naïf (il marche vers la lame au
// sol la plus proche, ne lance pas, ne fuit pas) entre dans une room
// publique dont les bots jouent depuis 5 minutes. Chaque vie est plafonnée à
// 30 s, après quoi le joueur repart de zéro : on mesure la vulnérabilité
// d'un nouveau venu, pas celle d'un joueur qui a grossi et que les bots ne
// chassent plus.
//
// Sert à vérifier qu'un changement des bots ou du combat ne rend pas les
// premières secondes plus meurtrières (tâches 1.3 et 3.2 du plan). Les
// tirages dépendent de tout le code simulé : pour comparer deux versions,
// lancer le banc sur chacune avec plusieurs graines, et regarder les écarts
// à l'aune de la variance entre séries de graines (quelques points de %).
//
// Prérequis : `npm test` (compile server/dist-test, dont TestRoom et
// l'horloge simulée).
// Usage     : node tools/bench-survival.js [minutesParGraine=10] [graines=1,2,3,4,5,6,7,8]
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "server/dist-test");
const { TestRoom } = require(path.join(DIST, "test/testRoom.js"));
const { FakeClock, seedRandom, DT } = require(path.join(DIST, "test/helpers.js"));
const { SPAWN_PROTECTION_MS } = require(require.resolve("@bladeio/shared", { paths: [path.join(ROOT, "server")] }));

const MINUTES = Number(process.argv[2] || 10);
const SEEDS = (process.argv[3] || "1,2,3,4,5,6,7,8").split(",").map(Number);
const WARMUP_S = 300;
const LIFE_CAP_S = 30;
// Lames au sol visées : loin du bord, pour ne pas mesurer des morts au mur.
const HARVEST_RADIUS = 180;

let lives = 0;
let deaths = 0;
let survivedSum = 0;
const reasons = {};
let botThrows = 0;
let botThrowKills = 0;

for (const seed of SEEDS) {
  const clock = new FakeClock();
  const restoreRandom = seedRandom(seed);
  const r = new TestRoom(clock, { bots: true });
  const room = r.room;
  const killPlayer = room.killPlayer.bind(room);
  let spawnAt = 0;
  let capping = false;
  room.killPlayer = (victim, killer, reason) => {
    if (victim.id === "h" && victim.alive && !capping) {
      deaths++;
      survivedSum += (clock.now - spawnAt) / 1000;
      reasons[reason] = (reasons[reason] || 0) + 1;
    } else if (victim.id !== "h" && victim.alive && reason === "throw") {
      botThrowKills++;
    }
    return killPlayer(victim, killer, reason);
  };

  for (let i = 0; i < WARMUP_S / DT; i++) {
    r.tick();
    r.events.length = 0;
  }

  const client = { sessionId: "h", leave: () => {} };
  const human = r.join("h");
  // TestRoom retire la protection de spawn (utile aux tests unitaires) :
  // on la rétablit, un vrai joueur l'a.
  human.spawnProtectionUntil = clock.now + SPAWN_PROTECTION_MS;
  spawnAt = clock.now;
  lives++;
  let deadSince = -1;
  let seq = 0;
  for (let i = 0; i < (MINUTES * 60) / DT; i++) {
    if (human.alive && clock.now - spawnAt >= LIFE_CAP_S * 1000) {
      // Vie plafonnée : comptée comme 30 s de survie, puis nouveau départ.
      // Ses lames tombent au sol comme à une mort (léger apport de butin).
      survivedSum += LIFE_CAP_S;
      capping = true;
      room.killPlayer(human, null, "cap");
      capping = false;
    }
    if (!human.alive) {
      if (deadSince < 0) deadSince = clock.now;
      if (clock.now - deadSince > 1000) {
        room.handleRespawn(client, {});
        spawnAt = clock.now;
        lives++;
        deadSince = -1;
      }
    } else {
      let best = null;
      let bestD = Infinity;
      r.state.blades.forEach((b) => {
        if (b.ownerId || b.isProjectile || Math.hypot(b.x, b.y) > HARVEST_RADIUS) return;
        const d = Math.hypot(b.x - human.x, b.y - human.y);
        if (d < bestD) { bestD = d; best = b; }
      });
      const dx = best ? (best.x - human.x) / bestD : 0;
      const dy = best ? (best.y - human.y) / bestD : 0;
      room.handleInput(client, { dx, dy, seq: ++seq });
    }
    r.tick();
    for (const e of r.events) {
      if (e.type === "bladeThrown" && e.message.thrownBy !== "h") botThrows++;
    }
    r.events.length = 0;
  }
  // Vie interrompue par la fin de la série : ni morte ni plafonnée.
  if (human.alive) lives--;
  restoreRandom();
  clock.restore();
}

console.log(`Graines ${SEEDS.join(",")}, ${MINUTES} min chacune après ${WARMUP_S / 60} min de bots seuls`);
console.log(`  vies                    : ${lives}`);
console.log(`  mortes avant ${LIFE_CAP_S} s       : ${deaths} (${((100 * deaths) / lives).toFixed(1)} %)`);
console.log(`  survie moyenne plafonnée : ${(survivedSum / lives).toFixed(1)} s`);
console.log(`  causes                  : ${JSON.stringify(reasons)}`);
console.log(`  lancers des bots        : ${botThrows}, bots éliminés par lancer : ${botThrowKills}`);
