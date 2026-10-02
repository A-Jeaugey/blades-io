import { WALL_KILL_THICKNESS } from "@bladeio/shared";
import { ArenaState } from "../state/ArenaState";
import { Blade } from "../state/Blade";
import { Player } from "../state/Player";
import { OrbitPositionCache } from "./orbitPositions";


export interface WallDamageCallbacks {
  onPlayerKilled: (victim: Player) => void;
  onBladeDestroyed: (blade: Blade) => void;
}

// Scanne les joueurs vivants et les lames orbitantes. Tout ce qui dépasse
// le rayon de mort est détruit : le bord intérieur du mur visuel, qui suit
// le rayon de l'arène (state.mapRadius, resserré en fin de manche, 7.1). Doit s'exécuter APRÈS updateBladePositions
// (l'orbitCache doit être à jour). Mort/destruction délégué aux callbacks
// pour réutiliser les mêmes broadcasts/cleanup que les autres systèmes.
export function applyWallDamage(
  state: ArenaState,
  orbitCache: OrbitPositionCache,
  cb: WallDamageCallbacks,
): void {
  // Joueurs : body au-delà du seuil → mort instantanée (killer = null).
  // Spawn protection : on garde l'invuln cohérente même contre les murs
  // (cas pathologique : spawn + déconnexion temporaire → on ne veut pas
  // tuer un joueur qui ne contrôle pas encore son perso).
  const killR = state.mapRadius - WALL_KILL_THICKNESS;
  const KILL_RADIUS_SQ = killR * killR;
  const nowMs = Date.now();
  state.players.forEach((p) => {
    if (!p.alive) return;
    if (p.spawnProtectionUntil > nowMs) return;
    if (p.x * p.x + p.y * p.y > KILL_RADIUS_SQ) {
      cb.onPlayerKilled(p);
    }
  });

  // Lames orbitantes : position monde au-delà du seuil → destruction.
  // Lames au sol aussi, retirées sans évènement : l'arène qui se resserre
  // (fin de manche) en laisse des centaines dehors, où elles
  // n'attireraient que des joueurs et des bots vers la mort. Dans l'arène
  // pleine, aucune n'y est (bornées au sol à 0,5 u du seuil). On collecte
  // d'abord pour ne pas muter `state.blades` pendant l'itération.
  const toDestroy: Blade[] = [];
  const lostOnGround: string[] = [];
  state.blades.forEach((b) => {
    if (!b.ownerId) {
      if (!b.isProjectile && b.x * b.x + b.y * b.y > KILL_RADIUS_SQ) lostOnGround.push(b.id);
      return;
    }
    const pos = orbitCache.get(b.id);
    if (!pos) return;
    if (pos.x * pos.x + pos.y * pos.y > KILL_RADIUS_SQ) {
      toDestroy.push(b);
    }
  });
  for (const b of toDestroy) cb.onBladeDestroyed(b);
  for (const id of lostOnGround) state.blades.delete(id);

  // Caisses et power-ups restés dehors quand le mur avance (fin de manche,
  // arène qui suit la population, tâche 4.5) : retirés de même.
  const lostCrates: string[] = [];
  state.crates.forEach((c) => {
    if (c.x * c.x + c.y * c.y > KILL_RADIUS_SQ) lostCrates.push(c.id);
  });
  for (const id of lostCrates) state.crates.delete(id);
  const lostPowerUps: string[] = [];
  state.powerups.forEach((pu) => {
    if (pu.x * pu.x + pu.y * pu.y > KILL_RADIUS_SQ) lostPowerUps.push(pu.id);
  });
  for (const id of lostPowerUps) state.powerups.delete(id);
}
