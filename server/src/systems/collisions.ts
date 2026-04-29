import {
  BLADE_COLLISION_COOLDOWN,
  BladeRarity,
  CRATE_HITBOX,
  PLAYER_BODY_COLLISION,
  PLAYER_BODY_RADIUS,
  POWERUP_SHIELD_DMG_REDUC,
  RARITY_DAMAGE,
  outerOrbitRadius,
  tierBladeHitbox,
  tierHitlagMs,
  tierKnockback,
} from "@bladeio/shared";
import { ArenaState } from "../state/ArenaState";
import { Blade } from "../state/Blade";
import { Crate } from "../state/Crate";
import { Player } from "../state/Player";
import { OrbitPositionCache } from "./orbitPositions";

export interface ClashInfo {
  a: Blade;
  b: Blade;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  // Tier "effectif" du clash (max des deux), pour FX côté client.
  tier: number;
  destroyed: number;
}

export interface CollisionCallbacks {
  onBladeDestroyed: (blade: Blade) => void;
  onPlayerKilled: (victim: Player, killer: Player | null) => void;
  onCrateHit: (crate: Crate, attacker: Player | null) => void;
  onCrateDestroyed: (crate: Crate, attacker: Player | null) => void;
  onClash: (info: ClashInfo) => void;
}

const lastHitAt = new Map<string, number>();
function pairKey(idA: string, idB: string): string {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

interface OrbitingEntry {
  blade: Blade;
  x: number;
  y: number;
  // hitbox effective de la lame (= BLADE_HITBOX × tier multiplier du proprio)
  hitbox: number;
}

interface OwnerBucket {
  player: Player;
  tier: number;
  // rayon d'englobement = outer orbit + max hitbox de ses lames. Sert au
  // broad-phase joueur-vs-joueur (pas besoin d'itérer les paires de lames
  // si les deux centres sont trop éloignés).
  reach: number;
  blades: OrbitingEntry[];
}

export function resolveCollisions(
  state: ArenaState,
  orbitCache: OrbitPositionCache,
  cb: CollisionCallbacks,
): void {
  // -------- Phase 0 : indexation des lames orbitales par propriétaire ------
  // On groupe par owner pour pouvoir faire un early-out joueur-vs-joueur
  // (broad phase). Sans ça, on insérait toutes les lames dans un spatial
  // hash et on faisait des queries coûteuses pour chaque lame, même quand
  // les joueurs sont à 200 unités l'un de l'autre.
  const buckets = new Map<string, OwnerBucket>();
  state.players.forEach((p) => {
    if (!p.alive) return;
    const tier = p.tier;
    const hitbox = tierBladeHitbox(tier);
    const orbit = outerOrbitRadius(p.bladeCount);
    buckets.set(p.id, {
      player: p,
      tier,
      reach: orbit + hitbox,
      blades: [],
    });
  });

  state.blades.forEach((b) => {
    if (!b.ownerId) return;
    const bucket = buckets.get(b.ownerId);
    if (!bucket) return;
    const pos = orbitCache.get(b.id);
    if (!pos) return;
    bucket.blades.push({
      blade: b,
      x: pos.x,
      y: pos.y,
      hitbox: tierBladeHitbox(bucket.tier),
    });
  });

  const owners = Array.from(buckets.values());
  const destroyed = new Set<string>();
  const nowSec = Date.now() / 1000;
  const nowMs = Date.now();

  // -------- Phase 1 : blade-vs-blade entre joueurs DIFFÉRENTS --------------
  // Broad phase O(P²) sur les centres joueurs. Pour P=60 c'est 1770 paires,
  // négligeable. Le narrow phase (O(N_a × N_b)) ne s'exécute que pour les
  // paires de joueurs effectivement en contact.
  for (let i = 0; i < owners.length; i++) {
    const A = owners[i];
    for (let j = i + 1; j < owners.length; j++) {
      const B = owners[j];
      const cdx = A.player.x - B.player.x;
      const cdy = A.player.y - B.player.y;
      const reach = A.reach + B.reach;
      if (cdx * cdx + cdy * cdy > reach * reach) continue;

      // Spawn protection : si l'un des deux joueurs vient de (re)spawn,
      // ses lames sont intangibles ET ne font pas de dégât → on skip toute
      // la narrow phase. Empêche un joueur de se faire shred avant d'avoir
      // chargé le HUD, et empêche aussi le spawn-camp offensif.
      if (A.player.spawnProtectionUntil > nowMs || B.player.spawnProtectionUntil > nowMs) continue;

      // Narrow phase. Les deux orbites se touchent : on teste les lames
      // entre elles. On tolère un coût O(N_a × N_b) car ce cas (deux
      // joueurs en contact direct) est précisément celui qui DOIT générer
      // un combat — pas le cas dégénéré.
      narrowPhaseClash(A, B, destroyed, nowSec, nowMs, cb);
    }
  }

  // GC du dictionnaire de cooldowns (sinon il grossit indéfiniment).
  if (lastHitAt.size > 256) {
    const cutoff = nowSec - 1.0;
    for (const [k, t] of lastHitAt) {
      if (t < cutoff) lastHitAt.delete(k);
    }
  }

  // -------- Phase 2 : blade-vs-crate ---------------------------------------
  // Pas de broad-phase joueur ici car les caisses ne sont pas indexées par
  // owner. Mais le coût reste O(crates × blades_orbitales) avec un test
  // distance² très bon marché.
  state.crates.forEach((crate) => {
    if (crate.hp <= 0) return;
    for (const owner of owners) {
      // Early-out par owner : si le centre du joueur est plus loin que
      // (reach + CRATE_HITBOX), aucune de ses lames ne peut toucher.
      const cdx = owner.player.x - crate.x;
      const cdy = owner.player.y - crate.y;
      const cReach = owner.reach + CRATE_HITBOX;
      if (cdx * cdx + cdy * cdy > cReach * cReach) continue;

      for (const e of owner.blades) {
        if (destroyed.has(e.blade.id)) continue;
        const minDist = CRATE_HITBOX + e.hitbox;
        const dx = e.x - crate.x;
        const dy = e.y - crate.y;
        if (dx * dx + dy * dy > minDist * minDist) continue;
        const key = pairKey(e.blade.id, crate.id);
        const last = lastHitAt.get(key) ?? 0;
        if (nowSec - last < BLADE_COLLISION_COOLDOWN) continue;
        lastHitAt.set(key, nowSec);
        const dmg = RARITY_DAMAGE[e.blade.rarity as BladeRarity];
        crate.hp = Math.max(0, crate.hp - dmg);
        const attacker = state.players.get(e.blade.ownerId) ?? null;
        if (crate.hp <= 0) {
          cb.onCrateDestroyed(crate, attacker);
          return;
        }
        cb.onCrateHit(crate, attacker);
      }
    }
  });

  // -------- Phase 3 : blade-vs-body (instant kill) -------------------------
  // Hitbox élargie : avec un joueur tier 2 (hitbox x3), un autre joueur
  // qui rentre dans son cylindre meurt à 2 unités du centre, pas à 1.3.
  // Ça résout le "syndrome de la passoire" sur les attaques au corps.
  state.players.forEach((target) => {
    if (!target.alive) return;
    // Spawn protection : la cible ne peut pas être tuée pendant l'invuln.
    if (target.spawnProtectionUntil > nowMs) return;
    for (const owner of owners) {
      if (owner.player.id === target.id) continue;
      // L'attaquant est protégé → ses lames ne font pas de dégât.
      if (owner.player.spawnProtectionUntil > nowMs) continue;
      // Broad phase : la cible peut-elle être à portée d'une lame ?
      const cdx = owner.player.x - target.x;
      const cdy = owner.player.y - target.y;
      const cReach = owner.reach + PLAYER_BODY_RADIUS;
      if (cdx * cdx + cdy * cdy > cReach * cReach) continue;

      for (const e of owner.blades) {
        if (destroyed.has(e.blade.id)) continue;
        const minDist = PLAYER_BODY_RADIUS + e.hitbox;
        const dx = e.x - target.x;
        const dy = e.y - target.y;
        if (dx * dx + dy * dy > minDist * minDist) continue;
        const killer = state.players.get(e.blade.ownerId) ?? null;
        cb.onPlayerKilled(target, killer);
        return;
      }
    }
  });

  // -------- Phase 4 : body-vs-body (joueurs sans lame) ---------------------
  const players: Player[] = [];
  state.players.forEach((p) => { if (p.alive) players.push(p); });
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i];
      const b = players[j];
      if (!a.alive || !b.alive) continue;
      // Spawn protection : aucun des deux ne peut tuer ou être tué pendant
      // l'invuln (autant le défendre, autant l'empêcher d'aller body-camper).
      if (a.spawnProtectionUntil > nowMs || b.spawnProtectionUntil > nowMs) continue;
      const aEmpty = a.bladeCount <= 0;
      const bEmpty = b.bladeCount <= 0;
      if (!aEmpty && !bEmpty) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      if (dx * dx + dy * dy > PLAYER_BODY_COLLISION * PLAYER_BODY_COLLISION) continue;
      if (aEmpty && bEmpty) {
        cb.onPlayerKilled(a, b);
        cb.onPlayerKilled(b, a);
      } else if (aEmpty) {
        cb.onPlayerKilled(a, b);
      } else {
        cb.onPlayerKilled(b, a);
      }
    }
  }
}

// Itère toutes les paires de lames entre deux propriétaires en contact.
// Sépare le narrow phase pour garder la fonction principale lisible.
function narrowPhaseClash(
  A: OwnerBucket,
  B: OwnerBucket,
  destroyed: Set<string>,
  nowSec: number,
  nowMs: number,
  cb: CollisionCallbacks,
): void {
  const ownerA = A.player;
  const ownerB = B.player;
  const reducA = ownerA.shieldUntil > nowMs ? POWERUP_SHIELD_DMG_REDUC : 1;
  const reducB = ownerB.shieldUntil > nowMs ? POWERUP_SHIELD_DMG_REDUC : 1;
  // Tier effectif du clash = max des deux. Donne du jus aux duels asymétriques
  // (un Tier 2 vs Tier 0 a quand même l'air gros).
  const clashTier = A.tier > B.tier ? A.tier : B.tier;

  for (const ea of A.blades) {
    if (destroyed.has(ea.blade.id)) continue;
    for (const eb of B.blades) {
      if (destroyed.has(eb.blade.id)) continue;
      const minDist = ea.hitbox + eb.hitbox;
      const dx = ea.x - eb.x;
      const dy = ea.y - eb.y;
      if (dx * dx + dy * dy > minDist * minDist) continue;

      const key = pairKey(ea.blade.id, eb.blade.id);
      const last = lastHitAt.get(key) ?? 0;
      if (nowSec - last < BLADE_COLLISION_COOLDOWN) continue;
      lastHitAt.set(key, nowSec);

      const a = ea.blade;
      const b = eb.blade;
      const dmgA = RARITY_DAMAGE[a.rarity as BladeRarity];
      const dmgB = RARITY_DAMAGE[b.rarity as BladeRarity];
      a.hp = Math.max(0, a.hp - Math.max(1, Math.floor(dmgB * reducA)));
      b.hp = Math.max(0, b.hp - Math.max(1, Math.floor(dmgA * reducB)));
      const aDead = a.hp <= 0;
      const bDead = b.hp <= 0;
      let killCount = 0;
      if (bDead) {
        destroyed.add(b.id);
        cb.onBladeDestroyed(b);
        killCount++;
      }
      if (aDead) {
        destroyed.add(a.id);
        cb.onBladeDestroyed(a);
        killCount++;
      }

      // Clash : déclenche hitlag + knockback + event broadcast pour le FX.
      // Hitlag : durée tier-aware. Plus le tier est gros, plus l'impact est
      // "lourd" (jusqu'à 110 ms pour Tier 2). Évite que le hitlag ne soit
      // re-bumpé en boucle si plusieurs lames clashent dans le même tick.
      const hitlagMs = tierHitlagMs(clashTier);
      const lagEnd = nowMs + hitlagMs;
      if (ownerA.hitlagUntil < lagEnd) ownerA.hitlagUntil = lagEnd;
      if (ownerB.hitlagUntil < lagEnd) ownerB.hitlagUntil = lagEnd;

      // Knockback : direction = vecteur reliant les deux centres joueurs
      // (et non les deux lames : on veut repousser les bonshommes, pas
      // un point arbitraire de leur orbite). Force tier-aware.
      const px = ownerA.x - ownerB.x;
      const py = ownerA.y - ownerB.y;
      const pd = Math.hypot(px, py);
      if (pd > 1e-3) {
        const nx = px / pd;
        const ny = py / pd;
        const fA = tierKnockback(B.tier);
        const fB = tierKnockback(A.tier);
        // L'addition (et non l'écrasement) permet aux clashs successifs de
        // s'empiler proprement avant la décroissance exponentielle.
        ownerA.knockbackVx += nx * fA;
        ownerA.knockbackVy += ny * fA;
        ownerB.knockbackVx -= nx * fB;
        ownerB.knockbackVy -= ny * fB;
      }

      // Notif : milieu des deux lames pour positionner la VFX au point
      // d'impact (visuellement plus juste qu'au centre d'un des deux).
      cb.onClash({
        a, b,
        ax: ea.x, ay: ea.y,
        bx: eb.x, by: eb.y,
        tier: clashTier,
        destroyed: killCount,
      });

      if (aDead) break; // a est détruite : passer à la prochaine de A
    }
  }

  // Suppression des références aux lames détruites pour ne pas les retester
  // dans la phase blade-vs-body (elles ne sont plus dans le state mais elles
  // sont encore dans les buckets).
  if (destroyed.size > 0) {
    A.blades = A.blades.filter((e) => !destroyed.has(e.blade.id));
    B.blades = B.blades.filter((e) => !destroyed.has(e.blade.id));
  }
}
