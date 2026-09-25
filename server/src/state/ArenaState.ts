import { Schema, type, MapSchema } from "@colyseus/schema";
import { Player } from "./Player";
import { Blade } from "./Blade";
import { Crate } from "./Crate";
import { PowerUp } from "./PowerUp";

export class ArenaState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Blade }) blades = new MapSchema<Blade>();
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
}
