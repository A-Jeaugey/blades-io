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

// Touches qui font passer en déplacement clavier. Espace (lancer) n'en fait
// pas partie : un joueur souris qui lance avec Espace doit continuer à
// suivre son curseur.
const MOVE_KEYS = [
  "KeyW", "KeyA", "KeyS", "KeyD",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "ShiftLeft", "ShiftRight",
];

// Mode de départ, avant toute interaction. Les téléphones se reconnaissent
// à l'user agent ; un iPad se présente comme un Mac mais n'a qu'un pointeur
// grossier. Un PC à écran tactile a un pointeur principal fin (souris ou
// pavé tactile) : il démarre en mode desktop.
function initialTouchMode(): boolean {
  if (/android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent)) return true;
  const mm = window.matchMedia?.bind(window);
  if (!mm) return false;
  return mm("(pointer: coarse)").matches && !mm("(any-pointer: fine)").matches;
}

export class InputManager {
  keyboard: Keyboard;
  mouse: Mouse;
  touch: TouchJoystick;
  // Le mode suit le DERNIER périphérique utilisé. Avant, il était figé au
  // boot sur « l'écran est-il tactile ? » : sur un PC à écran tactile, le
  // clavier et la souris étaient alors ignorés pendant toute la session.
  private touchMode: boolean;
  private modeListeners: Array<(touch: boolean) => void> = [];
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
    this.touchMode = initialTouchMode();

    // Clavier → mode clavier, et sortie du mode tactile pour toute touche
    // de jeu (lancer compris).
    window.addEventListener("keydown", (e) => {
      if (this.isTypingInTextField()) return;
      const move = MOVE_KEYS.includes(e.code);
      if (move) this.desktopMode = "keyboard";
      if (move || e.code === "Space") this.setTouchMode(false);
    });
    // pointerType distingue un vrai doigt d'une vraie souris, là où les
    // évènements souris sont aussi émis (par compatibilité) après un tap.
    window.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch") this.setTouchMode(true);
      else if (e.pointerType === "mouse") this.setTouchMode(false);
    }, { capture: true, passive: true });
    window.addEventListener("pointermove", (e) => {
      if (e.pointerType === "mouse" && (e.movementX !== 0 || e.movementY !== 0)) this.setTouchMode(false);
    }, { passive: true });
    // Clic souris → repasse en mode souris
    gameCanvas.addEventListener("mousedown", () => {
      this.desktopMode = "mouse";
    });
  }

  get isTouch(): boolean {
    return this.touchMode;
  }

  // Appelé immédiatement avec le mode courant, puis à chaque bascule.
  onModeChange(cb: (touch: boolean) => void): void {
    this.modeListeners.push(cb);
    cb(this.touchMode);
  }

  private setTouchMode(touch: boolean): void {
    if (this.touchMode === touch) return;
    this.touchMode = touch;
    for (const cb of this.modeListeners) cb(touch);
  }

  // Quand un champ texte (chat, rename, code rejoint…) est focused, on
  // ignore les inputs gameplay. Sinon les frappes ZQSD/WASD/space pendant
  // qu'on tape se propagent au mouvement → le perso part dans tous les
  // sens et écrit dans le chat en même temps. document.activeElement
  // est suffisant (pas besoin d'injecter un callback ChatPanel).
  private isTypingInTextField(): boolean {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return true;
    return (el as HTMLElement).isContentEditable === true;
  }

  getInput(): FrameInput {
    if (this.isTypingInTextField()) {
      return { dx: 0, dy: 0, boost: false, throwPressed: false };
    }
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
    if (this.isTypingInTextField()) {
      return { dx: 0, dy: 0, boost: false };
    }
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
