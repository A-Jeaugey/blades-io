import { Schema, type } from "@colyseus/schema";

// Caisse de loot statique au sol. Encaisse les dégâts des lames qui la
// frôlent, drop des lames quand son HP tombe à 0.
export class Crate extends Schema {
  @type("string") id: string = "";
  @type("float32") x: number = 0;
  @type("float32") y: number = 0;
  @type("uint16") hp: number = 0;
  @type("uint16") maxHp: number = 0;
}
