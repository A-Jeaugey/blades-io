import type { Player } from "../state/Player";
import { pickSpawnPoint, randomSpawnPoint } from "../systems/spawnPoint";
import type { GameMode, ModeHost, PlayerStanding, Point } from "./GameMode";

// L'arène sans fin, le jeu d'origine : apparition à l'écart des menaces pour
// les humains, n'importe où pour les bots ; réapparition libre ; classement
// au score de la vie en cours ; jamais de fin de partie.
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

  tick(): void {}

  onMatchStart(): void {}
}
