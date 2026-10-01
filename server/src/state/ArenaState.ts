import { Schema, type, view, MapSchema } from "@colyseus/schema";
import { Player } from "./Player";
import { Blade } from "./Blade";
import { Crate } from "./Crate";
import { PowerUp } from "./PowerUp";

export class ArenaState extends Schema {
  // Filtrés par client (zone d'intérêt, cf. systems/interest.ts) : chacun ne
  // reçoit que les joueurs et les lames qu'il peut voir. Caisses et
  // power-ups, peu nombreux et sans rien à cacher, vont à tout le monde.
  @view() @type({ map: Player }) players = new MapSchema<Player>();
  @view() @type({ map: Blade }) blades = new MapSchema<Blade>();
  @type({ map: Crate }) crates = new MapSchema<Crate>();
  @type({ map: PowerUp }) powerups = new MapSchema<PowerUp>();
  @type("float32") mapRadius: number = 0;
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
}
