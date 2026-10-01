import type { GameModeId } from "@bladeio/shared";
import type { GameMode, ModeHost } from "./GameMode";
import { FfaMode } from "./ffa";

export type { GameMode, ModeHost, Point } from "./GameMode";

// Un mode du registre partagé (shared/src/modes.ts) = ses règles ici : le
// compilateur exige une entrée par identifiant.
const FACTORIES: Record<GameModeId, (host: ModeHost) => GameMode> = {
  ffa: (host) => new FfaMode(host),
};

export function createMode(id: GameModeId, host: ModeHost): GameMode {
  return FACTORIES[id](host);
}
