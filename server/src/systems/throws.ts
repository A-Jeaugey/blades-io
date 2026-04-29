import {
  BladeRarity,
  BladeThrownEvent,
  ProjectileImpactEvent,
  GROUND_BLADE_TTL_MS,
  MAP_RADIUS,
  PLAYER_BODY_RADIUS,
  RARITY_DAMAGE,
  RARITY_HP,
  THROW_COOLDOWN_MS,
  THROW_LANDED_PICKUP_LOCK_MS,
  THROW_PIERCE,
  THROW_PROJECTILE_HITBOX,
  THROW_PROJECTILE_MAX_RANGE,
  THROW_PROJECTILE_SPEED,
  THROW_PROJECTILE_TTL_MS,
  WALL_KILL_THICKNESS,
  CRATE_HITBOX,
  outerOrbitRadius,
} from "@bladeio/shared";
import { ArenaState } from "../state/ArenaState";
import { Blade } from "../state/Blade";
import { Crate } from "../state/Crate";
import { Player } from "../state/Player";
import { OrbitPositionCache, recompactOwnerRing } from "./orbitPositions";

export interface ThrowCallbacks {
  onBladeThrown: (ev: BladeThrownEvent) => void;
  onProjectileImpact: (ev: ProjectileImpactEvent) => void;
  onPlayerKilled: (victim: Player, killer: Player | null) => void;
  onCrateHit: (crate: Crate, attacker: Player | null) => void;
  onCrateDestroyed: (crate: Crate, attacker: Player | null) => void;
  onBladeDestroyed: (blade: Blade) => void;
}

// Sélectionne la lame "extérieure" du joueur à transformer en projectile.
// Critère : ringIndex le plus haut, puis slotIndex le plus haut. Renvoie
// null si aucun candidat.
function pickOutermostBlade(state: ArenaState, player: Player): Blade | null {
  let best: Blade | null = null;
  state.blades.forEach((b) => {
    if (b.ownerId !== player.id) return;
    if (b.isProjectile) return;
    if (!best) { best = b; return; }
    if (b.ringIndex > best.ringIndex) { best = b; return; }
    if (b.ringIndex === best.ringIndex && b.slotIndex > best.slotIndex) {
      best = b;
    }
  });
  return best;
}

// Tente d'exécuter un throw pour chaque joueur dont inputThrow est true.
// Respecte le cooldown ; consomme toujours le flag (même si refusé) pour
// éviter de relancer au tick suivant.
export function processThrows(state: ArenaState, cb: ThrowCallbacks): void {
  const now = Date.now();
  state.players.forEach((p) => {
    if (!p.inputThrow) return;
    p.inputThrow = false;
    if (!p.alive) return;
    if (p.throwCooldownUntil > now) return;
    if (p.bladeCount <= 0) return;
    const dx = p.dirX;
    const dy = p.dirY;
    const mag = Math.hypot(dx, dy);
    if (mag < 1e-3) return; // pas de direction → on n'envoie pas dans le néant
    const ndx = dx / mag;
    const ndy = dy / mag;

    const target = pickOutermostBlade(state, p);
    if (!target) return;

    // Détache la lame du joueur. Position de départ = bord extérieur du
    // joueur dans la direction du throw, pour que le projectile ne se
    // détruise pas immédiatement contre ses propres lames d'orbite.
    const startR = outerOrbitRadius(p.bladeCount) + THROW_PROJECTILE_HITBOX + 0.1;
    const startX = p.x + ndx * startR;
    const startY = p.y + ndy * startR;

    const ringIdx = target.ringIndex;
    target.ownerId = "";
    target.isProjectile = true;
    target.thrownBy = p.id;
    target.pierceLeft = THROW_PIERCE[target.rarity as BladeRarity] ?? 1;
    target.x = startX;
    target.y = startY;
    target.originX = startX;
    target.originY = startY;
    target.vx = ndx * THROW_PROJECTILE_SPEED;
    target.vy = ndy * THROW_PROJECTILE_SPEED;
    target.pickupLockUntil = now + 60_000; // verrou : pas pickupable en vol
    target.expiresAt = now + THROW_PROJECTILE_TTL_MS;
    target.hp = RARITY_HP[target.rarity as BladeRarity];
    target.hitIds.clear();

    // Mise à jour de l'inventaire owner + cooldown.
    const idx = p.bladeIds.indexOf(target.id);
    if (idx >= 0) p.bladeIds.splice(idx, 1);
    p.bladeCount = Math.max(0, p.bladeCount - 1);
    p.throwCooldownUntil = now + THROW_COOLDOWN_MS;
    recompactOwnerRing(state, p.id, ringIdx);

    cb.onBladeThrown({
      bladeId: target.id,
      thrownBy: p.id,
      rarity: target.rarity as BladeRarity,
      x: startX,
      y: startY,
      dirX: ndx,
      dirY: ndy,
    });
  });
}

// Avance les projectiles, applique portée max / TTL / collision aux bords.
// Les autres collisions (vs joueurs, lames, caisses) sont gérées par
// resolveProjectileCollisions.
//
// Comportement de fin de vie :
//  - portée max atteinte : la lame retombe au sol et redevient ramassable
//    (par tout le monde, après un court verrou anti-auto-pickup).
//  - TTL ou bord de map : destruction (cas limite, cf. zone de mort).
export function updateProjectiles(dt: number, state: ArenaState, cb: ThrowCallbacks): void {
  const now = Date.now();
  const toDestroy: Blade[] = [];
  const toLand: Blade[] = [];
  const maxRangeSq = THROW_PROJECTILE_MAX_RANGE * THROW_PROJECTILE_MAX_RANGE;
  const wallR = MAP_RADIUS - WALL_KILL_THICKNESS - 0.2;
  state.blades.forEach((b) => {
    if (!b.isProjectile) return;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    // Bord de map = zone de mort : le projectile se désintègre (kind=3).
    if (Math.hypot(b.x, b.y) > wallR) { toDestroy.push(b); return; }
    // TTL : sécurité — en pratique la portée max retombe la lame avant.
    if (b.expiresAt > 0 && now >= b.expiresAt) { toDestroy.push(b); return; }
    // Portée max atteinte : la lame se pose au sol au prochain step.
    const ddx = b.x - b.originX;
    const ddy = b.y - b.originY;
    if (ddx * ddx + ddy * ddy >= maxRangeSq) { toLand.push(b); return; }
  });
  for (const b of toDestroy) {
    cb.onProjectileImpact({
      bladeId: b.id,
      rarity: b.rarity as BladeRarity,
      x: b.x,
      y: b.y,
      kind: 3, // wall / TTL
      destroyed: true,
    });
    cb.onBladeDestroyed(b);
  }
  for (const b of toLand) {
    landProjectile(b, now, cb);
  }
}

// Transition projectile → lame au sol. Reset des champs de combat (pierce,
// hitIds, owner du throw) et pose à la position courante. Le verrou de
// pickup empêche le lanceur d'auto-récupérer la lame s'il marche dessus.
function landProjectile(b: Blade, now: number, cb: ThrowCallbacks): void {
  // Clamp à la distance exacte de portée pour éviter le léger overshoot
  // (b.x += vx*dt peut dépasser de quelques décimales selon dt).
  const dx = b.x - b.originX;
  const dy = b.y - b.originY;
  const d = Math.hypot(dx, dy);
  if (d > THROW_PROJECTILE_MAX_RANGE && d > 1e-4) {
    const k = THROW_PROJECTILE_MAX_RANGE / d;
    b.x = b.originX + dx * k;
    b.y = b.originY + dy * k;
  }
  b.isProjectile = false;
  b.thrownBy = "";
  b.pierceLeft = 0;
  b.vx = 0;
  b.vy = 0;
  b.pickupLockUntil = now + THROW_LANDED_PICKUP_LOCK_MS;
  b.expiresAt = now + GROUND_BLADE_TTL_MS;
  b.hitIds.clear();
  // Petit FX au sol pour signaler où la lame est tombée — réutilise le
  // canal projectileImpact (kind=3) avec destroyed=false pour un thud
  // discret côté client (sparks réduits, pas d'explosion).
  cb.onProjectileImpact({
    bladeId: b.id,
    rarity: b.rarity as BladeRarity,
    x: b.x,
    y: b.y,
    kind: 3,
    destroyed: false,
  });
}

// Collisions des projectiles vs joueurs (orbite + corps) et caisses.
// Appelée APRÈS resolveCollisions classique pour que la position des
// orbites soit fraîche dans le state (vx,vy projectile sont en world
// directement, pas besoin du orbitCache).
export function resolveProjectileCollisions(
  state: ArenaState,
  cb: ThrowCallbacks,
  orbitCache: OrbitPositionCache,
): void {
  // Collecte des projectiles (un seul forEach pour pas re-scanner).
  const projectiles: Blade[] = [];
  state.blades.forEach((b) => { if (b.isProjectile) projectiles.push(b); });
  if (projectiles.length === 0) return;

  for (const proj of projectiles) {
    if (proj.pierceLeft <= 0) continue;
    const px = proj.x;
    const py = proj.y;
    const ph = THROW_PROJECTILE_HITBOX;

    // 1) vs caisses
    state.crates.forEach((crate) => {
      if (proj.pierceLeft <= 0) return;
      if (crate.hp <= 0) return;
      if (proj.hitIds.has(crate.id)) return;
      const minD = ph + CRATE_HITBOX;
      const dx = px - crate.x;
      const dy = py - crate.y;
      if (dx * dx + dy * dy > minD * minD) return;
      proj.hitIds.add(crate.id);
      const dmg = RARITY_DAMAGE[proj.rarity as BladeRarity];
      crate.hp = Math.max(0, crate.hp - dmg);
      const attacker = state.players.get(proj.thrownBy) ?? null;
      proj.pierceLeft = Math.max(0, proj.pierceLeft - 1);
      const consumed = proj.pierceLeft <= 0;
      cb.onProjectileImpact({
        bladeId: proj.id,
        rarity: proj.rarity as BladeRarity,
        x: px,
        y: py,
        kind: 2, // crate
        destroyed: consumed,
      });
      if (crate.hp <= 0) cb.onCrateDestroyed(crate, attacker);
      else cb.onCrateHit(crate, attacker);
    });
    if (proj.pierceLeft <= 0) continue;

    // 2) vs joueurs (corps & orbite)
    state.players.forEach((target) => {
      if (proj.pierceLeft <= 0) return;
      if (!target.alive) return;
      if (target.id === proj.thrownBy) return;
      if (proj.hitIds.has(target.id)) return;
      // Spawn protection : intangible.
      if (target.spawnProtectionUntil > Date.now()) return;

      // Broad phase : distance centre joueur (large pour absorber le rayon
      // d'orbite).
      const reach = outerOrbitRadius(target.bladeCount) + ph + PLAYER_BODY_RADIUS;
      const cdx = px - target.x;
      const cdy = py - target.y;
      if (cdx * cdx + cdy * cdy > reach * reach) return;

      // 2a) test contre les lames orbitantes du joueur (priorité au shield).
      let hitOrbit: Blade | null = null;
      let hitOx = 0;
      let hitOy = 0;
      state.blades.forEach((ob) => {
        if (hitOrbit) return;
        if (ob.ownerId !== target.id) return;
        if (ob.isProjectile) return;
        const pos = orbitCache.get(ob.id);
        if (!pos) return;
        const dx = px - pos.x;
        const dy = py - pos.y;
        // hitbox orbite ≈ celle d'un tier 0 (compromis simple, le but
        // est juste de "bouffer" le projectile au contact des lames).
        const minD = ph + 0.5;
        if (dx * dx + dy * dy <= minD * minD) {
          hitOrbit = ob;
          hitOx = pos.x;
          hitOy = pos.y;
        }
      });

      if (hitOrbit) {
        const orbBlade = hitOrbit as Blade;
        proj.hitIds.add(target.id); // un projectile compte 1 hit/joueur max
        // Le projectile inflige son damage à la lame orbitante. Si elle
        // casse, c'est le butin classique. Le projectile, lui, perd 1 pierce.
        const dmg = RARITY_DAMAGE[proj.rarity as BladeRarity];
        orbBlade.hp = Math.max(0, orbBlade.hp - dmg);
        proj.pierceLeft = Math.max(0, proj.pierceLeft - 1);
        const consumed = proj.pierceLeft <= 0;
        cb.onProjectileImpact({
          bladeId: proj.id,
          rarity: proj.rarity as BladeRarity,
          x: hitOx,
          y: hitOy,
          kind: 0, // orbit blade
          destroyed: consumed,
        });
        if (orbBlade.hp <= 0) cb.onBladeDestroyed(orbBlade);
        return;
      }

      // 2b) sinon, test corps. Si corps touché → kill.
      const minBody = ph + PLAYER_BODY_RADIUS;
      if (cdx * cdx + cdy * cdy <= minBody * minBody) {
        proj.hitIds.add(target.id);
        const killer = state.players.get(proj.thrownBy) ?? null;
        proj.pierceLeft = Math.max(0, proj.pierceLeft - 1);
        const consumed = proj.pierceLeft <= 0;
        cb.onProjectileImpact({
          bladeId: proj.id,
          rarity: proj.rarity as BladeRarity,
          x: target.x,
          y: target.y,
          kind: 1, // body
          destroyed: consumed,
        });
        cb.onPlayerKilled(target, killer);
      }
    });
  }

  // Cleanup : projectiles avec pierceLeft <= 0 → suppression.
  for (const proj of projectiles) {
    if (proj.pierceLeft <= 0 && state.blades.has(proj.id)) {
      cb.onBladeDestroyed(proj);
    }
  }
}
