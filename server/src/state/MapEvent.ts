import { ArraySchema, Schema, type } from "@colyseus/schema";
import { DropState, MapEventKind } from "@bladeio/shared";

// Puce d'une chute de processeurs : point d'impact, heure de l'impact, et
// ce qu'elle est devenue (DropState) ; crateId tant qu'elle est entière au
// sol.
export class MapEventDrop extends Schema {
  @type("float32") x: number = 0;
  @type("float32") y: number = 0;
  @type("float64") at: number = 0;
  @type("uint8") state: number = DropState.Falling;
  @type("string") crateId: string = "";
}

// Évènement de carte en cours (tâche 4.4, shared/src/mapEvents.ts), pour
// tous les clients : bannière, minimap et rendu en découlent. kind = None
// entre deux évènements.
export class MapEvent extends Schema {
  @type("uint8") kind: number = MapEventKind.None;
  // Centre de la zone (pluie, zone dorée) ou position du coffre.
  @type("float32") x: number = 0;
  @type("float32") y: number = 0;
  // Rayon de la zone (0 pour le coffre et la chute de processeurs).
  @type("float32") radius: number = 0;
  // Heures du serveur : début de la phase active (après l'annonce) et fin.
  @type("float64") startsAt: number = 0;
  @type("float64") endsAt: number = 0;
  // Coffre-fort de l'évènement.
  @type("string") crateId: string = "";
  // Chute de processeurs : les puces, dans l'ordre de leurs impacts.
  @type([MapEventDrop]) drops = new ArraySchema<MapEventDrop>();
}
