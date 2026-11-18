import { BladeRarity, KNOCKBACK_MAX_SPEED } from "./constants";
import { OBELISKS, STRUCTURES } from "./decor";
import { TickStamped } from "./types";

// Décor interactif (2026-11-18) : deux genres de pièces de la carte avec
// lesquelles on joue. Ce sont des caisses à place fixe (Crate.kind :
// CrateKind.Rack, CrateKind.Obelisk, hitbox dans mapEvents.ts) : les lames
// en orbite et les lancers les frappent comme une caisse, leurs PV se
// lisent dans l'état. Leurs colliders, eux, ne changent jamais (decor.ts) :
// la pièce reste un obstacle, vidée ou non, et la prédiction du client n'a
// rien de nouveau à savoir.

// --- Racks : caches à butin ----------------------------------------------
// Chaque rack de la carte se casse pour du butin, meilleur que celui d'une
// caisse, puis se recharge. Un point de passage : on sait où il est et
// quand il revient.
export const RACK_SITES: ReadonlyArray<{ x: number; y: number }> = STRUCTURES
  .filter((st) => st.kind === "rack")
  .map((st) => ({ x: st.x, y: st.y }));
// Une caisse ordinaire a 12 PV. Un joueur collé à un rack ne le frappe que
// d'une partie de son orbite (le rack reste un obstacle) : mesuré en jeu,
// 6 lames communes lui font une dizaine de dégâts par seconde, soit 8 à
// 10 s pour l'ouvrir, 2 à 3 s à 20 lames.
export const RACK_HP = 90;
export const RACK_RESPAWN_MS = 45_000;
export const RACK_LOOT_MIN = 6;
export const RACK_LOOT_MAX = 9;
export const RACK_RARITY_WEIGHTS: ReadonlyArray<{ rarity: BladeRarity; weight: number }> = [
  { rarity: BladeRarity.Common, weight: 0.2 },
  { rarity: BladeRarity.Rare, weight: 0.45 },
  { rarity: BladeRarity.Epic, weight: 0.27 },
  { rarity: BladeRarity.Legendary, weight: 0.08 },
];

// --- Obélisques : charge puis onde ---------------------------------------
// Les obélisques de l'anneau intérieur se chargent sous les coups de lames.
// Chargé à fond, l'obélisque s'arme : PULSE_WARNING_MS plus tard, il lâche
// une onde qui repousse les joueurs alentour et fait tomber une part de
// leurs lames au sol, sauf celui qui a porté le dernier coup et ses alliés.
// De quoi retourner un combat près d'un obélisque, ou en chasser un plus
// gros que soi.
export const PULSE_OBELISKS: ReadonlyArray<{ x: number; y: number }> = OBELISKS
  .slice(0, 8)
  .map((o) => ({ x: o.x, y: o.y }));
// Charge à fournir (en dégâts) et plafond par joueur et par seconde, comme
// le coffre-fort : sans lui, une grosse orbite l'armerait en un passage.
// Au plafond, 3 s ; mesuré en jeu à 6 lames communes (une vingtaine de
// dégâts par seconde, collé à lui) : une douzaine de secondes.
export const PULSE_CHARGE = 300;
export const PULSE_PLAYER_DPS = 100;
// La charge retombe si on le laisse : PULSE_REGEN_PER_S par seconde après
// PULSE_REGEN_DELAY_MS sans coup. S'armer est un choix, pas l'effet des
// lames de ceux qui passent.
export const PULSE_REGEN_DELAY_MS = 2500;
export const PULSE_REGEN_PER_S = 60;
// Préavis entre la charge pleine et l'onde : le temps de sortir du cercle
// (11 u/s de course : un joueur au pied de l'obélisque en sort tout juste).
export const PULSE_WARNING_MS = 1000;
export const PULSE_COOLDOWN_MS = 30_000;
export const PULSE_RADIUS = 11;
// Recul : le plafond des reculs de clash.
export const PULSE_KNOCKBACK = KNOCKBACK_MAX_SPEED;
// Lames qui tombent : une part de l'orbite, les moins rares d'abord,
// arrondie vers le bas (un nouveau venu à 3 lames n'en perd aucune : il est
// seulement repoussé), plafonnée pour les géants.
export const PULSE_SHED_SHARE = 0.2;
export const PULSE_SHED_MAX = 12;
// Élan des lames qui tombent, vers l'extérieur (u/s).
export const PULSE_SHED_SPEED = 7;

// Lames perdues dans une onde par un joueur de bladeCount lames.
export function pulseShedCount(bladeCount: number): number {
  return Math.min(PULSE_SHED_MAX, Math.floor(bladeCount * PULSE_SHED_SHARE));
}

// Obélisque armé en (x, y) : l'onde part dans delayMs, sur radius. byId :
// qui l'a armé (absent s'il est caché dans un buisson), épargné par l'onde.
export interface ObeliskArmedEvent extends TickStamped {
  x: number;
  y: number;
  delayMs: number;
  radius: number;
  byId?: string;
}

// Onde lâchée : hit, les joueurs touchés (repoussés, lames tombées).
export interface ObeliskPulseEvent extends TickStamped {
  x: number;
  y: number;
  radius: number;
  hit: string[];
}
