import type { GameModeId } from "@bladeio/shared";
import type { GameMode, ModeHost } from "./GameMode";
import { FfaMode } from "./ffa";
import { RoundsMode } from "./rounds";
import { LtsMode, TdmMode } from "./teams";
import { CtfMode } from "./ctf";

export type { GameMode, ModeHost, PlayerStanding, Point } from "./GameMode";

// Un mode du registre partagé (shared/src/modes.ts) = ses règles ici : le
// compilateur exige une entrée par identifiant.
const FACTORIES: Record<GameModeId, (host: ModeHost) => GameMode> = {
  ffa: (host) => new FfaMode(host),
  rounds: (host) => new RoundsMode(host),
  tdm: (host) => new TdmMode(host),
  lts: (host) => new LtsMode(host),
  ctf: (host) => new CtfMode(host),
};

export function createMode(id: GameModeId, host: ModeHost): GameMode {
  return FACTORIES[id](host);
}
