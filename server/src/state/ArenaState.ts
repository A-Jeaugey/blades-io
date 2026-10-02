import { ArraySchema, Schema, type, view, MapSchema } from "@colyseus/schema";
import { MAP_RADIUS } from "@bladeio/shared";
import { Player } from "./Player";
import { Blade } from "./Blade";
import { Crate } from "./Crate";
import { PowerUp } from "./PowerUp";
import { Flag } from "./Flag";

export class ArenaState extends Schema {
  // Filtrés par client (zone d'intérêt, cf. systems/interest.ts) : chacun ne
  // reçoit que les joueurs et les lames qu'il peut voir. Caisses et
  // power-ups, peu nombreux et sans rien à cacher, vont à tout le monde.
  @view() @type({ map: Player }) players = new MapSchema<Player>();
  @view() @type({ map: Blade }) blades = new MapSchema<Blade>();
  @type({ map: Crate }) crates = new MapSchema<Crate>();
  @type({ map: PowerUp }) powerups = new MapSchema<PowerUp>();
  // Rayon de l'arène : celui de la carte, resserré en fin de manche (7.1).
  @type("float32") mapRadius: number = MAP_RADIUS;
  @type("uint32") tick: number = 0;
  // Date.now() du serveur au tick courant. Les échéances (*Until,
  // spawnedAt) sont des dates du serveur : le client les compare à cette
  // horloge estimée, jamais à celle du navigateur, qui peut être décalée.
  @type("float64") serverTime: number = 0;
  @type("string") code: string = "";
  @type("boolean") isPrivate: boolean = false;
  @type("boolean") botsEnabled: boolean = true;
  // Mode de jeu (tâche 7.3, shared/src/modes.ts) et phase de la partie : en
  // jeu, ou entracte d'un mode à fin (MatchPhase) ; phaseEndsAt est la fin
  // de la phase en heure du serveur (0 : sans échéance).
  @type("string") mode: string = "ffa";
  @type("uint8") phase: number = 0;
  @type("float64") phaseEndsAt: number = 0;
  // Score des deux équipes (modes équipe, tâche 7.2) : éliminations,
  // joueurs en vie ou captures selon le mode.
  @type("uint16") teamScore1: number = 0;
  @type("uint16") teamScore2: number = 0;
  // Drapeaux de la capture du drapeau (un par équipe), vide sinon.
  @type([Flag]) flags = new ArraySchema<Flag>();
}
