import { BladeRarity, PowerUpType } from "./constants";

export interface InputMessage {
  dx: number;
  dy: number;
  boost: boolean;
  // Edge-trigger côté client : true UNE fois pour un appui, puis false. Le
  // serveur consomme le flag (et applique le cooldown), pas besoin de le
  // tenir.
  throw?: boolean;
  seq?: number;
}

export interface SetNameMessage {
  name: string;
}

export interface RespawnMessage {
  name?: string;
}

export interface BladeDestroyedEvent {
  bladeId: string;
  x: number;
  y: number;
  rarity: BladeRarity;
  ownerId?: string;
}

export interface PlayerKilledEvent {
  victimId: string;
  killerId: string | null;
  victimName: string;
  killerName: string | null;
}

export interface PickupEvent {
  playerId: string;
  rarity: BladeRarity;
}

export interface CrateHitEvent {
  crateId: string;
  x: number;
  y: number;
  hp: number;
}

export interface CrateDestroyedEvent {
  crateId: string;
  x: number;
  y: number;
}

export interface PowerUpPickupEvent {
  playerId: string;
  type: PowerUpType;
  rarity: BladeRarity;
  x: number;
  y: number;
}

// Émis chaque fois que deux lames de joueurs différents entrent en contact
// (avec ou sans destruction). Contient les deux ids et un tier "effectif"
// (= max des deux tiers) qui pilote l'intensité du screen shake côté client.
export interface ClashEvent {
  aId: string;
  bId: string;
  x: number;        // point d'impact (milieu)
  y: number;
  tier: number;     // 0..2, max des deux protagonistes
  destroyed: number; // 0, 1 ou 2 lames cassées (info FX uniquement)
}

// Émis quand un joueur change de palier (passage Tier 1 → 2 → 3). Le client
// déclenche la VFX de tier-up + son + shake si c'est le joueur local.
export interface TierUpEvent {
  playerId: string;
  tier: number;     // nouveau tier (1 ou 2 ; tier 0 ne déclenche rien)
  x: number;
  y: number;
}

// Émis quand un joueur lance une lame (commence le vol). Le client utilise
// les coordonnées et la direction pour placer la VFX de tir + son.
export interface BladeThrownEvent {
  bladeId: string;
  thrownBy: string;
  rarity: BladeRarity;
  x: number;
  y: number;
  dirX: number;
  dirY: number;
}

// Émis à l'impact d'un projectile (joueur, lame, ou caisse). Sert au
// client à afficher la VFX d'impact + son.
export interface ProjectileImpactEvent {
  bladeId: string;
  rarity: BladeRarity;
  x: number;
  y: number;
  // 0 = orbite blade, 1 = body, 2 = crate, 3 = wall (despawn)
  kind: number;
  // True si c'est le dernier impact (la lame est consommée).
  destroyed: boolean;
}

// Client → Server : message envoyé quand l'user tape dans le chat.
// Le serveur valide la longueur, applique le rate limit, et rebroadcaste
// un ChatEvent à toute la room (avec sender info enrichi).
export interface ChatMessage {
  text: string;
}

// Server → Clients : message broadcasté à toute la room après qu'un joueur
// a envoyé un ChatMessage validé. Inclut pseudo + ID + timestamp pour
// l'affichage côté client (pas besoin de re-lookup).
export interface ChatEvent {
  playerId: string;
  playerName: string;
  text: string;
  ts: number;
  // True si c'est un message système (ex : "X a rejoint la room"). Pas
  // utilisé côté serveur pour l'instant, l'option est ouverte pour de
  // futures notifs.
  system?: boolean;
}



export type RoomMessageType =
  | "input"
  | "respawn"
  | "setName"
  | "chat"
  | "bladeDestroyed"
  | "playerKilled"
  | "pickup"
  | "crateHit"
  | "crateDestroyed"
  | "powerupPickup"
  | "clash"
  | "tierUp"
  | "bladeThrown"
  | "projectileImpact"
  | "pong";

export { BladeRarity };
