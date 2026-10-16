import {
  BOOST_DRAIN_INTERVAL,
  INPUT_BACKLOG_KEEP,
  INPUT_BACKLOG_WINDOW_TICKS,
  MAX_STEP_CREDIT,
  PLAYER_BODY_RADIUS,
  PLAYER_ORBIT_PUSH_MARGIN,
  RING_BASE_CAP,
  SERVER_DT,
  VELOCITY_SYNC_SCALE,
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
    trimInputBacklog(p);
    // Inputs interrompus (coupure, onglet en arrière-plan) : il ne bouge
    // plus, les autres clients ne doivent plus l'extrapoler.
    if (now - p.movedAt > STALE_MOVE_MS && (p.moveVx !== 0 || p.moveVy !== 0)) setMoveVelocity(p, 0, 0);
  });

  // Push-out joueur-joueur (basé sur les orbites).
  pushOutPlayers(state);
}

// Trois ticks sans pas : ses inputs n'arrivent plus (un tick sans input,
// suivi d'un tick à deux, est la gigue ordinaire du réseau).
const STALE_MOVE_MS = 50;

// File en retard (cf. INPUT_BACKLOG_WINDOW_TICKS) : jamais descendue sous
// INPUT_BACKLOG_KEEP + 1 sur toute la fenêtre, ses plus anciens inputs sont
// abandonnés, acquittés sans être appliqués.
export function trimInputBacklog(p: Player): void {
  const queued = p.inputQueue.length;
  if (queued < p.backlogMin) p.backlogMin = queued;
  if (++p.backlogTicks < INPUT_BACKLOG_WINDOW_TICKS) return;
  const drop = p.backlogMin - INPUT_BACKLOG_KEEP;
  if (drop > 0) {
    const dropped = p.inputQueue.splice(0, drop);
    p.lastSeq = dropped[dropped.length - 1].seq;
  }
  p.backlogMin = Infinity;
  p.backlogTicks = 0;
}

// Vitesse du dernier pas et sa version envoyée aux autres clients (cf.
// VELOCITY_SYNC_SCALE) : une course en ligne droite, arrondis flottants
// près, ne change rien au patch.
export function setMoveVelocity(p: Player, vx: number, vy: number): void {
  p.moveVx = vx;
  p.moveVy = vy;
  p.velX = Math.round(vx * VELOCITY_SYNC_SCALE);
  p.velY = Math.round(vy * VELOCITY_SYNC_SCALE);
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
  const x0 = p.x;
  const y0 = p.y;
  const r = stepMovement(p, input, {
    speed: p.speedUntil > now,
    // Hitlag : déplacement figé, recul conservé pour la sortie du gel.
    frozen: p.hitlagUntil > now,
    canBoost: p.bladeCount > 0,
  }, dt);
  p.boost = r.boosting;
  // Déplacement réel du pas : le long d'un mur, il glisse ; contre un
  // pilier ou figé par le hitlag, il ne va nulle part.
  setMoveVelocity(p, (p.x - x0) / dt, (p.y - y0) / dt);
  p.movedAt = now;
  if (r.boosting) {
    p.lifeBoostMs += dt * 1000;
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
