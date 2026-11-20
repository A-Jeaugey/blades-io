import {
  KNOCKBACK_DECAY,
  PLAYER_BODY_RADIUS,
  PLAYER_BOOST_MULT,
  PLAYER_SPEED,
  POWERUP_SPEED_BOOST_CAP,
  POWERUP_SPEED_MULT,
} from "./constants";
import { resolveDecorCollision } from "./decor";
import { resolveMapCollision, type GameMap } from "./maps";

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
  // Impulsion posée au début de ce pas (u/s), à la place du recul en cours :
  // Éclair de Volt (agents.ts). Elle s'amortit ensuite comme un recul. Portée
  // par l'input qui l'a demandée, pour que le serveur et la prédiction du
  // client la posent au même pas.
  impulseX?: number;
  impulseY?: number;
}

// Attraction vers un point (Singularité de Vortex) : strength u/s dans le
// rayon, éteinte sur `core` u près du centre.
export interface PullField {
  x: number;
  y: number;
  radius: number;
  strength: number;
  core: number;
}

export interface MoveContext {
  // Power-up Speed actif pendant ce pas.
  speed: boolean;
  // Hitlag en cours : déplacement figé, recul conservé pour la sortie.
  frozen: boolean;
  // Le boost demande au moins une lame (sauf Surtension, agents.ts).
  canBoost: boolean;
  // Carte à murs du mode (maps.ts). Absente : le décor de l'arène ronde.
  // Le serveur et la prédiction du client doivent donner la même.
  map?: GameMap | null;
  // Vitesse de marche (boost et Speed compris) multipliée : Piège, Bastion.
  speedMult?: number;
  // Attractions subies pendant ce pas.
  pulls?: readonly PullField[] | null;
}

function resolveObstacles(map: GameMap | null | undefined, x: number, y: number): { x: number; y: number } {
  return map ? resolveMapCollision(map, x, y, PLAYER_BODY_RADIUS) : resolveDecorCollision(x, y, PLAYER_BODY_RADIUS);
}

export interface MoveResult {
  // Direction appliquée (normalisée si l'input dépasse 1).
  dx: number;
  dy: number;
  // Vitesse appliquée à cette direction (u/s), recul non compris.
  speed: number;
  moving: boolean;
  boosting: boolean;
}

const FROZEN: MoveResult = { dx: 0, dy: 0, speed: 0, moving: false, boosting: false };

// Déplacement d'un pas au-delà duquel il est découpé en sous-pas, chacun
// suivi de la poussée du décor. Jusqu'ici, un pas ne dépassait jamais
// 0,42 u (25 u/s au plafond du boost sous Speed) : le décor et les murs
// suffisaient à arrêter le corps. Un bond d'Éclair va bien plus vite (jusqu'à
// ~1,2 u par pas) : sans sous-pas, il traversait une barrière du Quartier
// (0,35 u d'épaisseur). Sous ce seuil, un seul pas, comme avant.
const SUBSTEP_MAX = 0.45;
const SUBSTEPS_MAX = 4;

export function stepMovement(body: MoveBody, input: MoveInput, ctx: MoveContext, dt: number): MoveResult {
  // Impulsion d'abord : posée même pendant un gel (elle part à la sortie,
  // comme un recul).
  if (input.impulseX !== undefined || input.impulseY !== undefined) {
    body.knockbackVx = input.impulseX ?? 0;
    body.knockbackVy = input.impulseY ?? 0;
  }
  if (ctx.frozen) {
    // Pas de déplacement ; la poussée du décor s'applique quand même (on
    // pourrait avoir été poussé dedans).
    const pushed = resolveObstacles(ctx.map, body.x, body.y);
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
  // Speed et boost se multiplient, plafonnés (cf. POWERUP_SPEED_BOOST_CAP).
  let mult = ctx.speed ? POWERUP_SPEED_MULT : 1;
  const boosting = input.boost && ctx.canBoost && moving;
  if (boosting) mult = Math.min(mult * PLAYER_BOOST_MULT, Math.max(PLAYER_BOOST_MULT, POWERUP_SPEED_BOOST_CAP));
  const speed = PLAYER_SPEED * mult * (ctx.speedMult ?? 1);

  // Vitesse totale = input + recul + attractions.
  let vx = dx * speed + body.knockbackVx;
  let vy = dy * speed + body.knockbackVy;
  if (ctx.pulls) {
    for (const f of ctx.pulls) {
      const px = f.x - body.x;
      const py = f.y - body.y;
      const d = Math.hypot(px, py);
      if (d >= f.radius || d < 1e-3) continue;
      const k = (f.strength * Math.min(1, d / f.core)) / d;
      vx += px * k;
      vy += py * k;
    }
  }
  const travel = Math.hypot(vx, vy) * dt;
  const n = travel > SUBSTEP_MAX ? Math.min(SUBSTEPS_MAX, Math.ceil(travel / SUBSTEP_MAX)) : 1;
  const sdt = dt / n;
  for (let i = 0; i < n; i++) {
    body.x += vx * sdt;
    body.y += vy * sdt;
    // Carte à murs : un second passage, pour le coin de deux obstacles (le
    // premier peut repousser dans le voisin).
    let pushed = resolveObstacles(ctx.map, body.x, body.y);
    if (ctx.map) pushed = resolveMapCollision(ctx.map, pushed.x, pushed.y, PLAYER_BODY_RADIUS);
    body.x = pushed.x;
    body.y = pushed.y;
  }
  return { dx, dy, speed, moving, boosting };
}
