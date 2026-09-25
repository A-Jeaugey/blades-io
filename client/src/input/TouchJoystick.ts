const DEADZONE = 0.15;
// Glisser minimal (px) depuis le bouton THROW pour viser. En deçà, le
// relâcher est un tap : le lancer suit la direction de déplacement.
const THROW_DRAG_PX = 18;

export class TouchJoystick {
  private base: HTMLElement;
  private thumb: HTMLElement;
  private boostBtn: HTMLElement;
  private throwBtn: HTMLElement | null;
  private active = false;
  private touchId: number | null = null;
  private startX = 0;
  private startY = 0;
  private curX = 0;
  private curY = 0;
  private radius = 60;
  public sensitivity = 1;
  public used = false;
  private boostActive = false;
  private boostTouchId: number | null = null;
  // Doigt posé sur THROW : départ et position courante (px client).
  private throwTouchId: number | null = null;
  private throwStartX = 0;
  private throwStartY = 0;
  private throwCurX = 0;
  private throwCurY = 0;
  private throwDragged = false;
  // Lancer à transmettre, UNE fois : glisser au relâcher (px écran), ou
  // (0, 0) pour un tap.
  private throwPending: { x: number; y: number } | null = null;

  constructor(
    container: HTMLElement,
    base: HTMLElement,
    thumb: HTMLElement,
    boostBtn: HTMLElement,
    throwBtn: HTMLElement | null = null,
  ) {
    this.base = base;
    this.thumb = thumb;
    this.boostBtn = boostBtn;
    this.throwBtn = throwBtn;
    container.addEventListener("touchstart", (e) => this.onStart(e), { passive: false });
    container.addEventListener("touchmove", (e) => this.onMove(e), { passive: false });
    container.addEventListener("touchend", (e) => this.onEnd(e));
    container.addEventListener("touchcancel", (e) => this.onEnd(e));

    boostBtn.addEventListener("touchstart", (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (this.boostTouchId === null && e.changedTouches.length > 0) {
        this.boostTouchId = e.changedTouches[0].identifier;
      }
      this.boostActive = true;
    }, { passive: false });
    const releaseBoost = (e: TouchEvent) => {
      e.stopPropagation();
      if (this.boostTouchId !== null) {
        for (let i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === this.boostTouchId) {
            this.boostTouchId = null;
            this.boostActive = false;
            return;
          }
        }
      } else {
        this.boostActive = false;
      }
    };
    boostBtn.addEventListener("touchend", releaseBoost);
    boostBtn.addEventListener("touchcancel", releaseBoost);

    if (throwBtn) {
      // Le lancer part au relâcher, comme un stick de visée : un tap suit
      // la direction de déplacement, un glisser vise dans sa direction. Un
      // glisser ramené au centre annule. Les évènements d'un doigt restent
      // adressés au bouton même s'il en sort.
      throwBtn.addEventListener("touchstart", (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (this.throwTouchId !== null || e.changedTouches.length === 0) return;
        const t = e.changedTouches[0];
        this.throwTouchId = t.identifier;
        this.throwStartX = this.throwCurX = t.clientX;
        this.throwStartY = this.throwCurY = t.clientY;
        this.throwDragged = false;
      }, { passive: false });
      throwBtn.addEventListener("touchmove", (e) => {
        if (this.throwTouchId === null) return;
        const t = this.findTouch(e.changedTouches, this.throwTouchId);
        if (!t) return;
        e.preventDefault();
        this.throwCurX = t.clientX;
        this.throwCurY = t.clientY;
        const aiming = this.throwDrag !== null;
        if (aiming) this.throwDragged = true;
        throwBtn.classList.toggle("aiming", aiming);
      }, { passive: false });
      const releaseThrow = (e: TouchEvent, cancelled: boolean) => {
        if (this.throwTouchId === null) return;
        const t = this.findTouch(e.changedTouches, this.throwTouchId);
        if (!t) return;
        e.stopPropagation();
        this.throwCurX = t.clientX;
        this.throwCurY = t.clientY;
        const drag = this.throwDrag;
        if (!cancelled) {
          if (drag) this.throwPending = drag;
          else if (!this.throwDragged) this.throwPending = { x: 0, y: 0 };
        }
        this.throwTouchId = null;
        throwBtn.classList.remove("aiming");
      };
      throwBtn.addEventListener("touchend", (e) => releaseThrow(e, false));
      throwBtn.addEventListener("touchcancel", (e) => releaseThrow(e, true));
    }
  }

  // Glisser en cours depuis THROW (px écran), null en deçà du seuil.
  get throwDrag(): { x: number; y: number } | null {
    if (this.throwTouchId === null) return null;
    const x = this.throwCurX - this.throwStartX;
    const y = this.throwCurY - this.throwStartY;
    return Math.hypot(x, y) >= THROW_DRAG_PX ? { x, y } : null;
  }

  // Lancer relâché depuis le dernier appel : glisser (px écran), (0, 0) pour
  // un tap, null s'il n'y en a pas.
  consumeThrow(): { x: number; y: number } | null {
    const t = this.throwPending;
    this.throwPending = null;
    return t;
  }

  // Retrouve un touch par son identifier dans une TouchList.
  private findTouch(list: TouchList, id: number): Touch | null {
    for (let i = 0; i < list.length; i++) {
      if (list[i].identifier === id) return list[i];
    }
    return null;
  }

  private onStart(e: TouchEvent): void {
    e.preventDefault();
    if (this.active) return; // Déjà un doigt actif sur le joystick : on ignore.
    // Prend le premier touch qui a réellement commencé sur le joystick.
    if (e.changedTouches.length === 0) return;
    const t = e.changedTouches[0];
    this.touchId = t.identifier;
    this.used = true;
    const rect = this.base.getBoundingClientRect();
    this.startX = rect.left + rect.width / 2;
    this.startY = rect.top + rect.height / 2;
    this.radius = rect.width / 2;
    this.curX = t.clientX;
    this.curY = t.clientY;
    this.active = true;
    this.updateThumb();
  }

  private onMove(e: TouchEvent): void {
    if (!this.active || this.touchId === null) return;
    const t = this.findTouch(e.changedTouches, this.touchId);
    if (!t) return; // Le mouvement concerne un autre doigt (ex. boost), on l'ignore.
    e.preventDefault();
    this.curX = t.clientX;
    this.curY = t.clientY;
    this.updateThumb();
  }

  private onEnd(e: TouchEvent): void {
    if (this.touchId === null) return;
    // Ne libère que si c'est le doigt du joystick qui se lève.
    const released = this.findTouch(e.changedTouches, this.touchId);
    if (!released) return;
    this.active = false;
    this.touchId = null;
    this.thumb.style.transform = `translate(-50%, -50%)`;
  }

  private updateThumb(): void {
    const dx = this.curX - this.startX;
    const dy = this.curY - this.startY;
    const m = Math.hypot(dx, dy);
    const clamp = Math.min(m, this.radius);
    const ux = m > 0 ? (dx / m) * clamp : 0;
    const uy = m > 0 ? (dy / m) * clamp : 0;
    this.thumb.style.transform = `translate(calc(-50% + ${ux}px), calc(-50% + ${uy}px))`;
  }

  getDir(): { x: number; y: number } {
    if (!this.active) return { x: 0, y: 0 };
    const dx = this.curX - this.startX;
    const dy = this.curY - this.startY;
    const m = Math.hypot(dx, dy);
    if (m === 0) return { x: 0, y: 0 };
    const normRaw = Math.min(1, m / this.radius);
    if (normRaw < DEADZONE) return { x: 0, y: 0 };
    const norm = (normRaw - DEADZONE) / (1 - DEADZONE);
    const scaled = Math.min(1, norm * this.sensitivity);
    return { x: (dx / m) * scaled, y: (dy / m) * scaled };
  }

  get boost(): boolean {
    return this.boostActive;
  }
}
