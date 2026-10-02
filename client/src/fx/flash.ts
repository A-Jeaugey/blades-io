// Réglage des flashs (tâche 3.8) appliqué aux effets lumineux : à 0 %, ils
// restent visibles mais atténués, pour montrer encore où a eu lieu un choc.
export const FX_MIN_INTENSITY = 0.35;

// Éclat d'un effet pour un réglage des flashs k de 0 à 1.
export function fxIntensity(k: number): number {
  const c = Math.max(0, Math.min(1, k));
  return FX_MIN_INTENSITY + (1 - FX_MIN_INTENSITY) * c;
}
