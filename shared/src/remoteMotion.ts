import {
  INPUT_TICK_RESYNC,
  INPUT_TICK_SMOOTHING,
  PLAYER_BODY_RADIUS,
  REMOTE_CORRECTION_TAU,
  REMOTE_EXTRAPOLATION_MAX_TICKS,
  REMOTE_TELEPORT_DIST,
  SERVER_DT,
} from "./constants";
import { resolveDecorCollision } from "./decor";

// Un seul instant à l'écran : celui du joueur local. Il se voit prédit, en
// avance sur le serveur d'un aller-retour (InputPredictor) ; les autres
// étaient dessinés au dernier état reçu, donc en retard d'un aller simple et
// d'un patch. L'écart entre deux joueurs différait ainsi d'un écran à
// l'autre de vitesse × (ping + ~40 ms) : 5,3 u à 100 ms de ping au boost
// (tools/bench-netcode.js, qui s'en sert comme le client).

// Tick serveur auquel s'appliqueront les inputs du joueur local : chaque
// input envoyé vaut un pas, appliqué un tick après le précédent. Quand un
// acquittement avance (Player.lastSeq), l'input acquitté vient d'être
// appliqué au tick du patch : écart tick − seq, lissé. L'input n est alors
// appliqué au tick n + écart, coupures comprises (sans acquittement, l'écart
// reste celui d'avant).
export class InputTickClock {
  private offset = 0;
  private ready = false;
  private lastAck = -1;

  get isReady(): boolean {
    return this.ready;
  }

  onAck(seq: number, patchTick: number): void {
    if (seq === this.lastAck) return;
    this.lastAck = seq;
    // Rien d'appliqué encore (premier état, réapparition) : pas de mesure.
    if (seq === 0) return;
    const sample = patchTick - seq;
    if (!this.ready) {
      this.offset = sample;
      this.ready = true;
      return;
    }
    const err = sample - this.offset;
    if (Math.abs(err) > INPUT_TICK_RESYNC) this.offset = sample;
    else this.offset += err * INPUT_TICK_SMOOTHING;
  }

  // Tick (fractionnaire) de l'input seq.
  tickOf(seq: number): number {
    return seq + this.offset;
  }

  reset(): void {
    this.ready = false;
    this.offset = 0;
    this.lastAck = -1;
  }
}

// Joueur distant : dernier état reçu (tick, position, vitesse du dernier
// pas), extrapolé jusqu'au tick dessiné. Quand un nouvel état contredit
// l'estimation (virage, arrêt, recul), l'écart est absorbé en
// REMOTE_CORRECTION_TAU au lieu de faire sauter le joueur.
export class RemoteMotion {
  renderX: number;
  renderY: number;
  private tick = -1;
  private x: number;
  private y: number;
  private vx = 0;
  private vy = 0;
  private errX = 0;
  private errY = 0;
  // Tick dessiné à la dernière frame : l'écart d'un nouvel état se mesure là.
  private shownAt: number | null = null;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.renderX = x;
    this.renderY = y;
  }

  // État reçu au tick d'un patch.
  push(tick: number, x: number, y: number, vx: number, vy: number): void {
    if (tick < this.tick) return;
    const at = this.shownAt;
    let beforeX = 0;
    let beforeY = 0;
    if (at !== null) {
      beforeX = this.rawX(at);
      beforeY = this.rawY(at);
    }
    this.tick = tick;
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    if (at === null) return;
    const dx = beforeX - this.rawX(at);
    const dy = beforeY - this.rawY(at);
    if (Math.hypot(dx + this.errX, dy + this.errY) > REMOTE_TELEPORT_DIST) {
      this.errX = 0;
      this.errY = 0;
    } else {
      this.errX += dx;
      this.errY += dy;
    }
  }

  // Position au tick dessiné (fractionnaire), après dt secondes de frame.
  // Hors du décor : la vitesse est celle du dernier pas, l'extrapolation ne
  // sait pas qu'un pilier l'arrêtera.
  update(shownTick: number, dt: number): void {
    const decay = Math.exp(-dt / REMOTE_CORRECTION_TAU);
    this.errX *= decay;
    this.errY *= decay;
    if (Math.abs(this.errX) < 1e-3) this.errX = 0;
    if (Math.abs(this.errY) < 1e-3) this.errY = 0;
    this.shownAt = shownTick;
    let x = this.rawX(shownTick);
    let y = this.rawY(shownTick);
    if (x !== this.x || y !== this.y) {
      const p = resolveDecorCollision(x, y, PLAYER_BODY_RADIUS);
      x = p.x;
      y = p.y;
    }
    this.renderX = x + this.errX;
    this.renderY = y + this.errY;
  }

  private horizon(at: number): number {
    if (this.tick < 0) return 0;
    const h = at - this.tick;
    return (h < 0 ? 0 : h > REMOTE_EXTRAPOLATION_MAX_TICKS ? REMOTE_EXTRAPOLATION_MAX_TICKS : h) * SERVER_DT;
  }

  private rawX(at: number): number {
    return this.x + this.vx * this.horizon(at);
  }

  private rawY(at: number): number {
    return this.y + this.vy * this.horizon(at);
  }
}
