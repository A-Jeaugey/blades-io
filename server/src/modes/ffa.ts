import type { Player } from "../state/Player";
import { pickSpawnPoint, randomSpawnPoint } from "../systems/spawnPoint";
import type { GameMode, ModeHost, Point } from "./GameMode";

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

  standingScore(p: Player): number {
    return p.score;
  }

  tick(): void {}

  onMatchStart(): void {}
}
