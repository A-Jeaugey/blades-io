import { SERVER_DT } from "@bladeio/shared";

// Estimation de l'horloge du serveur, à partir de state.tick (tick de
// simulation) et de state.serverTime (Date.now() du serveur), reçus à
// chaque patch.
//
// Le décalage (temps du tick − instant de réception) est lissé : la gigue
// de réception ne doit pas faire trembler la rotation des orbites. Il inclut
// la latence moyenne, ce qui est voulu : un tick estimé ainsi correspond à
// l'état que le client affiche, et tickAt(maintenant − RENDER_DELAY) tombe
// au même instant que la position interpolée des joueurs distants.
export class ServerClock {
  private offsetSec = 0;
  private ready = false;
  private epochOffsetMs = 0;
  private epochReady = false;

  // Au-delà de cet écart, on recale d'un coup plutôt que de lisser : onglet
  // resté en arrière-plan, reconnexion, pause réseau.
  private static readonly RESYNC_SEC = 0.25;
  // Poids d'un nouvel échantillon (~60 par seconde) : environ 0,3 s pour
  // absorber un changement durable de latence.
  private static readonly SMOOTHING = 0.05;

  onTick(tick: number, clientMs: number): void {
    const sample = tick * SERVER_DT - clientMs / 1000;
    if (!this.ready) {
      this.offsetSec = sample;
      this.ready = true;
      return;
    }
    const err = sample - this.offsetSec;
    if (Math.abs(err) > ServerClock.RESYNC_SEC) this.offsetSec = sample;
    else this.offsetSec += err * ServerClock.SMOOTHING;
  }

  // Date.now() du serveur à la réception. Même lissage que le tick : la
  // latence moyenne est incluse (écart constant de quelques dizaines de ms
  // au plus), sans commune mesure avec un navigateur décalé de minutes.
  onServerTime(serverMs: number, clientMs: number): void {
    const sample = serverMs - clientMs;
    if (!this.epochReady) {
      this.epochOffsetMs = sample;
      this.epochReady = true;
      return;
    }
    const err = sample - this.epochOffsetMs;
    if (Math.abs(err) > ServerClock.RESYNC_SEC * 1000) this.epochOffsetMs = sample;
    else this.epochOffsetMs += err * ServerClock.SMOOTHING;
  }

  get isReady(): boolean {
    return this.ready;
  }

  get isEpochReady(): boolean {
    return this.epochReady;
  }

  // Date.now() du serveur correspondant à un instant client
  // (performance.now(), en ms).
  epochAt(clientMs: number): number {
    return clientMs + this.epochOffsetMs;
  }

  // Tick serveur (fractionnaire) correspondant à un instant client
  // (performance.now(), en ms).
  tickAt(clientMs: number): number {
    return (clientMs / 1000 + this.offsetSec) / SERVER_DT;
  }

  reset(): void {
    this.ready = false;
    this.offsetSec = 0;
    this.epochReady = false;
    this.epochOffsetMs = 0;
  }
}
