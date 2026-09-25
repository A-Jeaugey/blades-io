import * as THREE from "three";
import { DEBUG_HITBOX_COLOR } from "../themes/Theme";

// Trame envoyée chaque tick par le serveur en mode debug
// (cf. ArenaRoom.sendDebugOrbits) : positions des propriétaires et des
// lames en orbite telles que les collisions les ont vues.
export interface DebugOrbitFrame {
  tick: number;
  owners: Record<string, [number, number]>;
  // [id, ownerId, x, y, hitbox, anneau, slot, lames dans l'anneau]
  blades: Array<[string, string, number, number, number, number, number, number]>;
}

// Écart angulaire (rad) entre l'angle que ce client calcule pour une lame
// d'un joueur distant à un tick donné et celui du serveur au même tick.
export interface DebugOrbitStats {
  maxErr: number;
  meanErr: number;
  samples: number;
  // Distance (u) entre l'étincelle d'un clash et le milieu des deux lames
  // telles que dessinées à la frame où l'étincelle apparaît.
  clashMaxDist: number;
  clashMeanDist: number;
  clashes: number;
  // Même mesure si l'étincelle était jouée dès réception (comportement
  // d'avant la ligne de temps), pour comparaison.
  clashMeanDistIfImmediate: number;
}

const MAX_RINGS = 400;

// Mode debug hitbox (?debug=hitbox) : cercles aux positions serveur des
// lames en orbite (trame la plus proche du tick de rendu) et mesure de
// l'écart avec le calcul du client. Outil de vérification de la tâche 1.1 :
// ce que le joueur voit doit être ce que le serveur calcule.
export class DebugHitboxes {
  readonly stats: DebugOrbitStats = {
    maxErr: 0, meanErr: 0, samples: 0, clashMaxDist: 0, clashMeanDist: 0, clashes: 0, clashMeanDistIfImmediate: 0,
  };
  private clashDists: number[] = [];
  private immediateDists: number[] = [];
  private frames: DebugOrbitFrame[] = [];
  private measuredTick = -1;
  private errors: number[] = [];
  private rings: THREE.LineLoop[] = [];
  private group = new THREE.Group();
  private label: HTMLDivElement;

  constructor(scene: THREE.Scene) {
    const pts: number[] = [];
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      pts.push(Math.cos(a), 0, Math.sin(a));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const material = new THREE.LineBasicMaterial({ color: DEBUG_HITBOX_COLOR, depthTest: false, transparent: true });
    for (let i = 0; i < MAX_RINGS; i++) {
      const ring = new THREE.LineLoop(geometry, material);
      ring.visible = false;
      ring.frustumCulled = false;
      ring.renderOrder = 999;
      this.rings.push(ring);
      this.group.add(ring);
    }
    scene.add(this.group);
    this.label = document.createElement("div");
    this.label.className = "debug-hitbox-label";
    document.body.appendChild(this.label);
  }

  get frameCount(): number {
    return this.frames.length;
  }

  get lastFrameTick(): number {
    return this.frames.length > 0 ? this.frames[this.frames.length - 1].tick : -1;
  }

  resetStats(): void {
    this.errors.length = 0;
    this.clashDists.length = 0;
    this.stats.maxErr = 0;
    this.stats.meanErr = 0;
    this.stats.samples = 0;
    this.stats.clashMaxDist = 0;
    this.stats.clashMeanDist = 0;
    this.stats.clashes = 0;
  }

  recordImmediateClash(dist: number): void {
    this.immediateDists.push(dist);
    if (this.immediateDists.length > 500) this.immediateDists.shift();
    this.stats.clashMeanDistIfImmediate = this.immediateDists.reduce((a, b) => a + b, 0) / this.immediateDists.length;
  }

  recordClash(dist: number): void {
    this.clashDists.push(dist);
    if (this.clashDists.length > 500) this.clashDists.shift();
    let sum = 0;
    let max = 0;
    for (const d of this.clashDists) {
      sum += d;
      if (d > max) max = d;
    }
    this.stats.clashMaxDist = max;
    this.stats.clashMeanDist = sum / this.clashDists.length;
    this.stats.clashes = this.clashDists.length;
  }

  push(frame: DebugOrbitFrame): void {
    this.frames.push(frame);
    if (this.frames.length > 120) this.frames.splice(0, this.frames.length - 120);
  }

  // angleOf : angle que ce client calcule pour une lame d'un joueur à un
  // tick donné, avec l'anneau et le slot utilisés par le serveur (null si le
  // joueur lui est inconnu) : la mesure porte sur la phase d'orbite, pas sur
  // les 80 ms de décalage d'un changement de composition. Une trame n'est
  // mesurée qu'une fois le tick de rendu atteint : l'état synchronisé du
  // même tick est arrivé entre-temps (le message debug peut précéder le
  // patch d'état).
  update(
    renderTick: number,
    localId: string,
    angleOf: (ownerId: string, ring: number, slot: number, inRing: number, tick: number) => number | null,
  ): void {
    for (const f of this.frames) {
      if (f.tick <= this.measuredTick || f.tick > renderTick) continue;
      this.measuredTick = f.tick;
      for (const [, ownerId, x, y, , ring, slot, inRing] of f.blades) {
        if (ownerId === localId) continue;
        const owner = f.owners[ownerId];
        const mine = angleOf(ownerId, ring, slot, inRing, f.tick);
        if (!owner || mine === null) continue;
        let d = (mine - Math.atan2(y - owner[1], x - owner[0])) % (Math.PI * 2);
        if (d > Math.PI) d -= Math.PI * 2;
        if (d < -Math.PI) d += Math.PI * 2;
        this.errors.push(Math.abs(d));
      }
    }
    if (this.errors.length > 3000) this.errors.splice(0, this.errors.length - 3000);
    if (this.errors.length > 0) {
      let sum = 0;
      let max = 0;
      for (const e of this.errors) {
        sum += e;
        if (e > max) max = e;
      }
      this.stats.maxErr = max;
      this.stats.meanErr = sum / this.errors.length;
      this.stats.samples = this.errors.length;
    }

    // Cercles : trame la plus proche du tick de rendu.
    let best: DebugOrbitFrame | null = null;
    for (const f of this.frames) {
      if (!best || Math.abs(f.tick - renderTick) < Math.abs(best.tick - renderTick)) best = f;
    }
    const blades = best?.blades ?? [];
    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i];
      const b = blades[i];
      if (!b) {
        ring.visible = false;
        continue;
      }
      ring.visible = true;
      ring.position.set(b[2], 0.95, b[3]);
      ring.scale.setScalar(b[4]);
    }

    this.label.textContent =
      `hitbox debug · tick ${renderTick.toFixed(1)} · écart orbites distantes : ` +
      `max ${this.stats.maxErr.toFixed(4)} rad, moy ${this.stats.meanErr.toFixed(4)} rad (${this.stats.samples})` +
      ` · étincelle/lames : moy ${this.stats.clashMeanDist.toFixed(2)} u, max ${this.stats.clashMaxDist.toFixed(2)} u (${this.stats.clashes})`;
  }
}
