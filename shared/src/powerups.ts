import { BladeRarity, POWERUP_DURATION, PowerUpType } from "./constants";

// Améliorations des power-ups (QUÊTES › AMÉLIORATIONS, retour de jeu du
// 2026-10-12) : chaque niveau, payé en trophées, allonge les effets à durée
// d'un pourcentage fixe. Plafonné à +50 % au niveau 20 : un joueur
// aguerri garde un avantage mesuré sur un nouveau venu, jamais un effet qui
// décide seul d'un combat (cf. tâche 4.3). Les trophées ne s'achètent pas :
// ils se gagnent en jouant.
export const POWERUP_UPGRADE_MAX_LEVEL = 20;
export const POWERUP_UPGRADE_STEP = 0.025;

// Power-ups à durée, donc améliorables (Blades est instantané).
export const UPGRADABLE_POWERUPS: readonly PowerUpType[] = [
  PowerUpType.Speed,
  PowerUpType.Spin,
  PowerUpType.Magnet,
  PowerUpType.Shield,
];

export function clampUpgradeLevel(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(POWERUP_UPGRADE_MAX_LEVEL, Math.floor(level)));
}

// Durée de base d'un effet, avant amélioration (s).
export function basePowerUpDuration(_type: PowerUpType, rarity: BladeRarity): number {
  return POWERUP_DURATION[rarity];
}

// Durée d'un effet (ms) pour un joueur au niveau d'amélioration `level` de
// ce power-up. Serveur (application de l'effet) et client (page des
// améliorations, explications) lisent la même.
export function powerUpDurationMs(type: PowerUpType, rarity: BladeRarity, level = 0): number {
  const mult = 1 + clampUpgradeLevel(level) * POWERUP_UPGRADE_STEP;
  return Math.round(basePowerUpDuration(type, rarity) * 1000 * mult);
}
