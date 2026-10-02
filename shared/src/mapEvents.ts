import { BladeRarity } from "./constants";

// Évènements de carte (tâche 4.4) : de quoi faire converger les joueurs,
// surtout dans les petites rooms où l'on se cherche longtemps. Un seul à la
// fois, toutes les 90 à 120 s, synchronisé par ArenaState.mapEvent : le
// client en tire la bannière, le marqueur de minimap et le rendu.

export const MapEventKind = {
  None: 0,
  // Pluie de lames sur une zone, annoncée quelques secondes avant.
  Rain: 1,
  // Caisse légendaire, signalée sur la minimap jusqu'à sa destruction.
  Crate: 2,
  // Zone dorée au centre : points doublés tant qu'on y reste.
  Golden: 3,
} as const;
export type MapEventKind = (typeof MapEventKind)[keyof typeof MapEventKind];

// Délai entre la fin d'un évènement et le début du suivant (tirage
// uniforme). Le premier vient aussi après ce délai.
export const MAP_EVENT_INTERVAL_MIN_MS = 90_000;
export const MAP_EVENT_INTERVAL_MAX_MS = 120_000;
// Pas d'évènement qui déborderait sur la fin d'une partie à échéance (ni
// sur la dernière minute d'une manche, où l'arène se resserre).
export const MAP_EVENT_END_MARGIN_MS = 75_000;

// Pluie de lames : zone annoncée RAIN_WARNING_MS avant, puis RAIN_BLADES
// lames y tombent, réparties sur RAIN_DURATION_MS, plus rares que
// l'ambiant ; au sol, elles expirent comme le butin (GROUND_BLADE_TTL_MS).
export const RAIN_WARNING_MS = 5_000;
export const RAIN_DURATION_MS = 6_000;
export const RAIN_RADIUS = 16;
export const RAIN_BLADES = 28;
export const RAIN_RARITY_WEIGHTS: Array<{ rarity: BladeRarity; weight: number }> = [
  { rarity: BladeRarity.Common, weight: 0.45 },
  { rarity: BladeRarity.Rare, weight: 0.33 },
  { rarity: BladeRarity.Epic, weight: 0.17 },
  { rarity: BladeRarity.Legendary, weight: 0.05 },
];

// Caisse légendaire : dix fois plus solide qu'une caisse (CRATE_HP = 12),
// le temps que d'autres arrivent ; elle lâche une légendaire et un paquet
// de lames rares ; disparaît si personne ne la casse à temps.
export const LEGENDARY_CRATE_HP = 120;
export const LEGENDARY_CRATE_MAX_MS = 90_000;
export const LEGENDARY_CRATE_LOOT: readonly BladeRarity[] = [
  BladeRarity.Legendary,
  BladeRarity.Epic,
  BladeRarity.Epic,
  BladeRarity.Rare,
  BladeRarity.Rare,
  BladeRarity.Rare,
  BladeRarity.Common,
  BladeRarity.Common,
  BladeRarity.Common,
];

// Zone dorée : au centre de la carte, annoncée GOLDEN_WARNING_MS avant ;
// pendant GOLDEN_DURATION_MS, tout point gagné à l'intérieur compte double.
export const GOLDEN_RADIUS = 22;
export const GOLDEN_WARNING_MS = 5_000;
export const GOLDEN_DURATION_MS = 30_000;

// Un joueur a « convergé » vers un évènement (télémétrie, critère de la
// tâche) s'il est entré dans sa zone, marge comprise, ou s'est approché à
// cette distance de la caisse.
export const MAP_EVENT_REACH_MARGIN = 4;
export const LEGENDARY_CRATE_REACH = 12;
