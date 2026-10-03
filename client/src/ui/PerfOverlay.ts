import * as THREE from "three";

// Mesure de fluidité en jeu (?debug=perf), pour diagnostiquer une machine
// à distance sur une capture d'écran : FPS et temps de frame (médiane, 95e
// centile, pire) des deux dernières secondes, échelle de rendu (résolution
// dynamique), mode allégé, draw calls par image, et shaders compilés depuis
// l'entrée en partie (doit rester à 0 : tout est compilé au lobby ; chacun
// est un à-coup, jusqu'à quelques centaines de ms sous Windows).
// Outil de développement, comme ?debug=hitbox : textes non traduits.

const WINDOW_MS = 2000;

export interface PerfState {
  preset: string;
  scale: number;
  lite: boolean;
}

export class PerfOverlay {
  private readonly el: HTMLDivElement;
  private readonly frames = new Float64Array(600);
  private head = 0;
  private count = 0;
  private last = 0;
  private nextUpdate = 0;
  private programsAtStart = -1;
  private readonly sorted: number[] = [];

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    // Une image = plusieurs rendus (scène, bloom, passe finale) : compteurs
    // remis à zéro par image, ici, et non à chaque rendu.
    renderer.info.autoReset = false;
    this.el = document.createElement("div");
    this.el.className = "debug-perf-label";
    document.body.appendChild(this.el);
  }

  // Entrée en partie : référence du nombre de shaders compilés.
  markGameStart(): void {
    this.programsAtStart = this.programCount();
  }

  // Après le rendu de chaque image.
  frame(now: number, state: PerfState): void {
    if (this.last > 0) {
      this.frames[this.head] = now - this.last;
      this.head = (this.head + 1) % this.frames.length;
      this.count = Math.min(this.count + 1, this.frames.length);
    }
    this.last = now;
    const calls = this.renderer.info.render.calls;
    this.renderer.info.reset();
    if (now < this.nextUpdate) return;
    this.nextUpdate = now + 500;

    const s = this.sorted;
    s.length = 0;
    let total = 0;
    for (let i = 1; i <= this.count && total < WINDOW_MS; i++) {
      const dt = this.frames[(this.head - i + this.frames.length) % this.frames.length];
      s.push(dt);
      total += dt;
    }
    if (s.length === 0) return;
    s.sort((a, b) => a - b);
    const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
    const programs = this.programCount();
    const inGame = this.programsAtStart >= 0 ? ` (+${programs - this.programsAtStart} en partie)` : "";
    this.el.textContent =
      `perf · ${state.preset}${state.lite ? " allégé" : ""} · ${Math.round((1000 * s.length) / total)} FPS` +
      ` · médiane ${at(0.5).toFixed(1)} ms · p95 ${at(0.95).toFixed(1)} ms · pire ${s[s.length - 1].toFixed(0)} ms` +
      ` · rendu ×${state.scale.toFixed(2)} · ${calls} draws · shaders ${programs}${inGame}`;
  }

  private programCount(): number {
    return this.renderer.info.programs?.length ?? 0;
  }
}
