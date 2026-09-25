import { BORDER_DANGER_COLOR } from "../themes/Theme";

// Distance (u) entre l'orbite extérieure du joueur et la zone mortelle à
// partir de laquelle l'alerte démarre. À la vitesse de boost (~19 u/s), il
// reste plus d'une seconde pour réagir.
export const BORDER_WARNING_DISTANCE = 25;

// Vignette rouge plein écran à l'approche de la bordure. En DOM plutôt
// qu'en post-FX : elle doit s'afficher dans toutes les qualités, y compris
// quand les post-FX sont coupés (ultra, ou baisse automatique en partie).
export class BorderWarning {
  private el: HTMLElement;
  private rgb: string;
  private shown = 0;
  private lastOpacity = "";
  private lastBackground = "";

  constructor() {
    this.el = document.getElementById("border-warning") as HTMLElement;
    const c = BORDER_DANGER_COLOR;
    this.rgb = `${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}`;
  }

  // intensity : 0 (loin) → 1 (au contact). dirX/dirY : direction écran
  // (unitaire) du mur le plus proche ; le rouge s'épaissit de ce côté.
  update(intensity: number, dirX: number, dirY: number, t: number, dt: number): void {
    // Montée rapide, retombée plus douce.
    const rate = intensity > this.shown ? 12 : 4;
    this.shown += (intensity - this.shown) * Math.min(1, rate * dt);
    if (this.shown < 0.01) {
      this.shown = 0;
      this.setOpacity("0");
      return;
    }
    // Pulsation qui accélère à l'approche.
    const pulse = 0.5 + 0.5 * Math.sin(t * (4 + 10 * this.shown));
    this.setOpacity(Math.min(1, this.shown * (0.6 + 0.4 * pulse)).toFixed(2));
    const cx = (50 - dirX * 22).toFixed(0);
    const cy = (50 - dirY * 22).toFixed(0);
    const bg = `radial-gradient(circle at ${cx}% ${cy}%, rgba(${this.rgb}, 0) 38%, rgba(${this.rgb}, 0.5) 78%, rgba(${this.rgb}, 0.85) 100%)`;
    if (bg !== this.lastBackground) {
      this.el.style.background = bg;
      this.lastBackground = bg;
    }
  }

  hide(): void {
    this.shown = 0;
    this.setOpacity("0");
  }

  private setOpacity(v: string): void {
    if (v === this.lastOpacity) return;
    this.el.style.opacity = v;
    this.lastOpacity = v;
  }
}
