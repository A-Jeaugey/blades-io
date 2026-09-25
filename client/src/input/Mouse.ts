export class Mouse {
  public used = false;
  // Dernière position du curseur, en pixels client. Suivie sur toute la
  // fenêtre : au-dessus d'un élément du HUD, le canvas ne reçoit plus les
  // mousemove et la direction restait figée sur l'ancienne position.
  public x = 0;
  public y = 0;
  private down = false;
  // Edge-trigger pour le throw : appuyé une fois → true pendant 1 frame.
  private throwPending = false;

  constructor(canvas: HTMLElement) {
    window.addEventListener("mousemove", (e) => {
      this.used = true;
      this.x = e.clientX;
      this.y = e.clientY;
    }, { passive: true });
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

  get boost(): boolean {
    return this.down;
  }
}
