// Banc de survie d'un débutant, dans une room publique dont les bots jouent
// depuis 5 minutes. Deux modes :
//
// - « capped » (défaut) : un joueur naïf (il marche vers la lame au sol la
//   plus proche, ne lance pas, ne fuit pas) ; chaque vie est plafonnée à
//   30 s, après quoi le joueur repart de zéro. Mesure la vulnérabilité d'un
//   nouveau venu, pas celle d'un joueur qui a grossi et que les bots ne
//   chassent plus. Sert à vérifier qu'un changement des bots ou du combat
//   ne rend pas les premières secondes plus meurtrières (tâches 1.3, 3.2).
//
// - « first » : sessions scriptées comme celles de l'audit (GAME-03). Des
//   nouveaux joueurs arrivent l'un après l'autre ; chacun reste immobile
//   3 s puis marche au hasard (nouvelle direction toutes les 1 à 3 s), sans
//   lancer ni boost. Seule concession : il fait demi-tour quand l'alerte de
//   bordure s'allume (à 25 u de la zone mortelle), comme un joueur qui la
//   voit. On mesure le temps avant sa première mort (plafonné à 180 s),
//   puis il quitte la room et le suivant arrive 1 s plus tard. Critère de
//   la tâche 3.2 : temps médian > 45 s.
//
// Les tirages dépendent de tout le code simulé : pour comparer deux
// versions, lancer le banc sur chacune avec plusieurs graines, et regarder
// les écarts à l'aune de la variance entre séries de graines.
//
// Prérequis : `npm test` (compile server/dist-test, dont TestRoom et
// l'horloge simulée).
// Usage     : node tools/bench-survival.js [capped|first] [minutesParGraine=10] [graines=1,2,3,4,5,6,7,8]
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.join(ROOT, "server/dist-test");
const { TestRoom } = require(path.join(DIST, "test/testRoom.js"));
const { FakeClock, seedRandom, DT } = require(path.join(DIST, "test/helpers.js"));
const shared = require(require.resolve("@bladeio/shared", { paths: [path.join(ROOT, "server")] }));
const { MAP_RADIUS, WALL_KILL_THICKNESS, outerOrbitRadius } = shared;

const args = process.argv.slice(2);
const MODE = args[0] === "first" || args[0] === "capped" ? args.shift() : "capped";
const MINUTES = Number(args[0] || 10);
const SEEDS = (args[1] || "1,2,3,4,5,6,7,8").split(",").map(Number);
const WARMUP_S = 300;

// Room chauffée : les bots jouent seuls pendant WARMUP_S.
function warmRoom(seed) {
  const clock = new FakeClock();
  const restoreRandom = seedRandom(seed);
  const r = new TestRoom(clock, { bots: true });
  for (let i = 0; i < WARMUP_S / DT; i++) {
    r.tick();
    r.events.length = 0;
  }
  return { clock, r, done: () => { restoreRandom(); clock.restore(); } };
}

// Nouveau venu, avec les protections d'un vrai joueur (TestRoom les retire
// par défaut pour les tests unitaires).
function joinNewcomer(r, id) {
  return r.join(id, {}, { protected: true });
}

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function runCapped() {
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
    const { clock, r, done } = warmRoom(seed);
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

    const client = { sessionId: "h", leave: () => {} };
    const human = joinNewcomer(r, "h");
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
    done();
  }

  console.log(`Mode capped. Graines ${SEEDS.join(",")}, ${MINUTES} min chacune après ${WARMUP_S / 60} min de bots seuls`);
  console.log(`  vies                    : ${lives}`);
  console.log(`  mortes avant ${LIFE_CAP_S} s       : ${deaths} (${((100 * deaths) / lives).toFixed(1)} %)`);
  console.log(`  survie moyenne plafonnée : ${(survivedSum / lives).toFixed(1)} s`);
  console.log(`  causes                  : ${JSON.stringify(reasons)}`);
  console.log(`  lancers des bots        : ${botThrows}, bots éliminés par lancer : ${botThrowKills}`);
}

function runFirst() {
  const LIFE_CAP_S = 180;
  const IDLE_S = 3;
  const WARN_GAP = 25;
  const lifetimes = [];
  const reasons = {};
  let censored = 0;
  const spawnRadii = [];
  const nearestAtSpawn = [];
  // Périodes de grâce interrompues avant terme (clash ou élimination : le
  // marcheur ne lance jamais), et à quel âge.
  const graceCut = [];

  for (const seed of SEEDS) {
    const { clock, r, done } = warmRoom(seed);
    const room = r.room;
    const killPlayer = room.killPlayer.bind(room);
    let current = null;
    let spawnAt = 0;
    room.killPlayer = (victim, killer, reason) => {
      if (current && victim === current && victim.alive) {
        lifetimes.push((clock.now - spawnAt) / 1000);
        reasons[reason] = (reasons[reason] || 0) + 1;
      }
      return killPlayer(victim, killer, reason);
    };
    if (room.endGrace) {
      const endGrace = room.endGrace.bind(room);
      room.endGrace = (p) => {
        if (p && p === current && p.graceUntil > clock.now) graceCut.push((clock.now - spawnAt) / 1000);
        return endGrace(p);
      };
    }

    let n = 0;
    let client = null;
    let seq = 0;
    let nextTurnAt = 0;
    let dir = { x: 0, y: 0 };
    let leftAt = clock.now - 1000;
    const end = clock.now + MINUTES * 60 * 1000;
    while (clock.now < end) {
      if (!current && clock.now - leftAt >= 1000) {
        const id = `h${++n}`;
        client = { sessionId: id, leave: () => {} };
        current = joinNewcomer(r, id);
        spawnAt = clock.now;
        seq = 0;
        nextTurnAt = clock.now + IDLE_S * 1000;
        dir = { x: 0, y: 0 };
        spawnRadii.push(Math.hypot(current.x, current.y));
        let nearest = Infinity;
        r.state.players.forEach((p) => {
          if (p === current || !p.alive) return;
          nearest = Math.min(nearest, Math.hypot(p.x - current.x, p.y - current.y));
        });
        nearestAtSpawn.push(nearest);
      }
      if (current) {
        if (!current.alive || clock.now - spawnAt >= LIFE_CAP_S * 1000) {
          if (current.alive) {
            lifetimes.push(LIFE_CAP_S);
            censored++;
          }
          room.onLeave(client, true);
          current = null;
          leftAt = clock.now;
        } else {
          const rad = Math.hypot(current.x, current.y);
          const gap = MAP_RADIUS - WALL_KILL_THICKNESS - rad - outerOrbitRadius(current.bladeCount);
          if (gap < WARN_GAP && rad > 1) {
            // Alerte de bordure : demi-tour vers le centre, à ±60° près.
            const a = Math.atan2(-current.y, -current.x) + (Math.random() * 2 - 1) * (Math.PI / 3);
            dir = { x: Math.cos(a), y: Math.sin(a) };
            nextTurnAt = clock.now + 1000 + Math.random() * 2000;
          } else if (clock.now >= nextTurnAt) {
            const a = Math.random() * Math.PI * 2;
            dir = { x: Math.cos(a), y: Math.sin(a) };
            nextTurnAt = clock.now + 1000 + Math.random() * 2000;
          }
          room.handleInput(client, { dx: dir.x, dy: dir.y, seq: ++seq });
        }
      }
      r.tick();
      r.events.length = 0;
    }
    // Session interrompue par la fin de la série : ni morte ni plafonnée.
    if (current) room.onLeave(client, true);
    done();
  }

  const sorted = [...lifetimes].sort((a, b) => a - b);
  const share = (s) => ((100 * lifetimes.filter((t) => t < s).length) / lifetimes.length).toFixed(0);
  const radii = [...spawnRadii].sort((a, b) => a - b);
  const near = [...nearestAtSpawn].sort((a, b) => a - b);
  console.log(`Mode first. Graines ${SEEDS.join(",")}, ${MINUTES} min chacune après ${WARMUP_S / 60} min de bots seuls`);
  console.log(`  sessions                 : ${lifetimes.length} (dont ${censored} plafonnées à ${LIFE_CAP_S} s)`);
  console.log(`  temps avant la 1re mort  : médiane ${quantile(sorted, 0.5).toFixed(1)} s, quartiles ${quantile(sorted, 0.25).toFixed(1)} / ${quantile(sorted, 0.75).toFixed(1)} s`);
  console.log(`  mortes avant 10 / 30 s   : ${share(10)} % / ${share(30)} %`);
  console.log(`  causes                   : ${JSON.stringify(reasons)}`);
  const cut = [...graceCut].sort((a, b) => a - b);
  if (cut.length) console.log(`  grâce interrompue        : ${cut.length} sessions, à ${quantile(cut, 0.5).toFixed(1)} s en médiane`);
  console.log(`  spawn : rayon médian ${quantile(radii, 0.5).toFixed(0)} u (max ${radii[radii.length - 1].toFixed(0)}), joueur le plus proche médiane ${quantile(near, 0.5).toFixed(0)} u (min ${near[0].toFixed(0)})`);
}

if (MODE === "first") runFirst();
else runCapped();
