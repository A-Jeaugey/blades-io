// Retours de combat en surimpression (tâche 1.5) : repère rouge au bord de
// l'écran du côté d'où vient la perte d'une lame, et « +1 » flottant au
// point d'une élimination. En DOM, comme la vignette de bordure : visibles
// à toutes les qualités, post-FX coupés compris.

const HIT_MS = 900;
const POP_MS = 900;
const MAX_HITS = 6;
const MAX_POPS = 4;
// Retrait des repères par rapport au bord de l'écran (px).
const EDGE_INSET = 34;
// Deux pertes à moins de ~20° d'écart ravivent le même repère.
const SAME_SIDE_RAD = 0.35;

interface HitMarker {
  el: HTMLDivElement;
  angle: number;
  until: number;
}

interface KillPop {
  el: HTMLDivElement;
  x: number;
  y: number;
  start: number;
}

function angleGap(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

export class CombatFeedback {
  private root: HTMLElement;
  private hits: HitMarker[] = [];
  private pops: KillPop[] = [];

  constructor() {
    this.root = document.getElementById("combat-feedback") as HTMLElement;
  }

  // angle : direction à l'écran (rad, y vers le bas) du joueur vers le
  // point où sa lame a cassé, donc vers l'attaque.
  bladeLost(angle: number, now: number): void {
    let marker = this.hits.find((h) => h.until > now && angleGap(h.angle, angle) < SAME_SIDE_RAD);
    if (!marker) marker = this.hits.find((h) => h.until <= now);
    if (!marker && this.hits.length < MAX_HITS) {
      const el = document.createElement("div");
      el.className = "hit-marker";
      this.root.appendChild(el);
      marker = { el, angle, until: 0 };
      this.hits.push(marker);
    }
    // Tous occupés : on recycle celui qui s'éteint le plus tôt.
    if (!marker) marker = this.hits.reduce((a, b) => (a.until < b.until ? a : b));
    marker.angle = angle;
    marker.until = now + HIT_MS;
  }

  // Élimination par le joueur local, au point de la mort (coordonnées sol).
  killPop(x: number, y: number, now: number): void {
    let pop = this.pops.find((p) => now - p.start >= POP_MS);
    if (!pop && this.pops.length < MAX_POPS) {
      const el = document.createElement("div");
      el.className = "kill-pop";
      el.textContent = "+1";
      this.root.appendChild(el);
      pop = { el, x, y, start: 0 };
      this.pops.push(pop);
    }
    if (!pop) pop = this.pops.reduce((a, b) => (a.start < b.start ? a : b));
    pop.x = x;
    pop.y = y;
    pop.start = now;
  }

  // screenOf : projection d'un point du sol à l'écran (px client) ; le
  // « +1 » reste accroché au point de l'élimination quand la caméra suit
  // le joueur.
  update(now: number, screenOf: (x: number, y: number) => { x: number; y: number }): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const rx = w / 2 - EDGE_INSET;
    const ry = h / 2 - EDGE_INSET;
    for (const m of this.hits) {
      const left = m.until - now;
      if (left <= 0) {
        if (m.el.style.opacity !== "0") m.el.style.opacity = "0";
        continue;
      }
      // Sur l'ellipse inscrite dans l'écran, convexité vers l'extérieur.
      const cx = w / 2 + Math.cos(m.angle) * rx;
      const cy = h / 2 + Math.sin(m.angle) * ry;
      m.el.style.opacity = Math.min(1, left / (HIT_MS * 0.5)).toFixed(2);
      m.el.style.transform = `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px) translate(-50%, -50%) rotate(${(m.angle + Math.PI / 2).toFixed(3)}rad)`;
    }
    for (const p of this.pops) {
      const t = (now - p.start) / POP_MS;
      if (t >= 1) {
        if (p.el.style.opacity !== "0") p.el.style.opacity = "0";
        continue;
      }
      const s = screenOf(p.x, p.y);
      const rise = 36 + t * 48;
      const scale = 1 + 0.4 * (1 - t) ** 3;
      p.el.style.opacity = (1 - t * t).toFixed(2);
      p.el.style.transform = `translate(${s.x.toFixed(1)}px, ${(s.y - rise).toFixed(1)}px) translate(-50%, -50%) scale(${scale.toFixed(3)})`;
    }
  }

  clear(): void {
    for (const m of this.hits) {
      m.until = 0;
      m.el.style.opacity = "0";
    }
    for (const p of this.pops) {
      p.start = -POP_MS;
      p.el.style.opacity = "0";
    }
  }
}
