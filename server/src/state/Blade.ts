import { Schema, type } from "@colyseus/schema";

// Une lame peut être soit attachée à un joueur (en orbite) soit au sol.
// Système d'HP : chaque rareté a HP = RARITY_HP[rarity]. Une lame qui en
// touche une autre encaisse les dégâts de l'attaquant. Avec HP = damage,
// il faut donc DEUX coups d'une lame de rareté N pour casser une de N+1.
export class Blade extends Schema {
  @type("string") id: string = "";
  @type("uint8") rarity: number = 0; // BladeRarity
  @type("float32") x: number = 0; // position monde (uniquement utile au sol)
  @type("float32") y: number = 0;
  // HP courants. Initialisé à RARITY_HP[rarity] (= damage value).
  @type("uint16") hp: number = 1;
  // Si la lame est en orbite : ownerId non vide, sinon au sol.
  @type("string") ownerId: string = "";
  @type("uint16") ringIndex: number = 0;
  @type("uint16") slotIndex: number = 0;
  // Pour les lames au sol : vélocité (glissade après drop)
  @type("float32") vx: number = 0;
  @type("float32") vy: number = 0;
  // Lame en projectile (lancée par un joueur). Quand vrai :
  //  - pas de friction au sol (vol en ligne droite jusqu'à impact ou TTL)
  //  - ne peut pas être ramassée
  //  - traitée par le système de collisions projectile-vs-monde
  @type("boolean") isProjectile: boolean = false;
  // ID du joueur qui a lancé la lame (l'attaquant ne se hit pas lui-même).
  @type("string") thrownBy: string = "";
  // Compteur de "perçage" restant. Décrémenté à chaque impact (orbite,
  // joueur, caisse). Quand ≤ 0, la lame est détruite. Common/Rare = 1,
  // Epic = 2, Legendary = 3 (cf. THROW_PIERCE).
  @type("uint8") pierceLeft: number = 0;
  // Si drop d'un joueur mort, petit délai anti-pickup immédiat pour les autres
  pickupLockUntil: number = 0;
  // Timestamp d'expiration pour les lames au sol (0 = illimité). Si > 0 et
  // atteint, la lame est despawn pour libérer la map.
  expiresAt: number = 0;
  // Cibles déjà touchées par ce projectile (sessionIds joueurs / ids
  // crates / ids blades). Évite les doubles-impacts au tick suivant.
  hitIds: Set<string> = new Set<string>();
  // Point de départ du projectile (set au moment du throw). Utilisé pour
  // calculer la distance parcourue et faire retomber la lame au sol une
  // fois la portée maximale atteinte.
  originX: number = 0;
  originY: number = 0;
}
