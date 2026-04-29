import { MAP_RADIUS, WALL_KILL_THICKNESS } from "@bladeio/shared";
import { ArenaState } from "../state/ArenaState";
import { Blade } from "../state/Blade";
import { Player } from "../state/Player";
import { OrbitPositionCache } from "./orbitPositions";

// Rayon à partir duquel on est dans la zone de mort. Égal à l'inner edge
// du mur visuel : tout ce qui est au-delà se fait casser.
const KILL_RADIUS = MAP_RADIUS - WALL_KILL_THICKNESS;
const KILL_RADIUS_SQ = KILL_RADIUS * KILL_RADIUS;

export interface WallDamageCallbacks {
  onPlayerKilled: (victim: Player) => void;
  onBladeDestroyed: (blade: Blade) => void;
}

// Scanne les joueurs vivants et les lames orbitantes. Tout ce qui dépasse
// KILL_RADIUS est détruit. Doit s'exécuter APRÈS updateBladePositions
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
  const nowMs = Date.now();
  state.players.forEach((p) => {
    if (!p.alive) return;
    if (p.spawnProtectionUntil > nowMs) return;
    if (p.x * p.x + p.y * p.y > KILL_RADIUS_SQ) {
      cb.onPlayerKilled(p);
    }
  });

  // Lames orbitantes : position monde au-delà du seuil → destruction.
  // On collecte d'abord pour ne pas muter `state.blades` pendant l'itération.
  const toDestroy: Blade[] = [];
  state.blades.forEach((b) => {
    if (!b.ownerId) return;
    const pos = orbitCache.get(b.id);
    if (!pos) return;
    if (pos.x * pos.x + pos.y * pos.y > KILL_RADIUS_SQ) {
      toDestroy.push(b);
    }
  });
  for (const b of toDestroy) cb.onBladeDestroyed(b);
}
