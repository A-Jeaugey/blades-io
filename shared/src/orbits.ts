import {
  RING_BASE_CAP,
  RING_BASE_RADIUS,
  RING_BASE_ROT_SPEED,
  RING_CAP_STEP,
  RING_RADIUS_STEP,
  RING_ROT_FALLOFF,
  SERVER_DT,
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

// Horloge d'orbite θ d'un joueur. Elle avance à orbitRate par seconde de
// jeu (tier × nombre de lames × Spin × échelle propre au joueur) et n'est
// recalée qu'au changement de vitesse : θ vaut
// orbitPhase au tick orbitTick. Serveur et clients la calculent à partir
// des mêmes champs synchronisés, donc au même angle pour un tick donné,
// quel que soit le moment où le client a rejoint la partie.
//
// Avant : angle = ω × multiplicateur × temps écoulé depuis la création de
// la room. Chaque changement de multiplicateur (ramassage, tier, Spin)
// décalait toutes les lames de Δmult × ω × t, soit des centaines de radians
// dans une room ouverte depuis une heure : les orbites « téléportaient ».
export function orbitThetaAt(phase: number, rate: number, sinceTick: number, tick: number): number {
  return phase + rate * (tick - sinceTick) * SERVER_DT;
}

// Angle d'un slot : position uniforme dans l'anneau + déphasage propre au
// joueur + vitesse de l'anneau (sens alterné, -12 % par anneau) × θ.
export function orbitSlotAngle(
  ringIndex: number,
  slotIndex: number,
  slotsInRing: number,
  theta: number,
  spinPhase: number = 0,
): number {
  const n = Math.max(1, slotsInRing);
  return (slotIndex / n) * Math.PI * 2 + spinPhase + ringAngularVelocity(ringIndex) * theta;
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
