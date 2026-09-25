import { SERVER_DT } from "@bladeio/shared";

// Estimation du tick serveur à partir de state.tick, reçu à chaque patch.
//
// Le décalage (temps du tick − instant de réception) est lissé : la gigue
// de réception ne doit pas faire trembler la rotation des orbites. Il inclut
// la latence moyenne, ce qui est voulu : un tick estimé ainsi correspond à
// l'état que le client affiche, et tickAt(maintenant − RENDER_DELAY) tombe
// au même instant que la position interpolée des joueurs distants.
export class ServerClock {
  private offsetSec = 0;
  private ready = false;

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

  get isReady(): boolean {
    return this.ready;
  }

  // Tick serveur (fractionnaire) correspondant à un instant client
  // (performance.now(), en ms).
  tickAt(clientMs: number): number {
    return (clientMs / 1000 + this.offsetSec) / SERVER_DT;
  }

  reset(): void {
    this.ready = false;
    this.offsetSec = 0;
  }
}
