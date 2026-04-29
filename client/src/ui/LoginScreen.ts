import { NAME_MAX_LENGTH, NAME_MIN_LENGTH } from "@bladeio/shared";

export type LoginMode = "public" | "create" | "join";
export interface LoginResult {
  name: string;
  mode: LoginMode;
  code?: string;
  bots?: boolean;
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function randomCode(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

function sanitizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
}

// Glitch text reveal : flicker random chars puis settle. Utilisé pour la
// tagline au mount. Pure presentation, pas de hook sur la logique métier.
function runGlitchReveal(el: HTMLElement, finalText: string, durationMs = 600): void {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789█▓▒░<>/_";
  const start = performance.now();
  const tick = () => {
    const t = performance.now() - start;
    const p = Math.min(1, t / durationMs);
    const settled = Math.floor(p * finalText.length);
    let s = finalText.slice(0, settled);
    for (let i = settled; i < finalText.length; i++) {
      s += finalText[i] === " " ? " " : chars[Math.floor(Math.random() * chars.length)];
    }
    el.textContent = s;
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = finalText;
  };
  requestAnimationFrame(tick);
}

export class LoginScreen {
  private root: HTMLElement;
  private input: HTMLInputElement;
  private button: HTMLButtonElement;
  private tabs: NodeListOf<HTMLButtonElement>;
  private panels: Map<LoginMode, HTMLElement> = new Map();
  private codeInput: HTMLInputElement;
  private codeCells: HTMLElement[] = [];
  private botsCheckbox: HTMLInputElement;
  private nameCnt: HTMLElement | null;
  private tickEl: HTMLElement | null;
  private pingEl: HTMLElement | null;
  private onlineEl: HTMLElement | null;
  private taglineEl: HTMLElement | null;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private mode: LoginMode = "public";

  constructor(onEnter: (res: LoginResult) => void) {
    this.root = document.getElementById("login-screen")!;
    this.input = document.getElementById("name-input") as HTMLInputElement;
    this.button = document.getElementById("enter-btn") as HTMLButtonElement;
    this.tabs = document.querySelectorAll(".mode-tab");
    this.panels.set("public", document.getElementById("mode-public")!);
    this.panels.set("create", document.getElementById("mode-create")!);
    this.panels.set("join", document.getElementById("mode-join")!);
    this.codeInput = document.getElementById("code-input") as HTMLInputElement;
    this.botsCheckbox = document.getElementById("create-bots") as HTMLInputElement;
    this.nameCnt = document.getElementById("bio2-name-cnt");
    this.tickEl = document.getElementById("bio2-tick");
    this.pingEl = document.getElementById("bio2-ping");
    this.onlineEl = document.getElementById("bio2-online");
    this.taglineEl = document.getElementById("bio2-tagline-text");

    // Cellules code (5) — les arrows mettent à jour leur contenu en lisant
    // l'input invisible posé en overlay. UX inspirée du design v2 : on tape
    // dans l'overlay, les cellules affichent les caractères tapés.
    document.querySelectorAll(".bio2-code-cell").forEach((el) => {
      this.codeCells.push(el as HTMLElement);
    });

    const saved = localStorage.getItem("blade.name");
    if (saved) {
      this.input.value = saved;
      this.updateNameCount();
    }

    this.tabs.forEach((t) => {
      t.addEventListener("click", () => this.setMode(t.dataset.mode as LoginMode));
    });

    // URL ?room=CODE → pré-remplit l'onglet "join" et bascule.
    const url = new URL(window.location.href);
    const urlCode = url.searchParams.get("room");
    if (urlCode) {
      this.setMode("join");
      this.codeInput.value = sanitizeCode(urlCode);
      this.renderCodeCells();
    }

    this.input.addEventListener("input", () => this.updateNameCount());

    this.codeInput.addEventListener("input", () => {
      this.codeInput.value = sanitizeCode(this.codeInput.value);
      this.renderCodeCells();
    });

    const submit = () => {
      let name = this.input.value.trim();
      if (name.length < NAME_MIN_LENGTH) name = "Anon" + Math.floor(Math.random() * 1000);
      if (name.length > NAME_MAX_LENGTH) name = name.slice(0, NAME_MAX_LENGTH);
      localStorage.setItem("blade.name", name);
      const res: LoginResult = { name, mode: this.mode };
      if (this.mode === "create") {
        res.code = randomCode(5);
        res.bots = this.botsCheckbox.checked;
      } else if (this.mode === "join") {
        const c = sanitizeCode(this.codeInput.value);
        if (c.length !== 5) {
          this.codeInput.focus();
          this.flashCodeError();
          return;
        }
        res.code = c;
      }
      onEnter(res);
    };
    this.button.addEventListener("click", submit);
    this.input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    this.codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

    this.startReadouts();
    if (this.taglineEl) runGlitchReveal(this.taglineEl, "SPIN TO SURVIVE");
  }

  private updateNameCount(): void {
    if (!this.nameCnt) return;
    this.nameCnt.textContent = `${this.input.value.length}/${NAME_MAX_LENGTH}`;
  }

  // Rend l'état actuel du code dans les 5 cellules. Cellules vides
  // affichent un underscore placeholder, sinon le caractère majuscule.
  private renderCodeCells(): void {
    const v = this.codeInput.value;
    for (let i = 0; i < this.codeCells.length; i++) {
      const ch = v[i] ?? "";
      this.codeCells[i].textContent = "";
      if (ch) {
        this.codeCells[i].textContent = ch.toUpperCase();
      } else {
        const ph = document.createElement("span");
        ph.className = "bio2-code-ph";
        ph.textContent = "_";
        this.codeCells[i].appendChild(ph);
      }
    }
  }

  private flashCodeError(): void {
    this.codeCells.forEach((c) => c.classList.add("bio2-err"));
    setTimeout(() => this.codeCells.forEach((c) => c.classList.remove("bio2-err")), 500);
  }

  // Lance l'horloge décorative qui drive le hex tick, le ping random et le
  // count online. Cadence 800ms comme dans le design source.
  private startReadouts(): void {
    let tick = 0;
    let online = 1247;
    const refresh = () => {
      tick = (tick + 1) & 0xffff;
      const latency = 28 + Math.round(Math.random() * 18);
      online = Math.max(800, online + Math.round((Math.random() - 0.45) * 14));
      if (this.tickEl) this.tickEl.textContent = tick.toString(16).toUpperCase().padStart(4, "0");
      if (this.pingEl) {
        this.pingEl.textContent = `${latency}ms`;
        this.pingEl.style.color = latency < 50 ? "var(--cyan)" : "var(--pink)";
      }
      if (this.onlineEl) this.onlineEl.textContent = online.toLocaleString();
    };
    refresh();
    this.tickInterval = setInterval(refresh, 800);
  }

  private stopReadouts(): void {
    if (this.tickInterval !== null) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  private setMode(m: LoginMode): void {
    this.mode = m;
    this.tabs.forEach((t) => {
      const active = t.dataset.mode === m;
      t.classList.toggle("active", active);
      t.classList.toggle("bio2-mode-on", active);
      const arrow = t.querySelector(".bio2-mode-arrow");
      if (arrow) arrow.textContent = active ? "▸" : "·";
    });
    this.panels.forEach((panel, key) => {
      panel.classList.toggle("hidden", key !== m);
      panel.classList.toggle("active", key === m);
    });
    if (m === "join") setTimeout(() => this.codeInput.focus(), 0);
  }

  show(): void {
    this.root.classList.remove("hidden");
    if (this.tickInterval === null) this.startReadouts();
  }
  hide(): void {
    this.root.classList.add("hidden");
    this.stopReadouts();
  }
}
