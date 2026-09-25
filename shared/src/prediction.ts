import { SERVER_DT } from "./constants";
import { MoveBody, MoveInput, stepMovement } from "./movement";

// État du joueur local tel que le serveur l'a acquitté, lu dans un patch.
export interface AckState {
  // Dernier input appliqué par le serveur (Player.lastSeq).
  seq: number;
  x: number;
  y: number;
  knockbackVx: number;
  knockbackVy: number;
  // Date.now() du serveur au tick de ce patch (ArenaState.serverTime).
  serverTime: number;
  speedUntil: number;
  hitlagUntil: number;
  bladeCount: number;
}

interface PendingInput extends MoveInput {
  seq: number;
}

// Au-delà (2 s d'inputs sans acquittement), les plus anciens sont oubliés :
// le serveur n'en garde pas autant non plus.
const MAX_PENDING = 120;
const STEP_MS = SERVER_DT * 1000;

// Prédiction du joueur local avec rejeu d'inputs (tâche 1.2). Chaque input
// envoyé avance la position prédite d'un pas ; à chaque état reçu du
// serveur, on repart de la position acquittée et on rejoue les inputs qu'il
// n'a pas encore appliqués, avec le même pas que lui (stepMovement). Sans
// évènement que le client ne peut pas prévoir (recul d'un clash, poussée
// d'un autre joueur), la correction est nulle, quelle que soit la latence.
// Avant, le client recalait sa position sur celle du serveur, en retard
// d'un aller-retour, et lissait l'écart : effet élastique à chaque
// changement de direction.
export class InputPredictor {
  // Position prédite après le dernier input, et celle d'avant (le rendu
  // interpole entre les deux).
  readonly body: MoveBody = { x: 0, y: 0, knockbackVx: 0, knockbackVy: 0 };
  prevX = 0;
  prevY = 0;
  private pending: PendingInput[] = [];
  private ack: AckState | null = null;

  get ready(): boolean {
    return this.ack !== null;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  reset(): void {
    this.pending.length = 0;
    this.ack = null;
  }

  // Input envoyé au serveur : un pas de prédiction. Le serveur l'appliquera
  // environ un tick après le précédent : c'est l'heure utilisée pour Speed
  // et le hitlag. Avant le premier état reçu, l'input est seulement gardé :
  // le serveur l'appliquera, il faudra le rejouer.
  push(seq: number, input: MoveInput): void {
    this.pending.push({ seq, dx: input.dx, dy: input.dy, boost: input.boost });
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    if (!this.ack) return;
    this.prevX = this.body.x;
    this.prevY = this.body.y;
    this.step(input, this.ack.serverTime + this.pending.length * STEP_MS);
  }

  // État serveur reçu : repart de la position acquittée et rejoue les
  // inputs suivants. Renvoie la correction de la position prédite (u) ; le
  // segment d'interpolation est décalé d'autant.
  reconcile(ack: AckState): { dx: number; dy: number } {
    const first = !this.ack;
    const beforeX = this.body.x;
    const beforeY = this.body.y;
    this.ack = { ...ack };
    let acked = 0;
    while (acked < this.pending.length && this.pending[acked].seq <= ack.seq) acked++;
    if (acked > 0) this.pending.splice(0, acked);
    this.body.x = ack.x;
    this.body.y = ack.y;
    this.body.knockbackVx = ack.knockbackVx;
    this.body.knockbackVy = ack.knockbackVy;
    for (let k = 0; k < this.pending.length; k++) {
      this.step(this.pending[k], ack.serverTime + (k + 1) * STEP_MS);
    }
    if (first) {
      this.prevX = this.body.x;
      this.prevY = this.body.y;
      return { dx: 0, dy: 0 };
    }
    const dx = this.body.x - beforeX;
    const dy = this.body.y - beforeY;
    this.prevX += dx;
    this.prevY += dy;
    return { dx, dy };
  }

  private step(input: MoveInput, serverTimeMs: number): void {
    const ack = this.ack!;
    stepMovement(this.body, input, {
      speed: ack.speedUntil > serverTimeMs,
      frozen: ack.hitlagUntil > serverTimeMs,
      canBoost: ack.bladeCount > 0,
    }, SERVER_DT);
  }
}
