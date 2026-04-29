import {
  KNOCKBACK_DECAY,
  PLAYER_BOOST_MULT,
  PLAYER_BODY_RADIUS,
  PLAYER_ORBIT_PUSH_MARGIN,
  PLAYER_SPEED,
  BOOST_DRAIN_INTERVAL,
  POWERUP_SPEED_MULT,
  RING_BASE_CAP,
  outerOrbitRadius,
  resolveDecorCollision,
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
function pushOutPlayers(state: ArenaState): void {
  const list: Player[] = [];
  state.players.forEach((p) => {
    if (p.alive) list.push(p);
  });
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const minDist = playerShieldRadius(a) + playerShieldRadius(b);
      const dx = a.x - b.x;
      const dy = a.y - b.y;
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
      a.x += nx * overlap * 0.5;
      a.y += ny * overlap * 0.5;
      b.x -= nx * overlap * 0.5;
      b.y -= ny * overlap * 0.5;
    }
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

    // Knockback : amortissement exponentiel constant (e^(-dt/τ)). Calculé
    // même en hitlag pour que la décroissance ne saute pas après dégel.
    if (p.knockbackVx !== 0 || p.knockbackVy !== 0) {
      const decay = Math.exp(-dt / KNOCKBACK_DECAY);
      p.knockbackVx *= decay;
      p.knockbackVy *= decay;
      if (Math.hypot(p.knockbackVx, p.knockbackVy) < 0.05) {
        p.knockbackVx = 0;
        p.knockbackVy = 0;
      }
    }

    // Hitlag : on fige le mouvement (input ET knockback). On laisse quand
    // même les autres systèmes (rotation orbitale, push-out) tourner via
    // orbitTimeOffset pour préserver la cohérence visuelle.
    const inHitlag = p.hitlagUntil > now;
    if (inHitlag) {
      // Reset boost pour ne pas drainer pendant la pause.
      p.boost = false;
      p.boostAccum = 0;
      // On NE move PAS le joueur. Push-out décor reste appliqué (il pourrait
      // être coincé), mais sur sa position courante seulement.
      const pushed = resolveDecorCollision(p.x, p.y, PLAYER_BODY_RADIUS);
      p.x = pushed.x;
      p.y = pushed.y;
      return;
    }

    let dx = p.inputDx;
    let dy = p.inputDy;
    const mag = Math.hypot(dx, dy);
    if (mag > 1) {
      dx /= mag;
      dy /= mag;
    }

    const moving = mag > 0.05;
    let speed = PLAYER_SPEED;
    // Power-up SPEED : multiplicateur permanent tant que speedUntil > now.
    if (p.speedUntil > now) speed *= POWERUP_SPEED_MULT;
    p.boost = !!p.inputBoost && p.bladeCount > 0 && moving;
    if (p.boost) {
      speed *= PLAYER_BOOST_MULT;
      p.boostAccum += dt;
      while (p.boostAccum >= BOOST_DRAIN_INTERVAL && p.bladeCount > 0) {
        p.boostAccum -= BOOST_DRAIN_INTERVAL;
        removePlayerBlades(p, 1);
      }
    } else {
      p.boostAccum = 0;
    }

    if (moving) {
      p.dirX = dx;
      p.dirY = dy;
    }

    // Velocity totale = input + knockback résiduel.
    p.x += (dx * speed + p.knockbackVx) * dt;
    p.y += (dy * speed + p.knockbackVy) * dt;

    // Push-out décor.
    const pushed = resolveDecorCollision(p.x, p.y, PLAYER_BODY_RADIUS);
    p.x = pushed.x;
    p.y = pushed.y;

    // Pas de clamp aux bords : si le joueur dépasse la zone de mort, le
    // wall damage system le tuera au tick (avec drop des lames). Le clamp
    // précédent permettait de "wall-hug" sans pénalité.
  });

  // Push-out joueur-joueur (basé sur les orbites).
  pushOutPlayers(state);
}
