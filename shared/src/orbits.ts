import {
  RING_BASE_CAP,
  RING_BASE_RADIUS,
  RING_BASE_ROT_SPEED,
  RING_CAP_STEP,
  RING_RADIUS_STEP,
  RING_ROT_FALLOFF,
} from "./constants";

// Capacité (nombre max de slots) de l'anneau d'index ringIndex (0-based).
export function ringCapacity(ringIndex: number): number {
  return RING_BASE_CAP + ringIndex * RING_CAP_STEP;
}

// Rayon de l'anneau.
export function ringRadius(ringIndex: number): number {
  return RING_BASE_RADIUS + ringIndex * RING_RADIUS_STEP;
}

// Vitesse angulaire signée : anneaux pairs = antihoraire, impairs = horaire.
// rotMult applique le boost de tier (et d'éventuels power-ups) — défaut 1.
export function ringAngularVelocity(ringIndex: number, rotMult: number = 1): number {
  const mag = RING_BASE_ROT_SPEED * Math.pow(1 - RING_ROT_FALLOFF, ringIndex) * rotMult;
  return ringIndex % 2 === 0 ? mag : -mag;
}

// Angle d'un slot donné à un instant t (secondes), avec phase + scale
// optionnels propres à chaque joueur (pour désynchroniser deux orbites
// qui auraient sinon les mêmes angles à jamais). rotMult = boost tier/power-up.
export function slotAngle(
  ringIndex: number,
  slotIndex: number,
  slotsInRing: number,
  t: number,
  spinPhase: number = 0,
  spinScale: number = 1,
  rotMult: number = 1,
): number {
  const n = Math.max(1, slotsInRing);
  const base = (slotIndex / n) * Math.PI * 2;
  return base + spinPhase + ringAngularVelocity(ringIndex, rotMult) * t * spinScale;
}

// Position monde d'une lame en orbite autour d'un joueur.
export function orbitPosition(
  ownerX: number,
  ownerY: number,
  ringIndex: number,
  slotIndex: number,
  slotsInRing: number,
  t: number,
  rotMult: number = 1,
): { x: number; y: number; angle: number } {
  const angle = slotAngle(ringIndex, slotIndex, slotsInRing, t, 0, 1, rotMult);
  const r = ringRadius(ringIndex);
  return {
    x: ownerX + Math.cos(angle) * r,
    y: ownerY + Math.sin(angle) * r,
    angle,
  };
}

// Index de l'anneau le plus extérieur effectivement occupé pour un nombre
// donné de lames. -1 si aucune lame.
export function outerRingIndex(bladeCount: number): number {
  if (bladeCount <= 0) return -1;
  let remaining = bladeCount;
  let ring = 0;
  while (remaining > 0) {
    const cap = ringCapacity(ring);
    if (remaining <= cap) return ring;
    remaining -= cap;
    ring++;
  }
  return ring;
}

// Rayon de l'orbite extérieure (= "rayon de protection" du joueur).
// Renvoie 0 si pas de lame.
export function outerOrbitRadius(bladeCount: number): number {
  const ring = outerRingIndex(bladeCount);
  if (ring < 0) return 0;
  return ringRadius(ring);
}
