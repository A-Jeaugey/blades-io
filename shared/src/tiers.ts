import {
  BLADE_HITBOX,
  BLADE_ROT_DIVISOR,
  BLADE_ROT_MAX_BONUS,
  CLASH_SHAKE_INTENSITY,
  HITLAG_DURATION_MS,
  KNOCKBACK_BASE,
  KNOCKBACK_TIER_MULT,
  TIER_COUNT,
  TIER_HITBOX_MULT,
  TIER_ROT_MULT,
  TIER_THRESHOLDS,
  TIER_VISUAL_SCALE,
} from "./constants";

// Index de tier 0-based (0, 1 ou 2). bladeCount=0 → tier 0 (pas de "tier -1",
// simplifie tous les sites d'appel).
export function tierFromBladeCount(bladeCount: number): number {
  let t = 0;
  for (let i = TIER_THRESHOLDS.length - 1; i >= 0; i--) {
    if (bladeCount >= TIER_THRESHOLDS[i]) {
      t = i;
      break;
    }
  }
  return t;
}

function clampTier(tier: number): number {
  if (tier < 0) return 0;
  if (tier >= TIER_COUNT) return TIER_COUNT - 1;
  return tier;
}

// Hitbox effective d'une lame pour un joueur de tier donné. La hitbox est
// décorrélée du sprite visuel : c'est volontaire, pour forcer les contacts.
export function tierBladeHitbox(tier: number): number {
  return BLADE_HITBOX * TIER_HITBOX_MULT[clampTier(tier)];
}

// Multiplicateur de vitesse angulaire pour un joueur de tier donné. La
// vitesse de rotation grimpe par paliers — combiné à des hitboxes plus
// larges, ça réduit drastiquement la fenêtre d'espace vide entre les lames.
export function tierRotationMult(tier: number): number {
  return TIER_ROT_MULT[clampTier(tier)];
}

export function tierVisualScale(tier: number): number {
  return TIER_VISUAL_SCALE[clampTier(tier)];
}

export function tierKnockback(tier: number): number {
  return KNOCKBACK_BASE * KNOCKBACK_TIER_MULT[clampTier(tier)];
}

export function tierHitlagMs(tier: number): number {
  return HITLAG_DURATION_MS[clampTier(tier)];
}

export function tierClashShake(tier: number): number {
  return CLASH_SHAKE_INTENSITY[clampTier(tier)];
}

// Multiplicateur de vitesse de rotation en fonction du nombre de lames.
// Indépendant du tier : plus le joueur accumule de lames, plus ses orbites
// tournent vite, ce qui rend les joueurs forts visuellement plus dangereux
// et compense l'espacement naturel des lames sur des anneaux plus larges.
export function bladeCountRotationMult(bladeCount: number): number {
  const ratio = Math.min(1, Math.max(0, bladeCount) / BLADE_ROT_DIVISOR);
  return 1 + ratio * BLADE_ROT_MAX_BONUS;
}
