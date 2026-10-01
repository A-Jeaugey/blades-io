// Room de jeu instanciée hors réseau pour les tests d'intégration.
import { ArenaState } from "../src/state/ArenaState";
import { Player } from "../src/state/Player";
import { ArenaRoom } from "../src/rooms/ArenaRoom";
import { DT, FakeClock } from "./helpers";

export interface BroadcastEvent {
  type: string;
  message: any;
}

// Room hors réseau : pas de matchmaker, pas de minuteries Colyseus (patchs,
// simulation, auto-dispose). Le test fait avancer la simulation lui-même
// avec tick(), après avoir avancé l'horloge simulée.
export class TestRoom {
  readonly room: any;
  readonly events: BroadcastEvent[] = [];

  constructor(private readonly clock: FakeClock, options: { code?: string; bots?: boolean } = {}) {
    const room: any = new ArenaRoom();
    room.listing = { metadata: null, save: async () => {}, markModified: () => {}, updateOne: async () => {} };
    room.autoDispose = false;
    room.__init();
    room.broadcast = (type: string, message: any) => {
      this.events.push({ type, message });
    };
    // Évènements ciblés (zones d'intérêt) : capturés comme les autres,
    // quel que soit leur destinataire.
    room.sendScoped = (type: string, message: any) => {
      this.events.push({ type, message });
    };
    room.onCreate({ bots: false, ...options });
    clearInterval(room._simulationInterval);
    room.patchRate = null;
    this.room = room;
  }

  get state(): ArenaState {
    return this.room.state;
  }

  tick(count = 1): void {
    for (let i = 0; i < count; i++) {
      this.clock.advance(DT * 1000);
      this.room.tick(DT);
    }
  }

  join(
    sessionId: string,
    auth: { userId?: string | null; guestId?: string | null } = {},
    opts: { protected?: boolean; newcomer?: boolean } = {},
  ): Player {
    this.room.onJoin({ sessionId }, { newcomer: opts.newcomer }, {
      userId: auth.userId ?? null,
      username: null,
      guestId: auth.guestId ?? null,
      name: sessionId,
    });
    const p = this.state.players.get(sessionId)!;
    // Les tests placent les joueurs eux-mêmes : ni invulnérabilité, ni
    // période de grâce, sauf demande (banc de survie : un vrai nouveau venu).
    if (!opts.protected) {
      p.spawnProtectionUntil = 0;
      p.graceUntil = 0;
      p.graceRampUntil = 0;
    }
    return p;
  }

  eventsOf(type: string): any[] {
    return this.events.filter((e) => e.type === type).map((e) => e.message);
  }
}
