import {
  KNOCKBACK_DECAY,
  PLAYER_BODY_RADIUS,
  PLAYER_BOOST_MULT,
  PLAYER_SPEED,
  POWERUP_SPEED_MULT,
} from "./constants";
import { resolveDecorCollision } from "./decor";

// Pas de mouvement d'un joueur, partagé par le serveur (un pas par input
// reçu) et le client (prédiction, puis rejeu des inputs pas encore
// appliqués par le serveur) : pour les mêmes inputs, les deux calculent la
// même trajectoire (tâche 1.2). Le reste de la physique serveur (poussée
// entre joueurs, zone mortelle, drain du boost) n'est pas prédit.

export interface MoveBody {
  x: number;
  y: number;
  // Recul résiduel (u/s), amorti à chaque pas hors hitlag.
  knockbackVx: number;
  knockbackVy: number;
}

export interface MoveInput {
  dx: number;
  dy: number;
  boost: boolean;
}

export interface MoveContext {
  // Power-up Speed actif pendant ce pas.
  speed: boolean;
  // Hitlag en cours : déplacement figé, recul conservé pour la sortie.
  frozen: boolean;
  // Le boost demande au moins une lame.
  canBoost: boolean;
}

export interface MoveResult {
  // Direction appliquée (normalisée si l'input dépasse 1).
  dx: number;
  dy: number;
  moving: boolean;
  boosting: boolean;
}

const FROZEN: MoveResult = { dx: 0, dy: 0, moving: false, boosting: false };

export function stepMovement(body: MoveBody, input: MoveInput, ctx: MoveContext, dt: number): MoveResult {
  if (ctx.frozen) {
    // Pas de déplacement ; la poussée du décor s'applique quand même (on
    // pourrait avoir été poussé dedans).
    const pushed = resolveDecorCollision(body.x, body.y, PLAYER_BODY_RADIUS);
    body.x = pushed.x;
    body.y = pushed.y;
    return FROZEN;
  }

  // Recul : amortissement exponentiel (e^(-dt/τ)), négligeable sous 0,05 u/s.
  if (body.knockbackVx !== 0 || body.knockbackVy !== 0) {
    const decay = Math.exp(-dt / KNOCKBACK_DECAY);
    body.knockbackVx *= decay;
    body.knockbackVy *= decay;
    if (Math.hypot(body.knockbackVx, body.knockbackVy) < 0.05) {
      body.knockbackVx = 0;
      body.knockbackVy = 0;
    }
  }

  let dx = input.dx;
  let dy = input.dy;
  const mag = Math.hypot(dx, dy);
  if (mag > 1) {
    dx /= mag;
    dy /= mag;
  }
  const moving = mag > 0.05;
  let speed = PLAYER_SPEED;
  if (ctx.speed) speed *= POWERUP_SPEED_MULT;
  const boosting = input.boost && ctx.canBoost && moving;
  if (boosting) speed *= PLAYER_BOOST_MULT;

  // Vitesse totale = input + recul.
  body.x += (dx * speed + body.knockbackVx) * dt;
  body.y += (dy * speed + body.knockbackVy) * dt;
  const pushed = resolveDecorCollision(body.x, body.y, PLAYER_BODY_RADIUS);
  body.x = pushed.x;
  body.y = pushed.y;
  return { dx, dy, moving, boosting };
}
