import { ArenaState } from "../state/ArenaState";
import { Blade } from "../state/Blade";
import {
  GROUND_BLADE_FRICTION,
  MAP_RADIUS,
  MAX_BLADES_PER_PLAYER,
  PICKUP_MAGNET_RADIUS,
  PICKUP_MAGNET_STRENGTH,
  POWERUP_MAGNET_MULT,
  POWERUP_SPIN_MULT,
  WALL_KILL_THICKNESS,
  bladeCountRotationMult,
  ringRadius,
  slotAngle,
  tierRotationMult,
} from "@bladeio/shared";

// Copies locales : les exports de @bladeio/shared sont des ré-exports
// CommonJS, lus à travers un getter à chaque accès. Le profil (audit
// 2026-09) en attribuait ~14 % du tick aux lectures faites dans les boucles.
const MAGNET_RADIUS = PICKUP_MAGNET_RADIUS;
const MAGNET_RADIUS_BOOSTED = PICKUP_MAGNET_RADIUS * POWERUP_MAGNET_MULT;
const MAGNET_STRENGTH = PICKUP_MAGNET_STRENGTH;
const FRICTION = GROUND_BLADE_FRICTION;
const MAX_BLADES = MAX_BLADES_PER_PLAYER;
const SPIN_MULT = POWERUP_SPIN_MULT;
const GROUND_MAX_R = MAP_RADIUS - WALL_KILL_THICKNESS - 0.5;
const GROUND_MAX_R_SQ = GROUND_MAX_R * GROUND_MAX_R;
const angleOf = slotAngle;
const radiusOf = ringRadius;
const tierRot = tierRotationMult;
const countRot = bladeCountRotationMult;

// Grille d'aimantation : une cellule mesure au moins le plus grand rayon
// d'aimant (power-up compris), donc les 3×3 cellules autour d'une lame
// contiennent tous les joueurs qui peuvent l'attirer.
const MAGNET_CELL = MAGNET_RADIUS_BOOSTED;
function cellKey(cx: number, cy: number): number {
  return (cx + 1024) * 2048 + (cy + 1024);
}

// Cache local (hors schema) des positions monde des lames en orbite.
// Rempli à chaque tick, utilisé par le système de collisions.
export class OrbitPositionCache {
  private positions = new Map<string, { x: number; y: number }>();

  get(bladeId: string): { x: number; y: number } | undefined {
    return this.positions.get(bladeId);
  }

  clear(): void {
    this.positions.clear();
  }

  set(bladeId: string, x: number, y: number): void {
    this.positions.set(bladeId, { x, y });
  }
}

// À chaque tick :
// - lames orphelines (ownerId pointant vers un joueur disparu ou mort) :
//   nettoyées pour éviter les "fantômes d'orbite" non ramassables.
// - pour les lames en orbite, calcule (x, y) en local (pas dans le schema).
// - pour les lames au sol, applique la friction et écrit (x, y) dans le schema.
//
// Les champs synchronisés des joueurs sont lus une fois par tick (fiches
// OwnerOrbit et MagnetSource) plutôt qu'à chaque lame : chaque lecture
// passe par un accesseur @colyseus/schema.
interface OwnerOrbit {
  x: number;
  y: number;
  effT: number;
  spinPhase: number;
  spinScale: number;
  rotMult: number;
  ringCounts: number[];
}

interface MagnetSource {
  x: number;
  y: number;
  radius: number;
  radiusSq: number;
}

export function updateBladePositions(
  dt: number,
  elapsed: number,
  state: ArenaState,
  cache: OrbitPositionCache,
): void {
  const nowMs = Date.now();

  // Fiches joueurs. Pendant le hitlag d'un joueur, on avance son
  // orbitTimeOffset au même rythme que `elapsed` : (elapsed -
  // orbitTimeOffset) reste constant, donc les angles ne bougent pas. Le
  // client lit ce champ et fait pareil.
  const owners = new Map<string, OwnerOrbit>();
  const magnetGrid = new Map<number, MagnetSource[]>();
  let magnetCount = 0;
  state.players.forEach((p) => {
    if (!p.alive) return;
    if (p.hitlagUntil > nowMs) p.orbitTimeOffset += dt;
    const bladeCount = p.bladeCount;
    const x = p.x;
    const y = p.y;
    // Multiplicateur global de rotation = tier × blade-count × spin power-up.
    // La hitbox élargie compense la fenêtre d'esquive raccourcie.
    const spinBoost = p.spinUntil > nowMs ? SPIN_MULT : 1;
    owners.set(p.id, {
      x,
      y,
      effT: elapsed - p.orbitTimeOffset,
      spinPhase: p.spinPhase,
      spinScale: p.spinScale,
      rotMult: tierRot(p.tier) * countRot(bladeCount) * spinBoost,
      ringCounts: [],
    });
    // Seuls les joueurs qui peuvent encore ramasser attirent les lames.
    if (bladeCount >= MAX_BLADES) return;
    const radius = p.magnetUntil > nowMs ? MAGNET_RADIUS_BOOSTED : MAGNET_RADIUS;
    const key = cellKey(Math.floor(x / MAGNET_CELL), Math.floor(y / MAGNET_CELL));
    let cell = magnetGrid.get(key);
    if (!cell) {
      cell = [];
      magnetGrid.set(key, cell);
    }
    cell.push({ x, y, radius, radiusSq: radius * radius });
    magnetCount++;
  });

  // Lames orphelines (orbite dont l'owner a disparu ou est mort) et
  // comptage des lames par anneau pour l'angle. L'échéance des drops au
  // sol est gérée à part, à la cadence du spawner (cf. expireGroundBlades).
  const toDelete: string[] = [];
  state.blades.forEach((b) => {
    const ownerId = b.ownerId;
    if (!ownerId) return;
    const owner = owners.get(ownerId);
    if (!owner) {
      toDelete.push(b.id);
      return;
    }
    const ring = b.ringIndex;
    owner.ringCounts[ring] = (owner.ringCounts[ring] ?? 0) + 1;
  });
  for (const id of toDelete) state.blades.delete(id);

  cache.clear();
  const decel = FRICTION * dt;
  state.blades.forEach((b) => {
    // Les projectiles sont avancés par updateProjectiles (vol en ligne droite),
    // pas par la logique sol/orbite. On les saute ici intégralement pour ne
    // pas se faire freiner par la friction ou attirer par le magnet.
    if (b.isProjectile) return;
    const ownerId = b.ownerId;
    if (ownerId) {
      const owner = owners.get(ownerId);
      if (!owner) return;
      const ring = b.ringIndex;
      const angle = angleOf(
        ring,
        b.slotIndex,
        owner.ringCounts[ring] ?? 1,
        owner.effT,
        owner.spinPhase,
        owner.spinScale,
        owner.rotMult,
      );
      const r = radiusOf(ring);
      // On stocke en local, PAS dans le schema (évite des patches inutiles).
      cache.set(b.id, owner.x + Math.cos(angle) * r, owner.y + Math.sin(angle) * r);
      return;
    }

    // Lames au sol : friction sur la velocity résiduelle du drop,
    // + attraction magnétique vers le joueur vivant le plus proche
    // qui peut encore ramasser et hors du petit lock anti-pickup après mort.
    let vx = b.vx;
    let vy = b.vy;
    if (vx !== 0 || vy !== 0) {
      const speed = Math.hypot(vx, vy);
      const newSpeed = Math.max(0, speed - decel);
      if (newSpeed <= 0.001) {
        vx = 0;
        vy = 0;
      } else {
        vx *= newSpeed / speed;
        vy *= newSpeed / speed;
      }
      b.vx = vx;
      b.vy = vy;
    }

    let x = b.x;
    let y = b.y;
    let moved = false;
    if (magnetCount > 0 && nowMs >= b.pickupLockUntil) {
      const cx = Math.floor(x / MAGNET_CELL);
      const cy = Math.floor(y / MAGNET_CELL);
      let best: MagnetSource | null = null;
      let bestD2 = Infinity;
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const cell = magnetGrid.get(cellKey(gx, gy));
          if (!cell) continue;
          for (let i = 0; i < cell.length; i++) {
            const src = cell[i];
            const dx = src.x - x;
            const dy = src.y - y;
            const d2 = dx * dx + dy * dy;
            if (d2 < src.radiusSq && d2 < bestD2) {
              bestD2 = d2;
              best = src;
            }
          }
        }
      }
      if (best) {
        const bestDist = Math.sqrt(bestD2);
        if (bestDist > 0.001) {
          // Force proportionnelle à 1-(d/R) : max au contact, 0 à la limite.
          const k = (MAGNET_STRENGTH * (1 - bestDist / best.radius) * dt) / bestDist;
          x += (best.x - x) * k;
          y += (best.y - y) * k;
          moved = true;
        }
      }
    }

    // Application de la velocity (décor-like, séparée du magnet).
    if (vx !== 0 || vy !== 0) {
      x += vx * dt;
      y += vy * dt;
      moved = true;
    }

    // Clamp au bord.
    const d2 = x * x + y * y;
    if (d2 > GROUND_MAX_R_SQ) {
      const d = Math.sqrt(d2);
      x = (x / d) * GROUND_MAX_R;
      y = (y / d) * GROUND_MAX_R;
      b.vx = 0;
      b.vy = 0;
      moved = true;
    }
    if (moved) {
      b.x = x;
      b.y = y;
    }
  });
}

// Après suppression d'une lame, recompacte les slots de l'anneau concerné du propriétaire.
export function recompactOwnerRing(state: ArenaState, ownerId: string, ringIndex: number): void {
  const owned: { b: Blade; slot: number }[] = [];
  state.blades.forEach((b) => {
    if (b.ownerId === ownerId && b.ringIndex === ringIndex) {
      owned.push({ b, slot: b.slotIndex });
    }
  });
  owned.sort((a, b) => a.slot - b.slot);
  for (let i = 0; i < owned.length; i++) owned[i].b.slotIndex = i;
}
