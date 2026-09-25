import {
  BOOST_DRAIN_INTERVAL,
  MAX_STEP_CREDIT,
  PLAYER_BODY_RADIUS,
  PLAYER_ORBIT_PUSH_MARGIN,
  RING_BASE_CAP,
  SERVER_DT,
  MoveInput,
  outerOrbitRadius,
  stepMovement,
} from "@bladeio/shared";
import { ArenaState } from "../state/ArenaState";
import { Player } from "../state/Player";

// Rayon "shield" effectif d'un joueur. Le push-out pur basé sur l'orbite
// extérieure était trop généreux : avec 1 seule lame opposée au camp ennemi,
// le bouclier traitait l'orbite comme un mur plein → push-out maintenait les
// joueurs à 3.7u, et le blade-vs-body de l'attaquant ne pouvait JAMAIS se
// déclencher (sa lame restait à 1.9u du corps, threshold 1.65). On scale
// donc par "coverage" = fraction de l'anneau de base remplie. Avec 8+ lames,
// shield plein. En dessous, l'orbite a des gaps que l'attaquant peut exploiter.
function playerShieldRadius(p: Player): number {
  const orbitR = outerOrbitRadius(p.bladeCount);
  if (orbitR <= 0) return PLAYER_BODY_RADIUS;
  const coverage = Math.min(1, p.bladeCount / RING_BASE_CAP);
  const full = orbitR + PLAYER_ORBIT_PUSH_MARGIN;
  return PLAYER_BODY_RADIUS + (full - PLAYER_BODY_RADIUS) * coverage;
}

// Push-out symétrique entre deux joueurs : on pousse les deux centres
// jusqu'à ce que la distance soit au moins R_a + R_b. Itéré une seule fois,
// la dérive éventuelle sera corrigée au tick suivant.
// Positions et rayons de bouclier sont lus une fois par joueur dans des
// tableaux (les champs du schema passent par des accesseurs, et le rayon
// était recalculé pour chaque paire) ; les paires suivantes voient les
// positions déjà corrigées, comme avant. Avec des nombres en tableau, les
// ~1 800 paires d'une room de 60 joueurs coûtent quelques microsecondes :
// pas besoin de grille spatiale.
function pushOutPlayers(state: ArenaState): void {
  const list: Player[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  const radii: number[] = [];
  state.players.forEach((p) => {
    if (!p.alive) return;
    list.push(p);
    xs.push(p.x);
    ys.push(p.y);
    radii.push(playerShieldRadius(p));
  });
  const n = list.length;
  const moved = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const minDist = radii[i] + radii[j];
      const dx = xs[i] - xs[j];
      const dy = ys[i] - ys[j];
      const d2 = dx * dx + dy * dy;
      if (d2 >= minDist * minDist) continue;
      const dist = Math.sqrt(d2);
      let nx: number;
      let ny: number;
      if (dist < 1e-4) {
        // Cas dégénéré : on désynchronise sur un axe arbitraire
        nx = 1;
        ny = 0;
      } else {
        nx = dx / dist;
        ny = dy / dist;
      }
      const overlap = minDist - dist;
      xs[i] += nx * overlap * 0.5;
      ys[i] += ny * overlap * 0.5;
      xs[j] -= nx * overlap * 0.5;
      ys[j] -= ny * overlap * 0.5;
      moved[i] = 1;
      moved[j] = 1;
    }
  }
  for (let i = 0; i < n; i++) {
    if (!moved[i]) continue;
    list[i].x = xs[i];
    list[i].y = ys[i];
  }
}

export function updateMovement(
  dt: number,
  state: ArenaState,
  removePlayerBlades: (player: Player, count: number) => void,
): void {
  const now = Date.now();
  state.players.forEach((p) => {
    if (!p.alive) return;
    // Bots : un pas par tick avec leur input courant.
    if (p.isBot) {
      applyStep(p, { dx: p.inputDx, dy: p.inputDy, boost: p.inputBoost }, now, dt, removePlayerBlades);
      return;
    }
    // Humains : un pas de SERVER_DT par input reçu, dans l'ordre, comme le
    // client qui les rejoue (tâche 1.2). Crédit d'un pas par SERVER_DT
    // écoulé : un client qui envoie plus vite ne va pas plus vite, un
    // à-coup réseau se rattrape au tick suivant. Sans input reçu (coupure,
    // onglet en arrière-plan), pas de pas : le joueur s'arrête aussitôt,
    // au lieu de glisser 500 ms sur son dernier input.
    p.stepCredit = Math.min(MAX_STEP_CREDIT, p.stepCredit + dt / SERVER_DT);
    while (p.stepCredit >= 1 && p.inputQueue.length > 0) {
      const input = p.inputQueue.shift()!;
      p.stepCredit -= 1;
      p.inputDx = input.dx;
      p.inputDy = input.dy;
      p.inputBoost = input.boost;
      applyStep(p, input, now, SERVER_DT, removePlayerBlades);
      p.lastSeq = input.seq;
    }
  });

  // Push-out joueur-joueur (basé sur les orbites).
  pushOutPlayers(state);
}

// Un pas de mouvement (stepMovement, partagé avec la prédiction du client),
// plus ce que seul le serveur gère : drain du boost, direction retenue pour
// les lancers sans visée.
function applyStep(
  p: Player,
  input: MoveInput,
  now: number,
  dt: number,
  removePlayerBlades: (player: Player, count: number) => void,
): void {
  const r = stepMovement(p, input, {
    speed: p.speedUntil > now,
    // Hitlag : déplacement figé, recul conservé pour la sortie du gel.
    frozen: p.hitlagUntil > now,
    canBoost: p.bladeCount > 0,
  }, dt);
  p.boost = r.boosting;
  if (r.boosting) {
    p.boostAccum += dt;
    while (p.boostAccum >= BOOST_DRAIN_INTERVAL && p.bladeCount > 0) {
      p.boostAccum -= BOOST_DRAIN_INTERVAL;
      removePlayerBlades(p, 1);
    }
  } else {
    p.boostAccum = 0;
  }
  if (r.moving) {
    p.dirX = r.dx;
    p.dirY = r.dy;
  }
  // Pas de clamp aux bords : si le joueur dépasse la zone de mort, le
  // wall damage system le tuera au tick (avec drop des lames). Le clamp
  // précédent permettait de "wall-hug" sans pénalité.
}
