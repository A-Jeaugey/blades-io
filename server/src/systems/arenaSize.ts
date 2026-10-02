import {
  ARENA_GROW_RATE,
  ARENA_GROW_SPEED,
  ARENA_MIN_SHRINK,
  ARENA_POPULATION_WINDOW_MS,
  ARENA_SHRINK_NOTICE_MS,
  ARENA_SHRINK_SPEED,
  populationRadius,
} from "@bladeio/shared";
import { ArenaState } from "../state/ArenaState";

// Rayon de base de l'arène d'après sa population (tâche 4.5, cf.
// shared/src/arena.ts), dans les modes qui le veulent (adaptiveArena).
// Le mode en fait state.mapRadius (les manches le resserrent encore dans
// leur dernière minute). Plus de monde : le mur recule tout de suite. Moins
// de monde : resserrement annoncé (state.arenaShrinkAt, arenaTarget), puis
// lent. La population est la plus haute des 20 dernières secondes.
export class ArenaSizer {
  // Room vide à la création : la plus petite arène, qui s'agrandit à
  // mesure que les joueurs et les bots arrivent. Jamais de saut, même au
  // premier tick : un joueur entré avant lui est déjà dans ce rayon.
  private radius = populationRadius(0);
  private samples: Array<{ at: number; n: number }> = [];
  private nextSampleAt = 0;

  get current(): number {
    return this.radius;
  }

  update(state: ArenaState, now: number, dt: number): number {
    if (now >= this.nextSampleAt) {
      this.nextSampleAt = now + 1000;
      this.samples.push({ at: now, n: state.players.size });
      while (this.samples.length > 0 && this.samples[0].at < now - ARENA_POPULATION_WINDOW_MS) this.samples.shift();
    }
    let n = 0;
    for (const s of this.samples) n = Math.max(n, s.n);
    const target = populationRadius(n);
    if (target >= this.radius) {
      // Plus de monde : l'arène s'agrandit, un resserrement annoncé tombe.
      this.cancelShrink(state);
      const speed = Math.max(ARENA_GROW_SPEED, (target - this.radius) * ARENA_GROW_RATE);
      this.radius = Math.min(target, this.radius + speed * dt);
      return this.radius;
    }
    if (state.arenaShrinkAt === 0) {
      if (this.radius - target < ARENA_MIN_SHRINK) return this.radius;
      state.arenaShrinkAt = now + ARENA_SHRINK_NOTICE_MS;
      state.arenaTarget = target;
      return this.radius;
    }
    // Annoncé : la cible peut encore bouger (départs, arrivées).
    if (state.arenaTarget !== target) state.arenaTarget = target;
    if (now < state.arenaShrinkAt) return this.radius;
    this.radius = Math.max(target, this.radius - ARENA_SHRINK_SPEED * dt);
    if (this.radius <= target) this.cancelShrink(state);
    return this.radius;
  }

  private cancelShrink(state: ArenaState): void {
    if (state.arenaShrinkAt !== 0) state.arenaShrinkAt = 0;
    if (state.arenaTarget !== 0) state.arenaTarget = 0;
  }
}
