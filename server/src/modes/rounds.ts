import {
  MAP_RADIUS,
  ROUND_DURATION_MS,
  ROUND_INTERMISSION_MS,
  ROUND_PODIUM_BONUS,
  roundArenaRadius,
} from "@bladeio/shared";
import type { Player } from "../state/Player";
import { pickSpawnPoint, randomSpawnPoint } from "../systems/spawnPoint";
import type { GameMode, ModeHost, PlayerStanding, Point } from "./GameMode";

// Ce qu'une manche garde d'un joueur au-delà de sa vie en cours.
interface RoundRecord {
  points: number;
  kills: number;
  deaths: number;
  bestBlades: number;
}

// Manches chronométrées (tâche 7.1) : cinq minutes, l'arène se resserre
// pendant la dernière, puis podium et manche suivante (cycle de fin de
// partie de la room, ModeHost.endMatch). On réapparaît pendant toute la
// manche ; le classement additionne le score de chaque vie de la manche,
// gardé à la mort, et celui de la vie en cours : mourir coûte l'élan, pas
// les points déjà faits.
export class RoundsMode implements GameMode {
  readonly id = "rounds" as const;
  private records = new Map<string, RoundRecord>();

  constructor(private readonly host: ModeHost) {}

  private recordOf(id: string): RoundRecord {
    let r = this.records.get(id);
    if (!r) {
      r = { points: 0, kills: 0, deaths: 0, bestBlades: 0 };
      this.records.set(id, r);
    }
    return r;
  }

  onJoin(p: Player): void {
    this.records.delete(p.id);
  }

  // Dans l'arène du moment, resserrée comprise (cf. systems/spawnPoint).
  spawnPoint(p: Player): Point {
    return p.isBot ? randomSpawnPoint(this.host.state) : pickSpawnPoint(this.host.state);
  }

  canRespawn(): boolean {
    return true;
  }

  onKill(victim: Player, killer: Player | null): void {
    const v = this.recordOf(victim.id);
    v.points += Math.max(0, Math.floor(victim.score));
    v.deaths++;
    v.bestBlades = Math.max(v.bestBlades, victim.maxBladeCount);
    if (killer) this.recordOf(killer.id).kills++;
  }

  standing(p: Player): PlayerStanding {
    const r = this.records.get(p.id);
    return {
      score: (r?.points ?? 0) + (p.alive ? Math.max(0, Math.floor(p.score)) : 0),
      kills: r?.kills ?? 0,
      deaths: r?.deaths ?? 0,
      bestBlades: Math.max(r?.bestBlades ?? 0, p.alive ? p.maxBladeCount : 0),
    };
  }

  rankBonus(rank: number): number {
    return ROUND_PODIUM_BONUS[rank] ?? 0;
  }

  // Le rayon suit la minuterie (synchronisé : le client dessine le mur
  // là où il tue) ; la manche finit à l'échéance.
  tick(now: number): void {
    const state = this.host.state;
    const radius = roundArenaRadius(MAP_RADIUS, now, state.phaseEndsAt);
    if (state.mapRadius !== radius) state.mapRadius = radius;
    if (now >= state.phaseEndsAt) this.host.endMatch(ROUND_INTERMISSION_MS);
  }

  onMatchStart(now: number): void {
    this.records.clear();
    const state = this.host.state;
    state.phaseEndsAt = now + ROUND_DURATION_MS;
    state.mapRadius = MAP_RADIUS;
  }
}
