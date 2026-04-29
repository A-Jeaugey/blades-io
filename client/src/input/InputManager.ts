import { Keyboard } from "./Keyboard";
import { Mouse } from "./Mouse";
import { TouchJoystick } from "./TouchJoystick";

export type InputMode = "keyboard" | "mouse" | "touch";

export interface FrameInput {
  dx: number;
  dy: number;
  boost: boolean;
  // Edge-triggered : true UNE seule fois pour un appui (Espace, clic droit
  // ou bouton THROW mobile). Consommé immédiatement par le caller.
  throwPressed: boolean;
}

export class InputManager {
  keyboard: Keyboard;
  mouse: Mouse;
  touch: TouchJoystick;
  public isTouch: boolean;
  // Mode sticky desktop : dès qu'on touche le clavier, on ignore la souris
  // jusqu'à ce qu'on re-clique. Et inversement.
  private desktopMode: "keyboard" | "mouse" = "mouse";

  constructor(
    gameCanvas: HTMLElement,
    joyContainer: HTMLElement,
    joyBase: HTMLElement,
    joyThumb: HTMLElement,
    boostBtn: HTMLElement,
    throwBtn: HTMLElement | null = null,
  ) {
    this.keyboard = new Keyboard();
    this.mouse = new Mouse(gameCanvas);
    this.touch = new TouchJoystick(joyContainer, joyBase, joyThumb, boostBtn, throwBtn);
    this.isTouch =
      "ontouchstart" in window ||
      (navigator.maxTouchPoints ?? 0) > 0 ||
      /android|iphone|ipad|mobile/i.test(navigator.userAgent);

    // Clavier → mode clavier
    window.addEventListener("keydown", (e) => {
      if (
        [
          "KeyW",
          "KeyA",
          "KeyS",
          "KeyD",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "ShiftLeft",
          "ShiftRight",
        ].includes(e.code)
      ) {
        this.desktopMode = "keyboard";
      }
    });
    // Clic souris → repasse en mode souris
    gameCanvas.addEventListener("mousedown", () => {
      this.desktopMode = "mouse";
    });
  }

  getInput(): FrameInput {
    // Le throw est universel : Espace clavier, clic droit souris, ou bouton
    // THROW touch. On combine les 3 sources pour qu'aucun appui ne soit
    // perdu selon le mode actif.
    const throwPressed =
      this.keyboard.consumeThrow() ||
      this.mouse.consumeThrow() ||
      this.touch.consumeThrow();
    if (this.isTouch) {
      const d = this.touch.getDir();
      return { dx: d.x, dy: d.y, boost: this.touch.boost, throwPressed };
    }
    if (this.desktopMode === "keyboard") {
      const kbd = this.keyboard.dir;
      return { dx: kbd.x, dy: kbd.y, boost: this.keyboard.boost, throwPressed };
    }
    // Mode souris : suit le curseur. Shift reste actif pour le boost.
    const md = this.mouse.getDir();
    return {
      dx: md.x,
      dy: md.y,
      boost: this.keyboard.boost || this.mouse.boost,
      throwPressed,
    };
  }

  // Variante non-consommante : ne touche pas au flag throw. Utilisée pour
  // la prédiction locale (qui tourne à 60 Hz, alors que sendInput tourne
  // à 30 Hz). Sans ça, l'appui Espace est consommé par la prédiction et
  // jamais transmis au serveur.
  peekDirBoost(): { dx: number; dy: number; boost: boolean } {
    if (this.isTouch) {
      const d = this.touch.getDir();
      return { dx: d.x, dy: d.y, boost: this.touch.boost };
    }
    if (this.desktopMode === "keyboard") {
      const kbd = this.keyboard.dir;
      return { dx: kbd.x, dy: kbd.y, boost: this.keyboard.boost };
    }
    const md = this.mouse.getDir();
    return { dx: md.x, dy: md.y, boost: this.keyboard.boost || this.mouse.boost };
  }

  setSensitivity(v: number): void {
    this.touch.sensitivity = v;
  }
}
