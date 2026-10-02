import {
  DECOR_COLLIDERS,
  MAP_RADIUS,
  PLAYER_BODY_RADIUS,
  SPAWN_CANDIDATES,
  SPAWN_CLEARANCE_BASE,
  SPAWN_CLEARANCE_MAX,
  SPAWN_CLEARANCE_PER_BLADE,
  SPAWN_LOOT_RADIUS,
  SPAWN_RADIUS,
  WALL_KILL_THICKNESS,
  resolveDecorCollision,
  sameTeam,
} from "@bladeio/shared";
import { ArenaState } from "../state/ArenaState";

export interface Point {
  x: number;
  y: number;
}

// Marge entre le butin (lames ambiantes, caisses, power-ups) et le mur :
// au-delà, les bots ne vont pas (bande d'évitement du mur, cf.
// botReachRadius dans systems/bots.ts). Du butin qui y apparaissait leur
// restait inaccessible et s'y accumulait (les lames ambiantes n'expirent
// pas, le plafond se remplissait de lames hors d'atteinte) ; dans l'arène
// à la taille de sa population (tâche 4.5), tous les bots d'une room
// finissaient collés à cette limite, à le viser sans jamais l'atteindre.
export const LOOT_WALL_MARGIN = 16;

// Marge entre un point d'apparition et le mur : resserré, il avance (tâche
// 7.1) ; l'apparition protège des murs SPAWN_PROTECTION_MS, puis il faut
// avoir le temps de rentrer.
const SPAWN_WALL_MARGIN = 20;

// Rayon de l'arène pour ce qui y apparaît (joueurs, lames, caisses,
// power-ups, évènements) : celui du moment, ou la cible d'un resserrement
// annoncé (tâche 4.5), pour ne rien faire naître dans la bande que le mur
// va reprendre.
export function zoneRadius(state: ArenaState): number {
  return state.arenaTarget > 0 ? Math.min(state.mapRadius, state.arenaTarget) : state.mapRadius;
}

// Part de la carte qu'occupe l'arène (tâche 4.5) : les plafonds du butin
// (lames ambiantes, caisses, power-ups), réglés pour la carte entière, en
// suivent pour garder la même densité. À plafonds fixes, l'arène d'un
// humain et de ses bots (171 u) doublait la densité : les bots, aimantés
// par les power-ups toujours à portée, ne chassaient plus guère, et le
// leader changeait deux fois moins souvent.
export function areaShare(state: ArenaState): number {
  const r = zoneRadius(state);
  return Math.min(1, (r * r) / (MAP_RADIUS * MAP_RADIUS));
}

// Rayon utile de l'arène, marge au mur déduite.
export function zoneInner(state: ArenaState, margin: number): number {
  return Math.max(0, zoneRadius(state) - WALL_KILL_THICKNESS - margin);
}

function inDecor(x: number, y: number): boolean {
  for (const d of DECOR_COLLIDERS) {
    const dx = x - d.x;
    const dy = y - d.y;
    const minR = d.radius + PLAYER_BODY_RADIUS + 1;
    if (dx * dx + dy * dy < minR * minR) return true;
  }
  return false;
}

// Distance à laquelle un joueur doit être tenu d'un nouveau venu : plus il
// a de lames, plus il est dangereux (orbite plus large, plus d'allonge).
export function spawnClearance(bladeCount: number): number {
  return Math.min(SPAWN_CLEARANCE_MAX, SPAWN_CLEARANCE_BASE + SPAWN_CLEARANCE_PER_BLADE * bladeCount);
}

// Modes équipe (tâche 7.2) : `camp` restreint les tirages au disque du camp
// de l'équipe, et seuls les adversaires comptent comme menaces.
export interface SpawnCamp {
  x: number;
  y: number;
  radius: number;
  team: number;
}

// Point d'apparition d'un joueur (tâche 3.2) : le meilleur de
// SPAWN_CANDIDATES tirages uniformes dans le disque de rayon SPAWN_RADIUS,
// ou dans l'arène resserrée d'une fin de manche (7.1), loin de son mur.
// Un point est sûr si chaque joueur vivant est au-delà de sa distance
// requise (spawnClearance). Parmi les points sûrs, celui qui a le plus de
// lames au sol à portée (de quoi grossir tout de suite) ; s'il n'y en a
// aucun, celui qui s'en approche le plus (plus grande marge).
export function pickSpawnPoint(state: ArenaState, camp?: SpawnCamp): Point {
  const others: Array<{ x: number; y: number; need: number }> = [];
  state.players.forEach((p) => {
    if (p.alive && !(camp && sameTeam(p.team, camp.team))) others.push({ x: p.x, y: p.y, need: spawnClearance(p.bladeCount) });
  });
  const loot: Point[] = [];
  state.blades.forEach((b) => {
    if (!b.ownerId && !b.isProjectile) loot.push({ x: b.x, y: b.y });
  });
  const lootR2 = SPAWN_LOOT_RADIUS * SPAWN_LOOT_RADIUS;
  const spawnR = Math.min(camp ? camp.radius : SPAWN_RADIUS, zoneInner(state, SPAWN_WALL_MARGIN));
  const cx = camp ? camp.x : 0;
  const cy = camp ? camp.y : 0;

  let best: Point | null = null;
  let bestSafe = false;
  let bestScore = -Infinity;
  for (let i = 0; i < SPAWN_CANDIDATES; i++) {
    const r = Math.sqrt(Math.random()) * spawnR;
    const a = Math.random() * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (inDecor(x, y)) continue;
    let margin = Infinity;
    for (const o of others) {
      margin = Math.min(margin, Math.hypot(o.x - x, o.y - y) - o.need);
    }
    const safe = margin >= 0;
    let score: number;
    if (safe) {
      let count = 0;
      for (const l of loot) {
        const dx = l.x - x;
        const dy = l.y - y;
        if (dx * dx + dy * dy < lootR2) count++;
      }
      // À butin égal, le plus à l'écart.
      score = count + Math.min(margin, 50) / 100;
    } else {
      score = margin;
    }
    if ((safe && !bestSafe) || (safe === bestSafe && score > bestScore)) {
      best = { x, y };
      bestSafe = safe;
      bestScore = score;
    }
  }
  return best ?? resolveDecorCollision(0, 0, PLAYER_BODY_RADIUS);
}

// Point d'apparition d'un bot : uniforme dans presque toute l'arène, à
// 25 u au moins des joueurs vivants. Les bots se répartissent sur toute la
// carte au lieu de se concentrer dans la zone des nouveaux venus. Sans
// point assez dégagé, le plus à l'écart des tirages : au centre, comme
// avant, ils s'empilaient dès que l'arène était pleine (petite arène d'une
// room qui se remplit d'un coup, tâche 4.5).
export function randomSpawnPoint(state: ArenaState): Point {
  const innerRadius = zoneInner(state, 5);
  let best: Point | null = null;
  let bestGap = -1;
  for (let tries = 0; tries < 30; tries++) {
    const r = Math.sqrt(Math.random()) * innerRadius * 0.8;
    const a = Math.random() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (inDecor(x, y)) continue;
    let gap2 = Infinity;
    state.players.forEach((p) => {
      if (!p.alive) return;
      const dx = p.x - x;
      const dy = p.y - y;
      gap2 = Math.min(gap2, dx * dx + dy * dy);
    });
    if (gap2 >= 25 * 25) return { x, y };
    if (gap2 > bestGap) {
      bestGap = gap2;
      best = { x, y };
    }
  }
  return best ?? resolveDecorCollision(0, 0, PLAYER_BODY_RADIUS);
}
