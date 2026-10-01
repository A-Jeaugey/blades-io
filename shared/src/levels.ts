// Niveaux de compte (tâche 5.2). L'XP, ce sont les trophées gagnés en room
// publique : le score d'une vie (éliminations, lames, survie, caisses,
// power-ups, prime) mesure déjà la performance, et rien n'est crédité en
// room privée (tâche 0.2), donc rien à farmer seul. Compte :
// wallets.total_earned (les achats ne la font pas baisser) ; invité : le
// solde de son portefeuille invité, qui rejoint le compte à la connexion.

// XP totale pour atteindre le niveau L : LEVEL_XP_BASE × (L − 1)^LEVEL_XP_EXP.
// Niveau 2 après une ou deux vies, 10 après ~2 000 trophées (deux heures de
// jeu moyen), 50 après ~30 000.
export const LEVEL_XP_BASE = 60;
export const LEVEL_XP_EXP = 1.6;

export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.round(LEVEL_XP_BASE * Math.pow(level - 1, LEVEL_XP_EXP));
}

export function levelForXp(xp: number): number {
  const x = Number.isFinite(xp) ? Math.max(0, xp) : 0;
  let level = Math.max(1, Math.floor(1 + Math.pow(x / LEVEL_XP_BASE, 1 / LEVEL_XP_EXP)));
  // Arrondis de xpForLevel : on recale sur la définition exacte.
  while (xpForLevel(level + 1) <= x) level++;
  while (level > 1 && xpForLevel(level) > x) level--;
  return level;
}

export interface LevelProgress {
  level: number;
  // XP gagnée depuis le début du niveau, et XP qu'il demande en tout.
  current: number;
  needed: number;
  // 0 à 1.
  fraction: number;
}

export function levelProgress(xp: number): LevelProgress {
  const level = levelForXp(xp);
  const start = xpForLevel(level);
  const needed = xpForLevel(level + 1) - start;
  const current = Math.max(0, Math.floor(xp) - start);
  return { level, current, needed, fraction: needed > 0 ? Math.min(1, current / needed) : 1 };
}

// Titres, récompenses de niveau (les cosmétiques viendront avec la phase 6).
// Clé de texte : `title.<id>`.
export const LEVEL_TITLES: ReadonlyArray<{ level: number; id: string }> = [
  { level: 1, id: "recruit" },
  { level: 5, id: "blade" },
  { level: 10, id: "duelist" },
  { level: 20, id: "veteran" },
  { level: 30, id: "gladiator" },
  { level: 50, id: "master" },
  { level: 75, id: "legend" },
  { level: 100, id: "myth" },
];

export function titleForLevel(level: number): string {
  let id = LEVEL_TITLES[0].id;
  for (const t of LEVEL_TITLES) if (level >= t.level) id = t.id;
  return id;
}
