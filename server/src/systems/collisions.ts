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

function pairKey(idA: string, idB: string): string {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

// Copies locales : les exports de @bladeio/shared sont lus via des getters
// CommonJS (ré-exports), coûteux dans les boucles chaudes.
const BODY_RADIUS = PLAYER_BODY_RADIUS;
const BODY_COLLISION = PLAYER_BODY_COLLISION;
const CRATE_RADIUS = CRATE_HITBOX;
const COOLDOWN = BLADE_COLLISION_COOLDOWN;
const SHIELD_REDUC = POWERUP_SHIELD_DMG_REDUC;
const DAMAGE = RARITY_DAMAGE;

interface OrbitingEntry {
  blade: Blade;
  id: string;
  damage: number;
  x: number;
  y: number;
  // hitbox effective de la lame (= BLADE_HITBOX × tier multiplier du proprio)
  hitbox: number;
}

// Fiche d'un joueur vivant, figée pour la durée de resolveCollisions : les
// positions, protections et power-ups ne changent pas pendant la
// résolution. Les champs qui, eux, évoluent (alive, hitlag, knockback, PV
// des lames) restent lus et écrits sur le schema. Chaque lecture d'un champ
// synchronisé passe par un accesseur @colyseus/schema : on les fait une
// fois par joueur plutôt qu'une fois par paire.
interface OwnerBucket {
  player: Player;
  id: string;
  x: number;
  y: number;
  tier: number;
  // rayon d'englobement = outer orbit + max hitbox de ses lames. Sert au
  // broad-phase joueur-vs-joueur (pas besoin d'itérer les paires de lames
  // si les deux centres sont trop éloignés).
  reach: number;
  spawnProtected: boolean;
  shielded: boolean;
  blades: OrbitingEntry[];
}

// lastHitAt : cooldown par paire (lame|lame ou lame|caisse), en secondes.
// Tenu par la room : une Map de module aurait été partagée entre toutes
// les rooms du process.
export function resolveCollisions(
  state: ArenaState,
  orbitCache: OrbitPositionCache,
  cb: CollisionCallbacks,
  lastHitAt: Map<string, number>,
): void {
  const nowSec = Date.now() / 1000;
  const nowMs = Date.now();

  // -------- Phase 0 : indexation des lames orbitales par propriétaire ------
  // On groupe par owner pour pouvoir faire un early-out joueur-vs-joueur
  // (broad phase). Sans ça, on insérait toutes les lames dans un spatial
  // hash et on faisait des queries coûteuses pour chaque lame, même quand
  // les joueurs sont à 200 unités l'un de l'autre.
  const buckets = new Map<string, OwnerBucket>();
  const owners: OwnerBucket[] = [];
  state.players.forEach((p) => {
    if (!p.alive) return;
    const tier = p.tier;
    const bucket: OwnerBucket = {
      player: p,
      id: p.id,
      x: p.x,
      y: p.y,
      tier,
      reach: outerOrbitRadius(p.bladeCount) + tierBladeHitbox(tier),
      spawnProtected: p.spawnProtectionUntil > nowMs,
      shielded: p.shieldUntil > nowMs,
      blades: [],
    };
    buckets.set(bucket.id, bucket);
    owners.push(bucket);
  });

  state.blades.forEach((b) => {
    const ownerId = b.ownerId;
    if (!ownerId) return;
    const bucket = buckets.get(ownerId);
    if (!bucket) return;
    const id = b.id;
    const pos = orbitCache.get(id);
    if (!pos) return;
    bucket.blades.push({
      blade: b,
      id,
      damage: DAMAGE[b.rarity as BladeRarity],
      x: pos.x,
      y: pos.y,
      hitbox: tierBladeHitbox(bucket.tier),
    });
  });

  const destroyed = new Set<string>();

  // -------- Phase 1 : blade-vs-blade entre joueurs DIFFÉRENTS --------------
  // Broad phase O(P²) sur les centres joueurs. Pour P=60 c'est 1770 paires,
  // négligeable. Le narrow phase (O(N_a × N_b)) ne s'exécute que pour les
  // paires de joueurs effectivement en contact.
  for (let i = 0; i < owners.length; i++) {
    const A = owners[i];
    for (let j = i + 1; j < owners.length; j++) {
      const B = owners[j];
      const cdx = A.x - B.x;
      const cdy = A.y - B.y;
      const reach = A.reach + B.reach;
      if (cdx * cdx + cdy * cdy > reach * reach) continue;

      // Spawn protection : si l'un des deux joueurs vient de (re)spawn,
      // ses lames sont intangibles ET ne font pas de dégât → on skip toute
      // la narrow phase. Empêche un joueur de se faire shred avant d'avoir
      // chargé le HUD, et empêche aussi le spawn-camp offensif.
      if (A.spawnProtected || B.spawnProtected) continue;

      // Narrow phase. Les deux orbites se touchent : on teste les lames
      // entre elles. On tolère un coût O(N_a × N_b) car ce cas (deux
      // joueurs en contact direct) est précisément celui qui DOIT générer
      // un combat — pas le cas dégénéré.
      narrowPhaseClash(A, B, destroyed, nowSec, nowMs, lastHitAt, cb);
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
    const crateX = crate.x;
    const crateY = crate.y;
    const crateId = crate.id;
    for (const owner of owners) {
      // Early-out par owner : si le centre du joueur est plus loin que
      // (reach + CRATE_HITBOX), aucune de ses lames ne peut toucher.
      const cdx = owner.x - crateX;
      const cdy = owner.y - crateY;
      const cReach = owner.reach + CRATE_RADIUS;
      if (cdx * cdx + cdy * cdy > cReach * cReach) continue;

      for (const e of owner.blades) {
        if (destroyed.has(e.id)) continue;
        const minDist = CRATE_RADIUS + e.hitbox;
        const dx = e.x - crateX;
        const dy = e.y - crateY;
        if (dx * dx + dy * dy > minDist * minDist) continue;
        const key = pairKey(e.id, crateId);
        const last = lastHitAt.get(key) ?? 0;
        if (nowSec - last < COOLDOWN) continue;
        lastHitAt.set(key, nowSec);
        crate.hp = Math.max(0, crate.hp - e.damage);
        const attacker = owner.player;
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
  // Les cibles sont les joueurs vivants de la phase 0 ; `alive` est relu à
  // chaque cible car un kill de cette phase peut en retirer une.
  for (const target of owners) {
    if (!target.player.alive) continue;
    // Spawn protection : la cible ne peut pas être tuée pendant l'invuln.
    if (target.spawnProtected) continue;
    let killed = false;
    for (const owner of owners) {
      if (owner.id === target.id) continue;
      // L'attaquant est protégé → ses lames ne font pas de dégât.
      if (owner.spawnProtected) continue;
      // Broad phase : la cible peut-elle être à portée d'une lame ?
      const cdx = owner.x - target.x;
      const cdy = owner.y - target.y;
      const cReach = owner.reach + BODY_RADIUS;
      if (cdx * cdx + cdy * cdy > cReach * cReach) continue;

      for (const e of owner.blades) {
        if (destroyed.has(e.id)) continue;
        const minDist = BODY_RADIUS + e.hitbox;
        const dx = e.x - target.x;
        const dy = e.y - target.y;
        if (dx * dx + dy * dy > minDist * minDist) continue;
        cb.onPlayerKilled(target.player, owner.player);
        killed = true;
        break;
      }
      if (killed) break;
    }
  }

  // -------- Phase 4 : body-vs-body (joueurs sans lame) ---------------------
  // bladeCount est lu ici, après les destructions de lames des phases
  // précédentes ; alive est relu à chaque paire.
  const bodies: Array<{ player: Player; x: number; y: number; empty: boolean; spawnProtected: boolean }> = [];
  for (const o of owners) {
    if (o.player.alive) {
      bodies.push({ player: o.player, x: o.x, y: o.y, empty: o.player.bladeCount <= 0, spawnProtected: o.spawnProtected });
    }
  }
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];
      // Spawn protection : aucun des deux ne peut tuer ou être tué pendant
      // l'invuln (autant le défendre, autant l'empêcher d'aller body-camper).
      if (a.spawnProtected || b.spawnProtected) continue;
      if (!a.empty && !b.empty) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      if (dx * dx + dy * dy > BODY_COLLISION * BODY_COLLISION) continue;
      if (!a.player.alive || !b.player.alive) continue;
      if (a.empty && b.empty) {
        cb.onPlayerKilled(a.player, b.player);
        cb.onPlayerKilled(b.player, a.player);
      } else if (a.empty) {
        cb.onPlayerKilled(a.player, b.player);
      } else {
        cb.onPlayerKilled(b.player, a.player);
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
  lastHitAt: Map<string, number>,
  cb: CollisionCallbacks,
): void {
  const ownerA = A.player;
  const ownerB = B.player;
  const reducA = A.shielded ? SHIELD_REDUC : 1;
  const reducB = B.shielded ? SHIELD_REDUC : 1;
  // Tier effectif du clash = max des deux. Donne du jus aux duels asymétriques
  // (un Tier 2 vs Tier 0 a quand même l'air gros).
  const clashTier = A.tier > B.tier ? A.tier : B.tier;

  for (const ea of A.blades) {
    if (destroyed.has(ea.id)) continue;
    for (const eb of B.blades) {
      if (destroyed.has(eb.id)) continue;
      const minDist = ea.hitbox + eb.hitbox;
      const dx = ea.x - eb.x;
      const dy = ea.y - eb.y;
      if (dx * dx + dy * dy > minDist * minDist) continue;

      const key = pairKey(ea.id, eb.id);
      const last = lastHitAt.get(key) ?? 0;
      if (nowSec - last < COOLDOWN) continue;
      lastHitAt.set(key, nowSec);

      const a = ea.blade;
      const b = eb.blade;
      a.hp = Math.max(0, a.hp - Math.max(1, Math.floor(eb.damage * reducA)));
      b.hp = Math.max(0, b.hp - Math.max(1, Math.floor(ea.damage * reducB)));
      const aDead = a.hp <= 0;
      const bDead = b.hp <= 0;
      let killCount = 0;
      if (bDead) {
        destroyed.add(eb.id);
        cb.onBladeDestroyed(b);
        killCount++;
      }
      if (aDead) {
        destroyed.add(ea.id);
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
      const px = A.x - B.x;
      const py = A.y - B.y;
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
    A.blades = A.blades.filter((e) => !destroyed.has(e.id));
    B.blades = B.blades.filter((e) => !destroyed.has(e.id));
  }
}
