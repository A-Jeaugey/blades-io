// Changement qui ne s'applique qu'en reconstruisant la scène (thème,
// qualité) : la page se recharge au prochain retour au menu, jamais en
// pleine partie (tâches 0.6 et 3.9).
let pending = false;

export function reloadAtMenu(): void {
  pending = true;
}

export function isReloadPending(): boolean {
  return pending;
}
