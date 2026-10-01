// Profil joueur (tâche 5.1) : statistiques cumulées des vies en room
// publique. Même forme pour un compte (GET /api/profile/stats, tiré de la
// table `matches`) et pour un invité (statistiques gardées par le client).

export interface ProfileGame {
  score: number;
  kills: number;
  maxBlades: number;
  survivalSeconds: number;
  // Fin de la vie, ISO 8601.
  at: string;
}

export interface ProfileStats {
  games: number;
  kills: number;
  bestScore: number;
  bestKills: number;
  bestBlades: number;
  avgSurvivalSeconds: number;
  bestSurvivalSeconds: number;
  crates: number;
  powerups: number;
  // Première partie, ISO 8601 (null sans partie).
  firstPlayedAt: string | null;
  // Rang au classement de tous les temps (meilleur score), null hors compte
  // ou sans partie.
  rank: number | null;
  // XP du niveau (tâche 5.2) : trophées gagnés ; null si inconnue.
  xp: number | null;
  // Dernières parties, la plus récente d'abord.
  recent: ProfileGame[];
}

// Parties gardées dans `recent`.
export const PROFILE_RECENT_GAMES = 10;

// Une vie compte comme partie si le joueur a fait quelque chose : une vie
// d'une seconde (déconnexion au spawn, griefing) n'entre ni dans `matches`
// ni dans les statistiques locales.
export function countsAsGame(score: number, kills: number, maxBlades: number): boolean {
  return score > 0 || kills > 0 || maxBlades > 3;
}
