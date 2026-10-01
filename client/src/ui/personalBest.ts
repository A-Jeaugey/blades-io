// Record personnel (tâches 3.4 et 3.5) : meilleur score d'une vie en room
// publique, gardé dans ce navigateur. Les rooms privées n'y comptent pas :
// leur butin est 2,5 fois plus dense et elles ne rapportent aucun trophée.

const KEY = "blade.best";

let cached: number | null = null;

// Stockage indisponible (navigation privée, données bloquées) : le record
// vaut pour la session.
export function getBest(): number {
  if (cached === null) {
    cached = 0;
    try {
      const v = Number(localStorage.getItem(KEY));
      if (Number.isFinite(v) && v > 0) cached = Math.floor(v);
    } catch { /* stockage indisponible */ }
  }
  return cached;
}

// Fin d'une vie : renvoie le record d'avant et s'il est battu.
export function submitScore(score: number): { previous: number; isNew: boolean } {
  const previous = getBest();
  if (score <= previous) return { previous, isNew: false };
  cached = score;
  try { localStorage.setItem(KEY, String(score)); } catch { /* idem */ }
  return { previous, isNew: true };
}
