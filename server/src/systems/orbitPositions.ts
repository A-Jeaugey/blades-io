import { ArenaState } from "../state/ArenaState";
import { Blade } from "../state/Blade";
import { slotAngle, ringRadius, tierRotationMult, bladeCountRotationMult } from "@bladeio/shared";
import {
  GROUND_BLADE_FRICTION,
  MAP_RADIUS,
  MAX_BLADES_PER_PLAYER,
  PICKUP_MAGNET_RADIUS,
  PICKUP_MAGNET_STRENGTH,
  POWERUP_MAGNET_MULT,
  POWERUP_SPIN_MULT,
  WALL_KILL_THICKNESS,
} from "@bladeio/shared";

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
export function updateBladePositions(
  dt: number,
  elapsed: number,
  state: ArenaState,
  cache: OrbitPositionCache,
): void {
  // Pass 1 : nettoyer les lames orphelines (orbite dont l'owner a disparu
  // ou est mort). Pas de TTL sur les lames au sol : elles restent jusqu'à
  // ce qu'on les ramasse, sinon elles disparaîtraient devant le joueur.
  const toDelete: string[] = [];
  state.blades.forEach((b) => {
    if (b.ownerId) {
      const owner = state.players.get(b.ownerId);
      if (!owner || !owner.alive) toDelete.push(b.id);
    }
  });
  for (const id of toDelete) state.blades.delete(id);

  // Comptage des lames par (owner, ring) pour l'angle.
  const perOwnerRingCount = new Map<string, Map<number, number>>();
  state.blades.forEach((b) => {
    if (!b.ownerId) return;
    let rings = perOwnerRingCount.get(b.ownerId);
    if (!rings) {
      rings = new Map();
      perOwnerRingCount.set(b.ownerId, rings);
    }
    rings.set(b.ringIndex, (rings.get(b.ringIndex) ?? 0) + 1);
  });

  // Pendant le hitlag d'un joueur, on avance son orbitTimeOffset au même
  // rythme que `elapsed` : (elapsed - orbitTimeOffset) reste constant, donc
  // les angles ne bougent pas. Le client lit ce champ et fait pareil.
  const nowMs = Date.now();
  state.players.forEach((p) => {
    if (p.alive && p.hitlagUntil > nowMs) {
      p.orbitTimeOffset += dt;
    }
  });

  cache.clear();
  state.blades.forEach((b) => {
    // Les projectiles sont avancés par updateProjectiles (vol en ligne droite),
    // pas par la logique sol/orbite. On les saute ici intégralement pour ne
    // pas se faire freiner par la friction ou attirer par le magnet.
    if (b.isProjectile) return;
    if (b.ownerId) {
      const owner = state.players.get(b.ownerId);
      if (!owner || !owner.alive) return;
      const rings = perOwnerRingCount.get(b.ownerId)!;
      const nInRing = rings.get(b.ringIndex) ?? 1;
      // Power-up SPIN : accèlère la rotation des orbites du joueur.
      const spinBoost = owner.spinUntil > nowMs ? POWERUP_SPIN_MULT : 1;
      // Multiplicateur global de rotation = tier × blade-count × spin power-up.
      // La hitbox élargie compense la fenêtre d'esquive raccourcie.
      const rotMult = tierRotationMult(owner.tier) * bladeCountRotationMult(owner.bladeCount) * spinBoost;
      const effT = elapsed - owner.orbitTimeOffset;
      const angle = slotAngle(
        b.ringIndex,
        b.slotIndex,
        nInRing,
        effT,
        owner.spinPhase,
        owner.spinScale,
        rotMult,
      );
      const r = ringRadius(b.ringIndex);
      const x = owner.x + Math.cos(angle) * r;
      const y = owner.y + Math.sin(angle) * r;
      // On stocke en local, PAS dans le schema (évite des patches inutiles).
      cache.set(b.id, x, y);
    } else {
      // Lames au sol : friction sur la velocity résiduelle du drop,
      // + attraction magnétique vers le joueur vivant le plus proche
      // qui peut encore ramasser (<= MAX_BLADES_PER_PLAYER) et hors
      // du petit lock anti-pickup après mort.
      if (b.vx !== 0 || b.vy !== 0) {
        const speed = Math.hypot(b.vx, b.vy);
        const decel = GROUND_BLADE_FRICTION * dt;
        const newSpeed = Math.max(0, speed - decel);
        if (newSpeed <= 0.001) {
          b.vx = 0;
          b.vy = 0;
        } else {
          b.vx *= newSpeed / speed;
          b.vy *= newSpeed / speed;
        }
      }

      if (Date.now() >= b.pickupLockUntil) {
        // Rayon d'aimant effectif par joueur : boost si power-up MAGNET actif.
        let bestDist = Infinity;
        let bestRadius = PICKUP_MAGNET_RADIUS;
        let bestDx = 0;
        let bestDy = 0;
        let found = false;
        state.players.forEach((p) => {
          if (!p.alive) return;
          if (p.bladeCount >= MAX_BLADES_PER_PLAYER) return;
          const radius = p.magnetUntil > Date.now()
            ? PICKUP_MAGNET_RADIUS * POWERUP_MAGNET_MULT
            : PICKUP_MAGNET_RADIUS;
          const dx = p.x - b.x;
          const dy = p.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d < radius && d < bestDist) {
            bestDist = d;
            bestRadius = radius;
            bestDx = dx;
            bestDy = dy;
            found = true;
          }
        });
        if (found && bestDist > 0.001) {
          // Force proportionnelle à 1-(d/R) : max au contact, 0 à la limite.
          const strength =
            PICKUP_MAGNET_STRENGTH * (1 - bestDist / bestRadius);
          b.x += (bestDx / bestDist) * strength * dt;
          b.y += (bestDy / bestDist) * strength * dt;
        }
      }

      // Application de la velocity (décor-like, séparée du magnet).
      if (b.vx !== 0 || b.vy !== 0) {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
      }

      // Clamp au bord.
      const d = Math.hypot(b.x, b.y);
      const maxR = MAP_RADIUS - WALL_KILL_THICKNESS - 0.5;
      if (d > maxR) {
        b.x = (b.x / d) * maxR;
        b.y = (b.y / d) * maxR;
        b.vx = 0;
        b.vy = 0;
      }
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
