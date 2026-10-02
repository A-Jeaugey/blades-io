import { MAP_RADIUS } from "./constants";

// Arène dont la taille suit la population (tâche 4.5, décision D9) : à
// trois joueurs on se cherchait longtemps sur 250 u de rayon. La forme
// reste un cercle, la carte (sol, décor) ne change pas : seul le mur
// (ArenaState.mapRadius) se déplace, lentement et annoncé.

export const ARENA_MIN_RADIUS = 140;

// Surface par joueur qui baisse avec la population : rayon² = 22 000 +
// 675 × joueurs, soit ~155 u à 3 joueurs, ~171 u à 11 (un humain et ses
// bots), 250 u (la carte entière) à 60.
export function populationRadius(players: number): number {
  const r = Math.sqrt(22_000 + 675 * Math.max(0, players));
  return Math.max(ARENA_MIN_RADIUS, Math.min(MAP_RADIUS, r));
}

// Le mur recule (arène qui grandit) sans préavis, d'au moins
// ARENA_GROW_SPEED, et d'ARENA_GROW_RATE de l'écart par seconde : un
// afflux (room qui se remplit d'un coup, retour de tous après un
// redéploiement) ne reste pas entassé dans la petite arène. Banc serveur,
// 60 bots créés ensemble à 4 u/s seulement : 453 éliminations les 30
// premières secondes, ~25 ensuite. Il avance (elle se resserre) après
// ARENA_SHRINK_NOTICE_MS d'annonce, toujours bien moins vite qu'un joueur
// (PLAYER_SPEED = 11 u/s).
export const ARENA_GROW_SPEED = 4;
export const ARENA_GROW_RATE = 0.5;
export const ARENA_SHRINK_SPEED = 1.5;
export const ARENA_SHRINK_NOTICE_MS = 10_000;
// La population retenue est la plus haute de cette fenêtre : un bot qui
// meurt et revient, un joueur qui se reconnecte ne font pas bouger le mur.
export const ARENA_POPULATION_WINDOW_MS = 20_000;
// En deçà de cet écart, l'arène ne se resserre pas.
export const ARENA_MIN_SHRINK = 4;
