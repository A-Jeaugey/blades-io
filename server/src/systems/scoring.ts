import {
  SCORE_KILL,
  SCORE_BLADE,
  SCORE_SURVIVAL_PTS,
  SCORE_SURVIVAL_INTERVAL,
  SCORE_CRATE,
  SCORE_POWERUP,
} from "@bladeio/shared";
import { Player } from "../state/Player";

/**
 * Recalcule le score composite d'un joueur. Appelé à chaque événement
 * pertinent (kill, crate, powerup) ET une fois par tick pour la composante
 * survival. Le score est directement écrit dans player.score (uint32
 * synchronisé par Colyseus).
 *
 * Formule : kills×15 + bladeCount×1 + floor(survivalSec / 10)×1
 *           + cratesDestroyed×3 + powerupsCollected×2
 *
 * bladeCount = lames ACTUELLES (pas max) → le score monte ET baisse
 * en temps réel pendant les combats.
 */
export function updateScore(player: Player): void {
  if (!player.alive) return;
  const survivalSec = Math.max(0, (Date.now() - player.spawnedAt) / 1000);
  const raw =
    player.kills * SCORE_KILL +
    player.bladeCount * SCORE_BLADE +
    Math.floor(survivalSec / SCORE_SURVIVAL_INTERVAL) * SCORE_SURVIVAL_PTS +
    player.cratesDestroyed * SCORE_CRATE +
    player.powerupsCollected * SCORE_POWERUP;
  player.score = Math.floor(raw) >>> 0; // uint32
}
