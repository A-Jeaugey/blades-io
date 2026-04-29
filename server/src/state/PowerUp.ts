import { Schema, type } from "@colyseus/schema";

// Orbe au sol. Donne un effet temporaire/instant quand un joueur le touche.
// `type` et `rarity` déterminent l'effet appliqué et sa durée.
export class PowerUp extends Schema {
  @type("string") id: string = "";
  @type("uint8") type: number = 0;   // PowerUpType enum
  @type("uint8") rarity: number = 0; // BladeRarity (détermine la durée)
  @type("float32") x: number = 0;
  @type("float32") y: number = 0;
}
