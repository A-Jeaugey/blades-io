// Helper partagé : détecte si l'élément focused est un champ texte. Quand
// c'est le cas, le handler keyboard global doit s'effacer pour ne pas
// manger les frappes (Space, flèches…) avec preventDefault. Dupliqué
// volontairement de InputManager pour éviter une dépendance circulaire.
function isTypingInTextField(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  return (el as HTMLElement).isContentEditable === true;
}

export class Keyboard {
  private keys = new Set<string>();
  public used = false;
  // Edge-trigger pour le throw : true pendant 1 tick d'input puis remis à
  // false par consumeThrow(). Garantit qu'un appui maintenu = 1 seul throw,
  // conformément au spec ("Appui unique, pas de maintien/répétition").
  private throwPending = false;

  constructor() {
    window.addEventListener("keydown", (e) => {
      // Quand l'user tape dans un input texte (chat, rename, code rejoint…),
      // on ne touche pas aux events. Avant : preventDefault sur Space coupait
      // les espaces dans le chat ; les flèches déplaçaient le caret du
      // joueur au lieu du caret texte. Garde tout ce qui est gameplay
      // (throw pending, dir, etc.) intact pour le moment où l'input
      // perdra le focus.
      if (isTypingInTextField()) return;

      this.used = true;
      // Edge-trigger : on capture l'appui Space/F UNIQUEMENT lors du
      // premier événement keydown (e.repeat = false), sinon le maintien
      // génère des events à 30 Hz.
      if (e.code === "Space" && !e.repeat) this.throwPending = true;
      this.keys.add(e.code);
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => {
      // Symétrie avec keydown : si on lâche une touche pendant qu'un input
      // a le focus, on la retire quand même de notre Set pour éviter des
      // touches "fantômes" coincées en pressed après défocus.
      this.keys.delete(e.code);
    });
    window.addEventListener("blur", () => this.keys.clear());
  }

  // Consomme l'edge-trigger : renvoie true UNE fois après chaque appui,
  // puis false jusqu'au prochain appui. À appeler depuis InputManager.
  consumeThrow(): boolean {
    if (!this.throwPending) return false;
    this.throwPending = false;
    return true;
  }

  get dir(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) x -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) x += 1;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) y -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) y += 1;
    const m = Math.hypot(x, y);
    if (m > 0) {
      x /= m;
      y /= m;
    }
    return { x, y };
  }

  get boost(): boolean {
    return this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
  }
}
