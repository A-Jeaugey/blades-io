export class Mouse {
  public used = false;
  private x = 0;
  private y = 0;
  private down = false;
  // Edge-trigger pour le throw : appuyé une fois → true pendant 1 frame.
  private throwPending = false;

  constructor(canvas: HTMLElement) {
    canvas.addEventListener("mousemove", (e) => {
      this.used = true;
      this.x = e.clientX;
      this.y = e.clientY;
    });
    canvas.addEventListener("mousedown", (e) => {
      // Bouton 0 = clic gauche → boost, bouton 2 = clic droit → throw.
      if (e.button === 2) {
        this.throwPending = true;
        return;
      }
      this.down = true;
    });
    canvas.addEventListener("mouseup", (e) => {
      if (e.button === 2) return;
      this.down = false;
    });
    canvas.addEventListener("mouseleave", () => (this.down = false));
    // Bloque le menu contextuel pour que le clic droit serve au throw sans
    // ouvrir le menu navigateur. Un user qui veut le menu garde Ctrl+clic.
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  consumeThrow(): boolean {
    if (!this.throwPending) return false;
    this.throwPending = false;
    return true;
  }

  // Direction normalisée du centre écran vers le curseur
  getDir(): { x: number; y: number } {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const dx = this.x - cx;
    const dy = this.y - cy;
    const m = Math.hypot(dx, dy);
    if (m < 40) return { x: 0, y: 0 };
    return { x: dx / m, y: dy / m };
  }

  get boost(): boolean {
    return this.down;
  }
}
