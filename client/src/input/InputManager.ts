import { Keyboard } from "./Keyboard";
import { Mouse } from "./Mouse";
import { TouchJoystick } from "./TouchJoystick";

export type InputMode = "keyboard" | "mouse" | "touch";

export interface FrameInput {
  dx: number;
  dy: number;
  boost: boolean;
  // Edge-triggered : true UNE seule fois pour un appui (Espace, clic droit
  // ou bouton THROW mobile relâché). Consommé immédiatement par le caller.
  throwPressed: boolean;
  // Visée du lancer au sol, normalisée ; (0, 0) : le lancer suit la
  // direction de déplacement.
  aimX: number;
  aimY: number;
}

// Projection écran ↔ sol fournie par le jeu (caméra et joueur local).
export interface GroundProjector {
  // Point du sol sous un point de l'écran (px client), null hors du sol.
  groundAt(clientX: number, clientY: number): { x: number; y: number } | null;
  // Position à l'écran (px client) d'un point du sol.
  screenOf(x: number, y: number): { x: number; y: number };
  // Position au sol du joueur local telle que dessinée, null hors partie.
  player(): { x: number; y: number } | null;
}

// Zone morte autour du joueur, mesurée à l'écran : curseur posé sur le
// personnage, il s'arrête.
const MOUSE_DEAD_ZONE_PX = 40;
// Distance à l'écran du point projeté pour convertir un glisser en
// direction au sol : assez loin pour la précision, assez près pour rester
// sous l'horizon.
const DRAG_PROBE_PX = 120;

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
  // Au clavier, le curseur ne vise que si la souris a bougé depuis le
  // passage en mode clavier : un joueur tout clavier garde la visée dans le
  // sens de marche, un joueur clavier + souris vise au curseur.
  private mouseAims = false;
  private projector: GroundProjector | null = null;

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
      if (move && this.desktopMode !== "keyboard") {
        this.desktopMode = "keyboard";
        this.mouseAims = false;
      }
      if (move || e.code === "Space") this.setTouchMode(false);
    });
    // pointerType distingue un vrai doigt d'une vraie souris, là où les
    // évènements souris sont aussi émis (par compatibilité) après un tap.
    window.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch") this.setTouchMode(true);
      else if (e.pointerType === "mouse") this.setTouchMode(false);
    }, { capture: true, passive: true });
    window.addEventListener("pointermove", (e) => {
      if (e.pointerType === "mouse" && (e.movementX !== 0 || e.movementY !== 0)) {
        this.setTouchMode(false);
        this.mouseAims = true;
      }
    }, { passive: true });
    // Clic gauche → repasse en déplacement souris. Pas le clic droit (lancer) :
    // un joueur clavier + souris lance au clic droit sans perdre le
    // déplacement clavier.
    gameCanvas.addEventListener("mousedown", (e) => {
      if (e.button === 0) this.desktopMode = "mouse";
    });
  }

  setProjector(projector: GroundProjector): void {
    this.projector = projector;
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
      return { dx: 0, dy: 0, boost: false, throwPressed: false, aimX: 0, aimY: 0 };
    }
    // Le throw est universel : Espace clavier, clic droit souris, ou bouton
    // THROW touch. On combine les 3 sources pour qu'aucun appui ne soit
    // perdu selon le mode actif.
    const touchThrow = this.touch.consumeThrow();
    const keyThrow = this.keyboard.consumeThrow();
    const mouseThrow = this.mouse.consumeThrow();
    const throwPressed = keyThrow || mouseThrow || touchThrow !== null;
    // Visée : glisser relâché sur THROW (un tap suit le déplacement), sinon
    // visée courante.
    let aim: { x: number; y: number } | null;
    if (touchThrow) aim = touchThrow.x !== 0 || touchThrow.y !== 0 ? this.dragDir(touchThrow.x, touchThrow.y) : null;
    else aim = this.aim();
    const move = this.moveInput();
    return { ...move, throwPressed, aimX: aim?.x ?? 0, aimY: aim?.y ?? 0 };
  }

  // Variante non-consommante : ne touche pas au flag throw. Pour lire
  // l'input courant hors envoi (indicateur de visée) sans avaler un appui
  // qui doit partir au serveur.
  peekDirBoost(): { dx: number; dy: number; boost: boolean } {
    if (this.isTypingInTextField()) {
      return { dx: 0, dy: 0, boost: false };
    }
    return this.moveInput();
  }

  // Visée courante, sans consommer de lancer : curseur (souris seule, ou
  // clavier + souris), glisser en cours sur THROW. null : le lancer suivra
  // la direction de déplacement.
  aim(): { x: number; y: number } | null {
    if (this.isTypingInTextField()) return null;
    if (this.isTouch) {
      const drag = this.touch.throwDrag;
      return drag ? this.dragDir(drag.x, drag.y) : null;
    }
    if (this.desktopMode === "keyboard" && !this.mouseAims) return null;
    return this.cursorDir();
  }

  // Doigt en train de viser depuis THROW : l'indicateur reste affiché même
  // si le lancer n'est pas encore disponible.
  get dragAiming(): boolean {
    return this.isTouch && this.touch.throwDrag !== null;
  }

  private moveInput(): { dx: number; dy: number; boost: boolean } {
    if (this.isTouch) {
      const d = this.touch.getDir();
      return { dx: d.x, dy: d.y, boost: this.touch.boost };
    }
    if (this.desktopMode === "keyboard") {
      const kbd = this.keyboard.dir;
      return { dx: kbd.x, dy: kbd.y, boost: this.keyboard.boost };
    }
    // Mode souris : suit le curseur. Shift reste actif pour le boost.
    const md = this.cursorDir();
    return { dx: md?.x ?? 0, dy: md?.y ?? 0, boost: this.keyboard.boost || this.mouse.boost };
  }

  // Direction au sol du joueur vers le point sous le curseur. La caméra est
  // inclinée : l'angle mesuré à l'écran depuis le centre (ancien calcul) ne
  // correspondait pas à l'angle au sol, et marche comme visée déviaient hors
  // des axes. null dans la zone morte, hors partie, ou avant tout mouvement
  // de souris.
  private cursorDir(): { x: number; y: number } | null {
    const pr = this.projector;
    const me = pr?.player();
    if (!pr || !me || !this.mouse.used) return null;
    const s = pr.screenOf(me.x, me.y);
    if (Math.hypot(this.mouse.x - s.x, this.mouse.y - s.y) < MOUSE_DEAD_ZONE_PX) return null;
    const g = pr.groundAt(this.mouse.x, this.mouse.y);
    return g ? unit(g.x - me.x, g.y - me.y) : null;
  }

  // Direction au sol d'un glisser à l'écran, depuis le joueur : le trait de
  // visée suit le doigt tel qu'on le voit, malgré l'inclinaison.
  private dragDir(dragX: number, dragY: number): { x: number; y: number } | null {
    const pr = this.projector;
    const me = pr?.player();
    const m = Math.hypot(dragX, dragY);
    if (!pr || !me || m < 1e-6) return null;
    const s = pr.screenOf(me.x, me.y);
    const g = pr.groundAt(s.x + (dragX / m) * DRAG_PROBE_PX, s.y + (dragY / m) * DRAG_PROBE_PX);
    return g ? unit(g.x - me.x, g.y - me.y) : null;
  }

  setSensitivity(v: number): void {
    this.touch.sensitivity = v;
  }
}

function unit(x: number, y: number): { x: number; y: number } | null {
  const m = Math.hypot(x, y);
  return m > 1e-6 ? { x: x / m, y: y / m } : null;
}
