import { Schema, type } from "@colyseus/schema";

// Zone posée par une capacité d'agent (shared/src/agents.ts, ZoneKind) :
// nuage de Brume, piège et puits de Vortex, préavis de l'Onde de Vigie.
// Filtrée par client (zone d'intérêt) : un piège ne part qu'à son poseur et
// à ses alliés, le reste à qui est assez près pour le voir.
export class Zone extends Schema {
  @type("string") id: string = "";
  @type("uint8") kind: number = 0;
  @type("float32") x: number = 0;
  @type("float32") y: number = 0;
  @type("float32") radius: number = 0;
  @type("string") ownerId: string = "";
  @type("uint8") team: number = 0;
  // Posée par un bot (puits) : la prédiction d'un nouveau venu sait qu'elle
  // ne l'attire pas.
  @type("boolean") bot: boolean = false;
  // Heure du serveur où la zone agit (piège armé, puits ou onde après leur
  // préavis ; nuage : tout de suite), et où elle disparaît.
  @type("float64") startsAt: number = 0;
  @type("float64") endsAt: number = 0;
  // Champs serveur : heure de pose (ordre des pièges d'un même poseur) et
  // onde déjà partie.
  createdAt: number = 0;
  fired: boolean = false;
}
