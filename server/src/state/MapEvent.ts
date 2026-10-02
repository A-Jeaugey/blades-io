import { Schema, type } from "@colyseus/schema";
import { MapEventKind } from "@bladeio/shared";

// Évènement de carte en cours (tâche 4.4, shared/src/mapEvents.ts), pour
// tous les clients : bannière, minimap et rendu en découlent. kind = None
// entre deux évènements.
export class MapEvent extends Schema {
  @type("uint8") kind: number = MapEventKind.None;
  // Centre de la zone (pluie, zone dorée) ou position de la caisse.
  @type("float32") x: number = 0;
  @type("float32") y: number = 0;
  // Rayon de la zone (0 pour la caisse).
  @type("float32") radius: number = 0;
  // Heures du serveur : début de la phase active (après l'annonce) et fin.
  @type("float64") startsAt: number = 0;
  @type("float64") endsAt: number = 0;
  // Caisse légendaire de l'évènement.
  @type("string") crateId: string = "";
}
