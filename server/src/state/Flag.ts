import { Schema, type } from "@colyseus/schema";

// Drapeau d'une équipe (capture du drapeau, tâche 7.2). Synchronisé pour
// tous, sans zone d'intérêt : sa position, porteur compris, est publique
// (minimap, repères à l'écran).
export class Flag extends Schema {
  @type("uint8") team: number = 0;
  @type("float32") x: number = 0;
  @type("float32") y: number = 0;
  // Joueur qui le porte, "" sinon.
  @type("string") carrierId: string = "";
  @type("boolean") atBase: boolean = true;
  // Heure du serveur où un drapeau lâché rentre seul à sa base, 0 sinon.
  @type("float64") returnsAt: number = 0;
}
