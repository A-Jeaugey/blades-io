import {
  BOUNTY_MAX,
  BOUNTY_MIN,
  BOUNTY_MIN_SCORE,
  BOUNTY_SHARE,
  UNDERDOG_MIN_VICTIM_BLADES,
  UNDERDOG_RATIO,
} from "./constants";

// Contre-mesures au snowball (tâche 4.2) : règles de balance, à côté de
// leurs constantes. Le client ne les recalcule pas : la prime du leader lui
// parvient dans le résumé de la room (RoomSummary.leader).

// Prime offerte pour l'élimination du leader, selon son score : 0 en
// dessous de BOUNTY_MIN_SCORE (début de partie, pas encore de vrai leader).
export function bountyFor(leaderScore: number): number {
  if (leaderScore < BOUNTY_MIN_SCORE) return 0;
  return Math.min(BOUNTY_MAX, Math.max(BOUNTY_MIN, Math.round(leaderScore * BOUNTY_SHARE)));
}

// Élimination « underdog » : le tueur avait au plus 1 / UNDERDOG_RATIO des
// lames de sa victime au début de l'échange (cf. bladesBeforeFight côté
// serveur), contre une victime d'une taille qui compte.
export function isUnderdogKill(killerBlades: number, victimBlades: number): boolean {
  return victimBlades >= UNDERDOG_MIN_VICTIM_BLADES && killerBlades * UNDERDOG_RATIO <= victimBlades;
}
