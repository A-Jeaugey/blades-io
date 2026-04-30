export class Hud {
  private bladeCount: HTMLElement;
  private bladeLabel: HTMLElement;
  private boostFill: HTMLElement;
  private fps: HTMLElement;
  private loginFps: HTMLElement;
  private hud: HTMLElement;
  private roomBadge: HTMLElement;
  private roomCodeEl: HTMLElement;
  private currentCode = "";
  private effects: HTMLElement;
  private effectNodes: Map<string, { root: HTMLElement; bar: HTMLElement }> = new Map();
  private rankBadge: HTMLElement;

  constructor() {
    this.bladeCount = document.getElementById("blade-count")!;
    this.bladeLabel = document.getElementById("blade-label")!;
    this.boostFill = document.getElementById("boost-fill")!;
    this.fps = document.getElementById("fps")!;
    this.loginFps = document.getElementById("login-fps")!;
    this.hud = document.getElementById("hud")!;
    this.roomBadge = document.getElementById("room-badge")!;
    this.roomCodeEl = document.getElementById("room-code")!;
    this.roomBadge.addEventListener("click", () => this.copyInviteLink());
    this.effects = document.getElementById("effects")!;
    this.rankBadge = document.getElementById("rank-badge")!;
  }

  // Met à jour un badge d'effet actif (SPEED, SPIN, MAGNET, SHIELD).
  // untilMs = timestamp de fin ; si <= now, on retire le badge.
  updateEffect(
    key: string,
    label: string,
    color: string,
    untilMs: number,
    durationMs: number,
  ): void {
    const now = Date.now();
    const remaining = untilMs - now;
    let node = this.effectNodes.get(key);
    if (remaining <= 0) {
      if (node) {
        node.root.remove();
        this.effectNodes.delete(key);
      }
      return;
    }
    if (!node) {
      const root = document.createElement("div");
      root.className = "effect-badge";
      root.style.setProperty("--fx-color", color);
      const lbl = document.createElement("span");
      lbl.className = "effect-label";
      lbl.textContent = label;
      const barBg = document.createElement("div");
      barBg.className = "effect-bar-bg";
      const bar = document.createElement("div");
      bar.className = "effect-bar";
      barBg.appendChild(bar);
      root.appendChild(lbl);
      root.appendChild(barBg);
      this.effects.appendChild(root);
      node = { root, bar };
      this.effectNodes.set(key, node);
    }
    const ratio = Math.max(0, Math.min(1, remaining / durationMs));
    node.bar.style.width = `${ratio * 100}%`;
  }

  clearEffects(): void {
    this.effectNodes.forEach((n) => n.root.remove());
    this.effectNodes.clear();
  }

  show(): void { this.hud.classList.remove("hidden"); }
  hide(): void { this.hud.classList.add("hidden"); }
  setBladeCount(n: number): void {
    this.bladeCount.textContent = String(n);
    this.bladeLabel.textContent = n === 1 ? "BLADE" : "BLADES";
  }
  setBoost(ratio: number): void {
    this.boostFill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  }
  setFps(fps: number): void {
    const txt = `${fps.toFixed(0)} FPS`;
    this.fps.textContent = txt;
    this.loginFps.textContent = txt;
  }
  setRank(rank: number): void {
    this.rankBadge.textContent = `#${rank}`;
  }

  // code vide = room publique, le badge est caché.
  setRoomCode(code: string): void {
    this.currentCode = code;
    if (!code) { this.roomBadge.classList.add("hidden"); return; }
    this.roomBadge.classList.remove("hidden");
    this.roomCodeEl.textContent = code;
  }

  private copyInviteLink(): void {
    if (!this.currentCode) return;
    const url = new URL(window.location.href);
    url.searchParams.set("room", this.currentCode);
    const link = url.toString();
    const fallback = () => {
      const ta = document.createElement("textarea");
      ta.value = link;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch {}
      document.body.removeChild(ta);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(link).catch(fallback);
    } else {
      fallback();
    }
    this.roomBadge.classList.add("copied");
    setTimeout(() => this.roomBadge.classList.remove("copied"), 900);
  }
}
