import { PLAYER_BODY_RADIUS, mapBlocked, resolveMapCollision, type GameModeId } from "@bladeio/shared";
import { FfaMode } from "./ffa";

// Toutes les combien de ticks le butin tombé dans un mur en est sorti.
const SWEEP_TICKS = 15;

// Quartier (essai, 2026-11-19) : les règles de l'arène sans fin sur une
// carte à murs (shared/src/maps.ts). La carte est fermée par ses immeubles
// d'enceinte : le mur tueur reste à son rayon, hors d'atteinte.
export class DistrictMode extends FfaMode {
  override readonly id: GameModeId = "district";
  private sweepIn = 0;

  override tick(): void {
    const state = this.host.state;
    const map = state.map;
    if (!map) return;
    if (state.mapRadius !== map.radius) state.mapRadius = map.radius;
    // Une lame peut retomber dans un immeuble (butin d'une élimination
    // éparpillé, lame de boost, lancer parti d'un joueur collé au mur) :
    // elle y serait perdue. Plutôt que de corriger chaque façon de poser
    // une lame, on ressort ici, quatre fois par seconde, celles qui y sont.
    if (--this.sweepIn > 0) return;
    this.sweepIn = SWEEP_TICKS;
    state.blades.forEach((b) => {
      if (b.ownerId || b.isProjectile) return;
      if (!mapBlocked(map, b.x, b.y, 0.2)) return;
      const lim = map.half - PLAYER_BODY_RADIUS;
      const x = Math.max(-lim, Math.min(lim, b.x));
      const y = Math.max(-lim, Math.min(lim, b.y));
      const p = resolveMapCollision(map, x, y, PLAYER_BODY_RADIUS);
      b.x = p.x;
      b.y = p.y;
    });
  }
}
