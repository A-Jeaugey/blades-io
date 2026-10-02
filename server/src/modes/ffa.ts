import type { Player } from "../state/Player";
import { pickSpawnPoint, randomSpawnPoint } from "../systems/spawnPoint";
import type { GameMode, ModeHost, PlayerStanding, Point } from "./GameMode";

// L'arène sans fin, le jeu d'origine : apparition à l'écart des menaces pour
// les humains, n'importe où pour les bots ; réapparition libre ; classement
// au score de la vie en cours ; jamais de fin de partie ; arène à la
// taille de sa population.
export class FfaMode implements GameMode {
  readonly id = "ffa" as const;

  constructor(private readonly host: ModeHost) {}

  onJoin(): void {}

  spawnPoint(p: Player): Point {
    return p.isBot ? randomSpawnPoint(this.host.state) : pickSpawnPoint(this.host.state);
  }

  canRespawn(): boolean {
    return true;
  }

  onKill(): void {}

  standing(p: Player): PlayerStanding {
    return { score: p.score, kills: p.kills, deaths: 0, bestBlades: p.maxBladeCount };
  }

  rankBonus(): number {
    return 0;
  }

  // Le mur suit la population (tâche 4.5).
  tick(): void {
    const state = this.host.state;
    if (state.mapRadius !== this.host.baseRadius) state.mapRadius = this.host.baseRadius;
  }

  onMatchStart(): void {}
}
