import { BladeRarity, POWERUP_DURATION, POWERUP_SPEED_DURATION, PowerUpType } from "./constants";

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

// Durée de base d'un effet, avant amélioration (s). Speed a la sienne,
// courte (cf. POWERUP_SPEED_DURATION) : une forte accélération sur 25 s
// déciderait seule des poursuites.
export function basePowerUpDuration(type: PowerUpType, rarity: BladeRarity): number {
  if (type === PowerUpType.Speed) return POWERUP_SPEED_DURATION[rarity];
  return POWERUP_DURATION[rarity];
}

// Durée d'un effet (ms) pour un joueur au niveau d'amélioration `level` de
// ce power-up. Serveur (application de l'effet) et client (page des
// améliorations, explications) lisent la même.
export function powerUpDurationMs(type: PowerUpType, rarity: BladeRarity, level = 0): number {
  const mult = 1 + clampUpgradeLevel(level) * POWERUP_UPGRADE_STEP;
  return Math.round(basePowerUpDuration(type, rarity) * 1000 * mult);
}

// Effets actifs d'un joueur, visibles de tous (Player.activeEffects) : un
// bit par type. Les *Until restent réservés au joueur lui-même (vue
// OWNER_VIEW_TAG) ; ce masque, qui ne change qu'au début et à la fin d'un
// effet, suffit aux autres clients pour le montrer (lignes de vitesse sous
// Speed).
export function powerUpBit(type: PowerUpType): number {
  return 1 << type;
}
