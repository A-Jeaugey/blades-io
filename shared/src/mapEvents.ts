import { BladeRarity, CRATE_HITBOX } from "./constants";
import type { TickStamped } from "./types";

// Évènements de carte (tâche 4.4) : de quoi faire converger les joueurs,
// surtout dans les petites rooms où l'on se cherche longtemps. Un seul à la
// fois, toutes les 50 à 70 s, synchronisé par ArenaState.mapEvent : le
// client en tire la bannière, le marqueur de minimap et le rendu.

export const MapEventKind = {
  None: 0,
  // Pluie de lames sur une zone, annoncée quelques secondes avant.
  Rain: 1,
  // Coffre-fort près du centre, signalé sur la minimap jusqu'à sa
  // destruction. Identifiant et nom de télémétrie ('crate') de la caisse
  // légendaire qu'il remplace (retours du 2026-10-12) : les lignes de
  // map_events d'avant restent comparables.
  Crate: 2,
  // Zone dorée au centre : points doublés tant qu'on y reste.
  Golden: 3,
  // Chute de processeurs : des puces tombent en plusieurs points de
  // l'arène, chacune annoncée au sol avant son impact.
  Processors: 4,
} as const;
export type MapEventKind = (typeof MapEventKind)[keyof typeof MapEventKind];

// Délai entre la fin d'un évènement et le début du suivant (tirage
// uniforme). Le premier vient aussi après ce délai. 90 à 120 s jusqu'au
// 2026-10-12 (« réduire le temps entre les évènements ») : un débutant
// mourait souvent une première fois (médiane ~80 à 95 s au banc de survie)
// sans en avoir vu un, et une manche de 5 min n'en avait qu'un. À 50-70 s,
// le premier tombe dans la première minute et une manche en a deux, avec
// encore une minute calme entre deux évènements : sous ~45 s, il y en
// aurait un presque en continu (le coffre peut durer 2 min) et le butin
// des évènements pèserait plus que l'ambiant.
export const MAP_EVENT_INTERVAL_MIN_MS = 50_000;
export const MAP_EVENT_INTERVAL_MAX_MS = 70_000;
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

// Genre d'une caisse (Crate.kind) : caisse ordinaire, coffre-fort et puce
// restée entière d'une chute de processeurs. Le client en tire le modèle,
// le serveur la hitbox, les PV et le butin.
export const CrateKind = {
  Normal: 0,
  Vault: 1,
  Chip: 2,
} as const;
export type CrateKind = (typeof CrateKind)[keyof typeof CrateKind];

// Coffre-fort (retours du 2026-10-12, remplace la caisse légendaire) : à
// VAULT_CENTER_DIST du centre, à côté du pilier central, là où tout le
// monde passe. Très solide, le temps que d'autres arrivent : une lame en
// orbite qui le touche frappe jusqu'à 5 fois par seconde (cooldown par
// paire), donc un joueur à 40 lames du mélange courant (26 communes, 10
// rares, 3 épiques, 1 légendaire), posé dessus, lui fait ~330 dégâts par
// seconde (~230 en le frôlant) ; à 20 lames, ~140 ; à 80, ~690. Les lames
// en orbite ne s'y abîment pas ; une lame lancée y fait ses dégâts puis
// retombe à son pied. Retiré au bout de VAULT_MAX_MS si personne ne l'a
// ouvert.
export const VAULT_HP = 6000;
export const VAULT_HITBOX = 2.2;
export const VAULT_CENTER_DIST = 7;
export const VAULT_MAX_MS = 120_000;
// Dégâts qu'un même joueur peut lui infliger par seconde, toutes lames
// confondues : à peu près ce que fait un joueur à 40 lames, qui l'ouvre
// seul en ~20 s (test « coffre : calibrage »), 20 s aussi pour une orbite
// plus grosse, ~45 s à 20 lames, deux fois plus vite à deux. Sans plafond,
// une orbite de 80 lames l'ouvrait en 9 s, et le plus gros raflait le
// butin avant que quiconque arrive (boule de neige) : le coffre s'ouvre
// plus vite à plusieurs, pas au plus gros.
export const VAULT_PLAYER_DPS = 300;
// Butin : VAULT_LOOT_MIN à VAULT_LOOT_MAX lames, que des rares, des
// épiques et des légendaires. Espérance : 15 rares, 9 épiques, 3
// légendaires (au moins une dans 97 % des coffres, comme la légendaire
// garantie de la caisse d'avant), trois fois le butin de l'ancienne
// caisse : c'est le gros lot des évènements, à disputer.
export const VAULT_LOOT_MIN = 24;
export const VAULT_LOOT_MAX = 30;
export const VAULT_RARITY_WEIGHTS: Array<{ rarity: BladeRarity; weight: number }> = [
  { rarity: BladeRarity.Rare, weight: 0.55 },
  { rarity: BladeRarity.Epic, weight: 0.33 },
  { rarity: BladeRarity.Legendary, weight: 0.12 },
];
// Vitesse des lames projetées depuis le bord du coffre (u/s) : avec la
// friction du sol (GROUND_BLADE_FRICTION), elles se posent entre ~3 et ~10 u
// de lui, hors de l'aimant d'un seul joueur : le premier arrivé n'a pas
// tout.
export const VAULT_DROP_SPEED_MIN = 4.5;
export const VAULT_DROP_SPEED_MAX = 8.5;

// Chute de processeurs (retours du 2026-10-12) : PROCESSOR_COUNT_MIN à
// PROCESSOR_COUNT_MAX puces selon la surface de l'arène, chacune annoncée
// au sol (cercle de PROCESSOR_ALERT_RADIUS) dès l'annonce, la première
// tombant PROCESSOR_WARNING_MS après, les autres échelonnées sur
// PROCESSOR_SPREAD_MS. À l'impact, une sur deux explose et éparpille ses
// lames ; les autres restent entières au sol, comme une petite caisse
// (CrateKind.Chip) qui les libère quand on la casse et disparaît au bout de
// CHIP_CRATE_MAX_MS. Aucun dégât aux joueurs.
export const PROCESSOR_COUNT_MIN = 3;
export const PROCESSOR_COUNT_MAX = 5;
export const PROCESSOR_WARNING_MS = 4_000;
export const PROCESSOR_SPREAD_MS = 5_000;
// Durée de la chute affichée par le client, avant l'impact.
export const PROCESSOR_FALL_MS = 1_100;
export const PROCESSOR_ALERT_RADIUS = 4;
export const PROCESSOR_EXPLODE_CHANCE = 0.5;
export const PROCESSOR_LOOT_MIN = 5;
export const PROCESSOR_LOOT_MAX = 10;
// Un peu moins généreux que le coffre (on n'a pas à se battre pour une
// puce) : surtout des rares, une légendaire de temps en temps.
export const PROCESSOR_RARITY_WEIGHTS: Array<{ rarity: BladeRarity; weight: number }> = [
  { rarity: BladeRarity.Rare, weight: 0.65 },
  { rarity: BladeRarity.Epic, weight: 0.27 },
  { rarity: BladeRarity.Legendary, weight: 0.08 },
];
// Puce restée entière : deux fois et demie une caisse (CRATE_HP = 12).
export const CHIP_CRATE_HP = 30;
export const CHIP_CRATE_MAX_MS = 60_000;
export const CHIP_HITBOX = 1.2;

// Puces d'une chute, selon la part de la carte entière qu'occupe l'arène
// (areaShare côté serveur) : 3 dans l'arène d'un humain et de ses bots, 5
// sur la carte entière.
export function processorCount(areaShare: number): number {
  const k = Math.max(0, Math.min(1, (areaShare - 0.4) / 0.6));
  return PROCESSOR_COUNT_MIN + Math.round(k * (PROCESSOR_COUNT_MAX - PROCESSOR_COUNT_MIN));
}

// État d'une puce de la chute (MapEventDrop.state).
export const DropState = {
  // Annoncée, pas encore tombée.
  Falling: 0,
  // Explosée à l'impact : ses lames sont au sol.
  Exploded: 1,
  // Entière au sol : une caisse à casser (crateId).
  Standing: 2,
  // Puce cassée ou disparue.
  Gone: 3,
} as const;
export type DropState = (typeof DropState)[keyof typeof DropState];

// Server → Client : impact d'une puce, joué au tick (atTick) là où elle
// tombe. exploded : lames éparpillées ; sinon la puce reste au sol
// (crateId).
export interface ProcessorImpactEvent extends TickStamped {
  x: number;
  y: number;
  exploded: boolean;
  crateId?: string;
}

// Rayon de contact d'une caisse avec les lames et les lancers, selon son
// genre.
export function crateHitbox(kind: number): number {
  if (kind === CrateKind.Vault) return VAULT_HITBOX;
  if (kind === CrateKind.Chip) return CHIP_HITBOX;
  return CRATE_HITBOX;
}

// Zone dorée : au centre de la carte, annoncée GOLDEN_WARNING_MS avant ;
// pendant GOLDEN_DURATION_MS, tout point gagné à l'intérieur compte double.
export const GOLDEN_RADIUS = 22;
export const GOLDEN_WARNING_MS = 5_000;
export const GOLDEN_DURATION_MS = 30_000;

// Un joueur a « convergé » vers un évènement (télémétrie, critère de la
// tâche) s'il est entré dans sa zone, marge comprise, ou s'est approché à
// cette distance du coffre ou d'une puce.
export const MAP_EVENT_REACH_MARGIN = 4;
export const VAULT_REACH = 12;
export const PROCESSOR_REACH = 12;
