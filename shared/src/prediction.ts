import type { GameMap } from "./maps";
import { SERVER_DT } from "./constants";
import { moveContextAt, type MoverState, type WellField } from "./agents";
import { MoveBody, MoveInput, stepMovement } from "./movement";

// État du joueur local tel que le serveur l'a acquitté, lu dans un patch.
export interface AckState extends MoverState {
  // Dernier input appliqué par le serveur (Player.lastSeq).
  seq: number;
  x: number;
  y: number;
  knockbackVx: number;
  knockbackVy: number;
  // Date.now() du serveur au tick de ce patch (ArenaState.serverTime).
  serverTime: number;
}

interface PendingInput extends MoveInput {
  seq: number;
}

// Au-delà (2 s d'inputs sans acquittement), les plus anciens sont oubliés :
// le serveur n'en garde pas autant non plus.
const MAX_PENDING = 120;
const STEP_MS = SERVER_DT * 1000;
const NO_WELLS: readonly WellField[] = [];

// Prédiction du joueur local avec rejeu d'inputs (tâche 1.2). Chaque input
// envoyé avance la position prédite d'un pas ; à chaque état reçu du
// serveur, on repart de la position acquittée et on rejoue les inputs qu'il
// n'a pas encore appliqués, avec le même pas que lui (stepMovement). Sans
// évènement que le client ne peut pas prévoir (recul d'un clash, poussée
// d'un autre joueur), la correction est nulle, quelle que soit la latence.
// Avant, le client recalait sa position sur celle du serveur, en retard
// d'un aller-retour, et lissait l'écart : effet élastique à chaque
// changement de direction.
//
// Agents (agents.ts) : l'impulsion d'un Éclair voyage avec son input (posée
// au même pas que le serveur) ; ralentissement, Bastion, Surtension et
// attraction des puits viennent de l'état acquitté et des zones reçues, via
// moveContextAt, le même contexte que celui du serveur.
export class InputPredictor {
  // Position prédite après le dernier input, et celle d'avant (le rendu
  // interpole entre les deux).
  readonly body: MoveBody = { x: 0, y: 0, knockbackVx: 0, knockbackVy: 0 };
  prevX = 0;
  prevY = 0;
  private pending: PendingInput[] = [];
  private ack: AckState | null = null;
  // Carte à murs de la partie (mapForMode), la même que celle du serveur :
  // sans elle, chaque pas le long d'un mur serait à corriger.
  map: GameMap | null = null;
  // Joueur local (puits de son équipe ignorés) et puits visibles, tenus à
  // jour par le client à partir de l'état reçu.
  selfId = "";
  team = 0;
  wells: readonly WellField[] = NO_WELLS;

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
    const kept: PendingInput = { seq, dx: input.dx, dy: input.dy, boost: input.boost };
    if (input.impulseX !== undefined || input.impulseY !== undefined) {
      kept.impulseX = input.impulseX ?? 0;
      kept.impulseY = input.impulseY ?? 0;
    }
    this.pending.push(kept);
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    if (!this.ack) return;
    this.prevX = this.body.x;
    this.prevY = this.body.y;
    this.step(kept, this.ack.serverTime + this.pending.length * STEP_MS);
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
    stepMovement(this.body, input, moveContextAt(this.ack!, this.selfId, this.team, serverTimeMs, this.map, this.wells), SERVER_DT);
  }
}
