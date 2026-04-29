const DEADZONE = 0.15;

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
  // Edge-trigger pour le throw mobile : true UNE fois après tap.
  private throwPending = false;

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
      // Tap unique = throw. Edge-trigger consommé par consumeThrow().
      throwBtn.addEventListener("touchstart", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.throwPending = true;
      }, { passive: false });
    }
  }

  consumeThrow(): boolean {
    if (!this.throwPending) return false;
    this.throwPending = false;
    return true;
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
