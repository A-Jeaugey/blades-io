import { GAME_MODES, GameModeId, NAME_MAX_LENGTH, NAME_MIN_LENGTH, USERNAME_RE, gameModeOf, nameProblem } from "@bladeio/shared";
import { AuthPanel } from "./AuthPanel";
import { auth } from "../auth/supabase";
import { wallet } from "../auth/wallet";
import { fetchGuestWallet } from "../auth/guestToken";
import { I18nKey, gameModeHint, gameModeName, onLangChange, t } from "../i18n";
import { levelText } from "./level";
import { LeaderboardView } from "./LeaderboardView";
import { joinIdFromUrl } from "./share";

// Identifiant de build (date + commit) injecté par Vite (cf. vite.config.ts).
declare const __BUILD_ID__: string;

export type LoginMode = "public" | "create" | "join";
export interface LoginResult {
  name: string;
  mode: LoginMode;
  code?: string;
  bots?: boolean;
  // Arène publique d'un ami (lien « rejoins-moi », tâche 5.5).
  roomId?: string;
  // Mode de jeu (tâche 7.3) : partie rapide et salon créé seulement ; un
  // code rejoint le salon dans son mode.
  gameMode?: GameModeId;
}

const GAME_MODE_KEY = "blade.gameMode";

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
  private nameLabel: HTMLElement | null;
  private nameLabelKey: I18nKey = "lobby.callsign";
  private authPanel: AuthPanel | null = null;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private statsInterval: ReturnType<typeof setInterval> | null = null;
  private mode: LoginMode = "public";
  // Dernier mode de jeu choisi sur l'appareil (tâche 7.3).
  private gameMode: GameModeId = gameModeOf(localStorage.getItem(GAME_MODE_KEY));
  private walletBadge: HTMLElement | null = null;
  private walletValue: HTMLElement | null = null;
  // XP du niveau affiché (tâche 5.2), gardée pour la bascule de langue.
  private shownXp: number | null = null;
  // Classements à onglets du rail droit (tâche 5.4).
  private board: LeaderboardView | null = null;
  // Invitation dans l'arène d'un ami (?join=ID, tâche 5.5), jusqu'à la
  // première partie.
  private inviteRoomId: string | null = null;
  private renameActions: HTMLElement | null = null;
  private renameBtn: HTMLButtonElement | null = null;
  private renameSaveBtn: HTMLButtonElement | null = null;
  private renameCancelBtn: HTMLButtonElement | null = null;
  private renameMsg: HTMLElement | null = null;
  private renaming = false;
  private renameOriginal = "";
  private renameBusy = false;

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
    this.nameLabel = document.querySelector('label[for="name-input"]');
    const authRoot = document.getElementById("auth-panel");
    if (authRoot) {
      this.authPanel = new AuthPanel(authRoot);
      // Quand l'état d'auth change, mettre à jour le champ CALLSIGN
      // + rafraîchir le badge wallet (perd ou gagne du sens selon la session).
      auth.subscribe(() => {
        this.applyAuthState();
        this.refreshWallet();
      });
    }
    this.walletBadge = document.getElementById("wallet-badge");
    this.walletValue = document.getElementById("wallet-balance");
    // Subscribe au store wallet pour recevoir les updates côté authed
    // (mort en partie, claim, refresh post-sign-in).
    wallet.subscribe((w) => {
      if (w && this.walletBadge && this.walletValue) {
        this.walletValue.textContent = String(w.balance);
        this.walletBadge.classList.remove("hidden");
        this.setLevel(w.total_earned);
      }
    });

    this.renameActions = document.getElementById("rename-actions");
    this.renameBtn = document.getElementById("rename-btn") as HTMLButtonElement | null;
    this.renameSaveBtn = document.getElementById("rename-save") as HTMLButtonElement | null;
    this.renameCancelBtn = document.getElementById("rename-cancel") as HTMLButtonElement | null;
    this.renameMsg = document.getElementById("rename-msg");
    this.renameBtn?.addEventListener("click", () => this.startRename());
    this.renameSaveBtn?.addEventListener("click", () => this.saveRename());
    this.renameCancelBtn?.addEventListener("click", () => this.cancelRename());
    this.input.addEventListener("keydown", (e) => {
      if (!this.renaming) return;
      if (e.key === "Enter") { e.preventDefault(); this.saveRename(); }
      else if (e.key === "Escape") { e.preventDefault(); this.cancelRename(); }
    });

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
    } else {
      // ?join=ID → partie rapide dans l'arène de l'ami, annoncée au-dessus
      // du bouton d'entrée.
      this.inviteRoomId = joinIdFromUrl();
      document.getElementById("join-invite")?.classList.toggle("hidden", this.inviteRoomId === null);
    }

    this.input.addEventListener("input", () => {
      this.updateNameCount();
      if (!this.renaming) this.clearRenameMessage();
    });

    this.codeInput.addEventListener("input", () => {
      this.codeInput.value = sanitizeCode(this.codeInput.value);
      this.renderCodeCells();
    });

    const submit = () => {
      // Si l'utilisateur est authentifié et a un username, c'est lui qui sert
      // de pseudo en jeu (le champ CALLSIGN est en lecture seule). Sinon
      // on lit la valeur tapée (mode invité).
      const lockedName = this.authPanel?.isLockedToUsername() ? this.authPanel?.getDisplayName() ?? "" : "";
      let name = lockedName ? lockedName : this.input.value.trim();
      // Insulte, nom réservé, écritures mêlées (tâche 5.6) : refusé ici
      // plutôt que remplacé en silence par le serveur.
      if (!lockedName && name.length >= NAME_MIN_LENGTH && nameProblem(name) !== null) {
        this.setRenameMessage(t("lobby.nameRefused"));
        this.input.focus();
        return;
      }
      if (name.length < NAME_MIN_LENGTH) name = "Anon" + Math.floor(Math.random() * 1000);
      if (name.length > NAME_MAX_LENGTH) name = name.slice(0, NAME_MAX_LENGTH);
      if (!lockedName) localStorage.setItem("blade.name", name);
      const res: LoginResult = { name, mode: this.mode };
      const gameMode = this.selectedGameMode();
      if (gameMode) res.gameMode = gameMode;
      if (this.mode === "public" && this.inviteRoomId) res.roomId = this.inviteRoomId;
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
    // En mode rename, ENTER sur l'input est consommé par saveRename (cf
    // listener plus haut). On garde ce listener actif pour le mode normal.
    this.input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !this.renaming) submit(); });
    this.codeInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

    const buildEl = document.getElementById("bio2-build");
    if (buildEl) buildEl.textContent = __BUILD_ID__;
    this.startReadouts();
    if (this.taglineEl) runGlitchReveal(this.taglineEl, t("lobby.tagline"));
    this.applyAuthState();
    const boardRoot = document.getElementById("lobby-board");
    this.board = boardRoot ? new LeaderboardView(boardRoot) : null;
    void this.board?.load();
    this.refreshWallet();
    this.renderGameModes();
    onLangChange(() => {
      this.renderGameModes();
      if (this.taglineEl) this.taglineEl.textContent = t("lobby.tagline");
      this.renderNameLabel();
      this.board?.render();
      if (this.shownXp !== null) this.setLevel(this.shownXp);
    });
  }

  // Met à jour le badge "TROPHÉES" avec le solde courant. Pour un user
  // authentifié, on tape /api/wallet ; pour un guest avec token, on tape
  // /api/guest/wallet ; sinon on cache le badge.
  private async refreshWallet(): Promise<void> {
    if (!this.walletBadge || !this.walletValue) return;
    if (auth.getAccessToken()) {
      const w = await wallet.refresh();
      if (w) {
        this.walletValue.textContent = String(w.balance);
        this.walletBadge.classList.remove("hidden");
        this.setLevel(w.total_earned);
      } else {
        this.walletBadge.classList.add("hidden");
      }
      return;
    }
    const g = await fetchGuestWallet();
    if (g && !g.claimed) {
      this.walletValue.textContent = String(g.balance);
      this.walletBadge.classList.remove("hidden");
      // Un invité ne dépense rien : son solde est son XP.
      this.setLevel(g.balance);
    } else {
      this.walletBadge.classList.add("hidden");
    }
  }

  // Niveau de compte à côté des trophées (tâche 5.2) : « NIV. 12 » et la
  // progression dans le niveau ; le détail en infobulle.
  private setLevel(xp: number | null): void {
    this.shownXp = xp;
    const el = document.getElementById("wallet-level");
    if (!el) return;
    if (xp === null) {
      el.classList.add("hidden");
      return;
    }
    const lv = levelText(xp);
    (el.querySelector("b") as HTMLElement).textContent = lv.short;
    (el.querySelector("i") as HTMLElement).style.setProperty("--p", lv.fraction.toFixed(3));
    el.title = `${lv.full} · ${lv.xp}`;
    el.setAttribute("aria-label", el.title);
    el.classList.remove("hidden");
  }

  private renderNameLabel(): void {
    if (this.nameLabel) this.nameLabel.textContent = t(this.nameLabelKey);
  }

  // Verrouille / déverrouille le champ CALLSIGN selon l'état d'auth.
  // Authed avec username → champ readonly pré-rempli, bouton RENAME visible.
  // Sinon → comportement classique (mode invité), pas de bouton.
  private applyAuthState(): void {
    const username = this.authPanel?.isLockedToUsername() ? this.authPanel?.getDisplayName() ?? "" : "";
    if (username) {
      // Si on était en train de renommer et que le username remonté du
      // serveur a changé, on sort proprement du mode rename.
      if (this.renaming && this.renameOriginal !== username) {
        this.renaming = false;
        this.clearRenameMessage();
      }
      if (!this.renaming) {
        this.input.value = username;
        this.input.readOnly = true;
        this.input.classList.add("bio2-input-locked");
        this.nameLabelKey = "lobby.callsignProfile";
        this.renderNameLabel();
      }
      // Affiche les boutons rename (état idle ou éditable selon this.renaming).
      this.renameActions?.classList.remove("hidden");
      this.applyRenameButtons();
    } else {
      this.renaming = false;
      this.clearRenameMessage();
      this.input.readOnly = false;
      this.input.classList.remove("bio2-input-locked");
      this.nameLabelKey = "lobby.callsign";
      this.renderNameLabel();
      const saved = localStorage.getItem("blade.name");
      if (saved && this.input.value === "") this.input.value = saved;
      this.renameActions?.classList.add("hidden");
    }
    this.updateNameCount();
  }

  // Reflète l'état renaming sur les 3 boutons (idle: RENAME, edit: ✓ + ✗).
  private applyRenameButtons(): void {
    if (!this.renameBtn || !this.renameSaveBtn || !this.renameCancelBtn) return;
    if (this.renaming) {
      this.renameBtn.classList.add("hidden");
      this.renameSaveBtn.classList.remove("hidden");
      this.renameCancelBtn.classList.remove("hidden");
    } else {
      this.renameBtn.classList.remove("hidden");
      this.renameSaveBtn.classList.add("hidden");
      this.renameCancelBtn.classList.add("hidden");
    }
  }

  private startRename(): void {
    if (!this.authPanel?.isLockedToUsername()) return;
    this.renameOriginal = this.input.value;
    this.renaming = true;
    this.input.readOnly = false;
    this.input.classList.remove("bio2-input-locked");
    this.applyRenameButtons();
    this.clearRenameMessage();
    this.input.focus();
    this.input.select();
    this.updateNameCount();
  }

  private cancelRename(): void {
    this.renaming = false;
    this.input.value = this.renameOriginal;
    this.input.readOnly = true;
    this.input.classList.add("bio2-input-locked");
    this.applyRenameButtons();
    this.clearRenameMessage();
    this.updateNameCount();
  }

  private async saveRename(): Promise<void> {
    if (!this.renaming || this.renameBusy) return;
    const next = this.input.value.trim();
    // Pseudo de compte : la règle de l'API et de la base (USERNAME_RE).
    // Avant, ce champ acceptait les lettres accentuées, que l'API refusait
    // ensuite avec un message qui ne disait pas pourquoi.
    if (!USERNAME_RE.test(next)) {
      this.setRenameMessage(t("lobby.nameRule"));
      return;
    }
    if (nameProblem(next) !== null) {
      this.setRenameMessage(t("auth.errUsernameRefused"));
      return;
    }
    if (next === this.renameOriginal) {
      // Pas de changement, on sort sans round-trip.
      this.cancelRename();
      return;
    }
    this.renameBusy = true;
    if (this.renameSaveBtn) this.renameSaveBtn.disabled = true;
    if (this.renameCancelBtn) this.renameCancelBtn.disabled = true;
    const { error } = await auth.setUsername(next);
    this.renameBusy = false;
    if (this.renameSaveBtn) this.renameSaveBtn.disabled = false;
    if (this.renameCancelBtn) this.renameCancelBtn.disabled = false;
    if (error) {
      this.setRenameMessage(error);
      return;
    }
    // setUsername a poussé un nouveau profile dans auth → applyAuthState
    // se re-déclenche via subscribe et le mode rename se reset.
    this.renaming = false;
    this.clearRenameMessage();
  }

  private setRenameMessage(text: string): void {
    if (!this.renameMsg) return;
    this.renameMsg.textContent = text;
    this.renameMsg.classList.remove("hidden");
  }
  private clearRenameMessage(): void {
    if (!this.renameMsg) return;
    this.renameMsg.textContent = "";
    this.renameMsg.classList.add("hidden");
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

  // Compteur hexadécimal de l'en-tête de la console : pur habillage, il ne
  // prétend mesurer quoi que ce soit (cadence 800ms du design source). Le
  // ping et le nombre de joueurs, eux, sont mesurés (refreshLiveStats) ;
  // avant, ils étaient tirés au hasard.
  private startReadouts(): void {
    let tick = 0;
    const refresh = () => {
      tick = (tick + 1) & 0xffff;
      if (this.tickEl) this.tickEl.textContent = tick.toString(16).toUpperCase().padStart(4, "0");
    };
    refresh();
    this.tickInterval = setInterval(refresh, 800);
    void this.refreshLiveStats();
    this.statsInterval = setInterval(() => void this.refreshLiveStats(), 10_000);
  }

  // Ping = aller-retour HTTP vers /healthz (même serveur que le jeu en
  // auto-hébergement) ; joueurs en partie = /api/stats. En cas d'échec on
  // affiche « — » plutôt qu'un chiffre.
  private async refreshLiveStats(): Promise<void> {
    try {
      const url = `/healthz?t=${Date.now()}`;
      const t0 = performance.now();
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`healthz ${r.status}`);
      // L'entrée Resource Timing n'est publiée qu'une fois le corps reçu.
      await r.text();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const rtt = Math.round(this.networkRtt(url) ?? performance.now() - t0);
      if (this.pingEl) {
        this.pingEl.textContent = `${rtt}ms`;
        this.pingEl.style.color = rtt < 50 ? "var(--cyan)" : "var(--pink)";
      }
    } catch {
      if (this.pingEl) {
        this.pingEl.textContent = "—";
        this.pingEl.style.color = "";
      }
    }
    try {
      const r = await fetch("/api/stats", { cache: "no-store" });
      if (!r.ok) throw new Error(`stats ${r.status}`);
      const j = await r.json();
      const n = Number(j?.inGame);
      if (this.onlineEl) this.onlineEl.textContent = Number.isFinite(n) ? n.toLocaleString() : "—";
    } catch {
      if (this.onlineEl) this.onlineEl.textContent = "—";
    }
  }

  // Temps réseau d'une requête via la Resource Timing API (requestStart →
  // responseStart), indépendant du thread principal : mesuré à la main,
  // le rendu 3D qui tourne derrière le lobby gonflait le ping de plusieurs
  // centaines de ms sur les machines lentes. On vide le buffer ensuite pour
  // qu'il ne sature pas (une entrée toutes les 10 s).
  private networkRtt(url: string): number | null {
    const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    let rtt: number | null = null;
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (!e.name.endsWith(url)) continue;
      if (e.requestStart > 0 && e.responseStart > e.requestStart) rtt = e.responseStart - e.requestStart;
      break;
    }
    performance.clearResourceTimings();
    return rtt;
  }

  private stopReadouts(): void {
    if (this.tickInterval !== null) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.statsInterval !== null) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
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
    this.renderGameModes();
  }

  // Modes proposés pour l'entrée choisie (tâche 7.3) : files publiques de
  // la partie rapide, ou modes d'un salon à créer. Un code rejoint le salon
  // dans son mode : rien à choisir.
  private offeredGameModes(): GameModeId[] {
    if (this.mode === "join") return [];
    const quick = this.mode === "public";
    return GAME_MODES.filter((m) => (quick ? m.quickPlay : m.privateRoom)).map((m) => m.id);
  }

  // Le choix de l'appareil s'il est proposé ici, sinon le premier proposé.
  private selectedGameMode(): GameModeId | undefined {
    const offered = this.offeredGameModes();
    return offered.includes(this.gameMode) ? this.gameMode : offered[0];
  }

  // Sélecteur caché tant qu'il n'y a qu'un mode à proposer.
  private renderGameModes(): void {
    const field = document.getElementById("game-mode-field");
    const row = document.getElementById("game-mode-row");
    if (!field || !row) return;
    const offered = this.offeredGameModes();
    field.classList.toggle("hidden", offered.length < 2);
    const selected = this.selectedGameMode();
    row.replaceChildren(...offered.map((id) => {
      const b = document.createElement("button");
      b.type = "button";
      const on = id === selected;
      b.className = on ? "bio2-mode bio2-mode-on" : "bio2-mode";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(on));
      const label = document.createElement("span");
      label.className = "bio2-mode-label";
      label.textContent = gameModeName(id);
      const hint = document.createElement("span");
      hint.className = "bio2-mode-hint";
      hint.textContent = gameModeHint(id);
      b.append(label, hint);
      b.addEventListener("click", () => {
        this.gameMode = id;
        try { localStorage.setItem(GAME_MODE_KEY, id); } catch { /* navigation privée */ }
        this.renderGameModes();
      });
      return b;
    }));
  }

  // L'invitation ne sert qu'une fois : ensuite, matchmaking habituel.
  clearInvite(): void {
    this.inviteRoomId = null;
    document.getElementById("join-invite")?.classList.add("hidden");
  }

  show(): void {
    this.root.classList.remove("hidden");
    if (this.tickInterval === null) this.startReadouts();
    // Re-fetch à chaque retour au menu : le joueur vient de finir une partie,
    // son score peut être dans le top maintenant et son wallet a augmenté.
    void this.board?.load();
    this.refreshWallet();
  }
  hide(): void {
    this.root.classList.add("hidden");
    this.stopReadouts();
  }
}
