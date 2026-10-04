import {
  BladeRarity,
  BladeThrownEvent,
  ProjectileImpactEvent,
  GROUND_BLADE_TTL_MS,
  PLAYER_BODY_RADIUS,
  RARITY_DAMAGE,
  RARITY_HP,
  SERVER_DT,
  THROW_COOLDOWN_MS,
  THROW_LANDED_PICKUP_LOCK_MS,
  THROW_PIERCE,
  THROW_PROJECTILE_HITBOX,
  THROW_PROJECTILE_MAX_RANGE,
  THROW_PROJECTILE_SPEED,
  THROW_PROJECTILE_TTL_MS,
  WALL_KILL_THICKNESS,
  CRATE_HITBOX,
  bladeEdgeRadius,
  bladeTipReach,
  outerOrbitRadius,
  sameTeam,
  throwStartRadius,
} from "@bladeio/shared";
import { ArenaState } from "../state/ArenaState";
import { Blade } from "../state/Blade";
import { Crate } from "../state/Crate";
import { Player } from "../state/Player";
import { recordLoss, recordRelease } from "./bladePeak";
import { sparedByBots } from "./collisions";
import { closestOnSegment, pointSegmentDist2, segmentSegmentDist2 } from "./geometry";
import { OrbitPositionCache, recompactOwnerRing } from "./orbitPositions";

// Demi-largeur minimale d'une lame en orbite face à un projectile (petites
// lames : la valeur d'avant, quel que soit le palier).
const ORBIT_BLADE_RADIUS = 0.5;

export interface ThrowCallbacks {
  onBladeThrown: (ev: BladeThrownEvent) => void;
  onProjectileImpact: (ev: ProjectileImpactEvent) => void;
  onPlayerKilled: (victim: Player, killer: Player | null) => void;
  onCrateHit: (crate: Crate, attacker: Player | null) => void;
  onCrateDestroyed: (crate: Crate, attacker: Player | null) => void;
  // by : lanceur du projectile qui a brisé la lame, null pour la fin de vie
  // d'un projectile.
  onBladeDestroyed: (blade: Blade, by: Player | null) => void;
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
// Respecte le cooldown ; consomme toujours le flag et la visée (même si
// refusé) pour éviter de relancer au tick suivant.
export function processThrows(state: ArenaState, cb: ThrowCallbacks): void {
  const now = Date.now();
  state.players.forEach((p) => {
    if (!p.inputThrow) return;
    p.inputThrow = false;
    // La visée est consommée avec le flag, même si le lancer est refusé :
    // elle ne doit pas resservir à un lancer ultérieur envoyé sans visée.
    const aimX = p.aimX;
    const aimY = p.aimY;
    p.aimX = 0;
    p.aimY = 0;
    if (!p.alive) return;
    if (p.throwCooldownUntil > now) return;
    if (p.bladeCount <= 0) return;
    // Visée libre (souris, glisser mobile, bots) ; à défaut, direction de
    // déplacement.
    const aiming = aimX * aimX + aimY * aimY > 0.01;
    const dx = aiming ? aimX : p.dirX;
    const dy = aiming ? aimY : p.dirY;
    const mag = Math.hypot(dx, dy);
    if (mag < 1e-3) return; // pas de direction → on n'envoie pas dans le néant
    const ndx = dx / mag;
    const ndy = dy / mag;

    const target = pickOutermostBlade(state, p);
    if (!target) return;

    // Détache la lame du joueur. Position de départ = bord extérieur du
    // joueur dans la direction du throw (trajectoire affichée par le client
    // au même endroit, cf. AimIndicator).
    const startR = throwStartRadius(p.bladeCount);
    const startX = p.x + ndx * startR;
    const startY = p.y + ndy * startR;

    const ringIdx = target.ringIndex;
    target.ownerId = "";
    target.isProjectile = true;
    target.thrownBy = p.id;
    target.thrownTeam = p.team;
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
    recordRelease(p, target.id, now);

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
  // Rayon de l'arène du moment (resserré en fin de manche, tâche 7.1).
  const wallR = state.mapRadius - WALL_KILL_THICKNESS - 0.2;
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
    cb.onBladeDestroyed(b, null);
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
  b.thrownTeam = 0;
  b.pierceLeft = 0;
  b.vx = 0;
  b.vy = 0;
  b.pickupLockUntil = now + THROW_LANDED_PICKUP_LOCK_MS;
  // Une lame lancée qui retombe est un drop comme un autre : elle expire.
  b.expiresAt = now + GROUND_BLADE_TTL_MS;
  b.expiring = false;
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
//
// Le contact se teste sur tout le trajet du tick (de la position précédente
// à la position courante), pas seulement à son bout : en frôlant un corps,
// le projectile pouvait passer entre deux positions sans toucher. Une lame
// en orbite se teste telle qu'elle est dessinée (du point d'anneau à la
// pointe, cf. BLADE_TIP_REACH). Un contact par cible et par tick, le
// premier sur le trajet : une lame en orbite qui tient arrête le
// projectile ; brisée, il poursuit s'il lui reste du perçant, jusqu'aux
// lames suivantes ou au corps. Avant, le premier contact avec l'orbite
// rendait toute la cible intangible : une lame Epic ou Legendary traversait
// le corps sans effet.
export function resolveProjectileCollisions(
  state: ArenaState,
  cb: ThrowCallbacks,
  orbitCache: OrbitPositionCache,
  dt: number = SERVER_DT,
): void {
  // Collecte des projectiles (un seul forEach pour pas re-scanner).
  const projectiles: Blade[] = [];
  state.blades.forEach((b) => { if (b.isProjectile) projectiles.push(b); });
  if (projectiles.length === 0) return;
  const now = Date.now();
  const ph = THROW_PROJECTILE_HITBOX;

  for (const proj of projectiles) {
    if (proj.pierceLeft <= 0) continue;
    // Trajet du tick, à vitesse constante, sans remonter avant le point de
    // départ (lancer de ce tick).
    const x1 = proj.x;
    const y1 = proj.y;
    let x0 = x1 - proj.vx * dt;
    let y0 = y1 - proj.vy * dt;
    const fromOriginX = x1 - proj.originX;
    const fromOriginY = y1 - proj.originY;
    if (fromOriginX * fromOriginX + fromOriginY * fromOriginY < (x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0)) {
      x0 = proj.originX;
      y0 = proj.originY;
    }
    const attacker = state.players.get(proj.thrownBy) ?? null;

    // 1) vs caisses
    state.crates.forEach((crate) => {
      if (proj.pierceLeft <= 0) return;
      if (crate.hp <= 0) return;
      if (proj.hitIds.has(crate.id)) return;
      const minD = ph + CRATE_HITBOX;
      if (pointSegmentDist2(crate.x, crate.y, x0, y0, x1, y1) > minD * minD) return;
      proj.hitIds.add(crate.id);
      const dmg = RARITY_DAMAGE[proj.rarity as BladeRarity];
      crate.hp = Math.max(0, crate.hp - dmg);
      proj.pierceLeft = Math.max(0, proj.pierceLeft - 1);
      const consumed = proj.pierceLeft <= 0;
      const t = closestOnSegment(crate.x, crate.y, x0, y0, x1, y1);
      cb.onProjectileImpact({
        bladeId: proj.id,
        rarity: proj.rarity as BladeRarity,
        x: x0 + (x1 - x0) * t,
        y: y0 + (y1 - y0) * t,
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
      // Alliés du lanceur (modes équipe) : traversés, lames comme corps.
      if (sameTeam(proj.thrownTeam, target.team)) return;
      if (proj.hitIds.has(target.id)) return;
      // Spawn protection : intangible.
      if (target.spawnProtectionUntil > now) return;
      // Débutant en grâce : intangible aux lancers des bots.
      if (sparedByBots(target, now) && attacker?.isBot) return;

      // Broad phase : le trajet passe-t-il à portée de ses lames (les plus
      // longues possibles à son palier) ou de son corps ?
      const tier = target.tier;
      const orbitReach = target.bladeCount > 0
        ? outerOrbitRadius(target.bladeCount) + bladeTipReach(tier, BladeRarity.Legendary)
          + Math.max(ORBIT_BLADE_RADIUS, bladeEdgeRadius(tier, BladeRarity.Legendary))
        : 0;
      const reach = Math.max(orbitReach, PLAYER_BODY_RADIUS) + ph;
      if (pointSegmentDist2(target.x, target.y, x0, y0, x1, y1) > reach * reach) return;

      // 2a) Première lame en orbite touchée sur le trajet.
      let hitOrbit: Blade | null = null;
      let orbitT = 2;
      let hitOx = 0;
      let hitOy = 0;
      for (const id of target.bladeIds) {
        if (proj.hitIds.has(id)) continue;
        const ob = state.blades.get(id);
        if (!ob || ob.isProjectile || ob.ownerId !== target.id) continue;
        const pos = orbitCache.get(id);
        if (!pos) continue;
        const rarity = ob.rarity as BladeRarity;
        const ox = pos.x - target.x;
        const oy = pos.y - target.y;
        const r = Math.sqrt(ox * ox + oy * oy);
        const tip = r > 1e-6 ? bladeTipReach(tier, rarity) / r : 0;
        const tipX = pos.x + ox * tip;
        const tipY = pos.y + oy * tip;
        const minD = ph + Math.max(ORBIT_BLADE_RADIUS, bladeEdgeRadius(tier, rarity));
        if (segmentSegmentDist2(x0, y0, x1, y1, pos.x, pos.y, tipX, tipY) > minD * minD) continue;
        // Ordre sur le trajet : point le plus proche du milieu de la lame.
        const t = closestOnSegment((pos.x + tipX) * 0.5, (pos.y + tipY) * 0.5, x0, y0, x1, y1);
        if (t < orbitT) {
          orbitT = t;
          hitOrbit = ob;
          hitOx = pos.x;
          hitOy = pos.y;
        }
      }

      // 2b) Corps.
      const minBody = ph + PLAYER_BODY_RADIUS;
      const bodyHit = pointSegmentDist2(target.x, target.y, x0, y0, x1, y1) <= minBody * minBody;
      const bodyT = bodyHit ? closestOnSegment(target.x, target.y, x0, y0, x1, y1) : 2;

      if (hitOrbit && orbitT <= bodyT) {
        const orbBlade = hitOrbit as Blade;
        proj.hitIds.add(orbBlade.id);
        // Le projectile inflige son damage à la lame orbitante. Si elle
        // casse, c'est le butin classique et il perd un perçant ; si elle
        // tient, elle l'arrête.
        const dmg = RARITY_DAMAGE[proj.rarity as BladeRarity];
        orbBlade.hp = Math.max(0, orbBlade.hp - dmg);
        const broken = orbBlade.hp <= 0;
        proj.pierceLeft = broken ? Math.max(0, proj.pierceLeft - 1) : 0;
        // Lame lancée consommée sur la cible : perdue contre elle (son
        // lanceur la récupère s'il la tue).
        if (proj.pierceLeft <= 0 && attacker) recordLoss(attacker, proj.rarity, target.id, now, true);
        cb.onProjectileImpact({
          bladeId: proj.id,
          rarity: proj.rarity as BladeRarity,
          x: hitOx,
          y: hitOy,
          kind: 0, // orbit blade
          destroyed: proj.pierceLeft <= 0,
        });
        if (broken) cb.onBladeDestroyed(orbBlade, attacker);
        return;
      }

      // Corps touché → kill.
      if (bodyHit) {
        proj.hitIds.add(target.id);
        proj.pierceLeft = Math.max(0, proj.pierceLeft - 1);
        const consumed = proj.pierceLeft <= 0;
        // Avant le kill : la lame qui l'a tué revient aussi au lanceur.
        if (consumed && attacker) recordLoss(attacker, proj.rarity, target.id, now, true);
        cb.onProjectileImpact({
          bladeId: proj.id,
          rarity: proj.rarity as BladeRarity,
          x: target.x,
          y: target.y,
          kind: 1, // body
          destroyed: consumed,
        });
        cb.onPlayerKilled(target, attacker);
      }
    });
  }

  // Cleanup : projectiles avec pierceLeft <= 0 → suppression.
  for (const proj of projectiles) {
    if (proj.pierceLeft <= 0 && state.blades.has(proj.id)) {
      cb.onBladeDestroyed(proj, null);
    }
  }
}
