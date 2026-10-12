import { Schema, type } from "@colyseus/schema";
import { CrateKind } from "@bladeio/shared";

// Caisse de loot statique au sol. Encaisse les dégâts des lames qui la
// frôlent, drop des lames quand son HP tombe à 0.
export class Crate extends Schema {
  @type("string") id: string = "";
  @type("float32") x: number = 0;
  @type("float32") y: number = 0;
  @type("uint16") hp: number = 0;
  @type("uint16") maxHp: number = 0;
  // Genre (CrateKind, shared/src/mapEvents.ts) : caisse ordinaire, ou celle
  // d'un évènement de carte (coffre-fort, puce d'une chute de processeurs),
  // plus solide, au butin à part. Remplace le booléen legendary de la
  // caisse légendaire (tâche 4.4).
  @type("uint8") kind: number = CrateKind.Normal;
  // Heure du serveur où elle disparaît si personne ne l'a cassée (0 :
  // jamais). Champ serveur, non synchronisé.
  expiresAt = 0;
  // Coffre-fort : réserve de dégâts de chaque joueur (cf. damageCrate).
  // Champ serveur.
  credits = new Map<string, { credit: number; at: number }>();
}
