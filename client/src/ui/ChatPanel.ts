import { CHAT_LOG_CAP, CHAT_MESSAGE_MAX_LENGTH, ChatEvent } from "@bladeio/shared";

// ─────────────────────────────────────────────────────────────────────────────
// ChatPanel — overlay bas-gauche, gestion ouverture/saisie/envoi.
//
// UX :
//   - Press Entrée hors saisie → ouvre l'input (focus, panel fade in)
//   - Press Entrée dans l'input → envoie + ferme l'input + return focus jeu
//   - Press Échap dans l'input → annule + ferme
//   - Toutes les touches mouvement (WASD/flèches/space/shift) sont swallowed
//     par le browser quand l'input chat a le focus (comportement standard
//     <input>). Le InputManager observe cet état via `isOpen()` et arrête
//     de produire du dx/dy.
//   - Log auto-scroll au dernier message reçu, plafonné à CHAT_LOG_CAP
//     entrées (FIFO).
//   - Le panel entier fade in dès qu'un message arrive ou que l'input est
//     ouvert ; fade out après 6s d'inactivité (le hint "Entrée pour
//     discuter" reste visible en bas de manière atténuée).
// ─────────────────────────────────────────────────────────────────────────────

const FADE_DELAY_MS = 6000;
// Durée d'affichage d'un message individuel à l'écran. Au-delà, le
// message s'efface (fade out 400ms + suppression DOM) pour ne pas
// encombrer la vue. Comme dans la plupart des jeux à chat in-game
// (Slither.io, Among Us, etc.) : messages éphémères, pas de scrollback.
// 7s = lisibilité confortable mais pas envahissant.
const MESSAGE_DISPLAY_MS = 7000;
const MESSAGE_FADE_MS = 400;

type SendFn = (text: string) => void;

export class ChatPanel {
  private root: HTMLElement;
  private logEl: HTMLElement;
  private inputRow: HTMLElement;
  private input: HTMLInputElement;
  private sendBtn: HTMLButtonElement;
  private cntEl: HTMLElement;
  private hintEl: HTMLElement;
  private fab: HTMLButtonElement;
  private localPlayerId = "";
  private send: SendFn = () => {};
  private fadeTimer: number | null = null;
  private isOpenFlag = false;
  // Mobile = pas de touche Entrée, on s'appuie sur le FAB + bouton send
  // dans la barre input + enterkeyhint="send" du clavier virtuel.
  private readonly isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;

  constructor() {
    this.root = document.getElementById("chat")!;
    this.logEl = document.getElementById("chat-log")!;
    this.inputRow = document.getElementById("chat-input-row")!;
    this.input = document.getElementById("chat-input") as HTMLInputElement;
    this.sendBtn = document.getElementById("chat-send") as HTMLButtonElement;
    this.cntEl = document.getElementById("chat-cnt")!;
    this.hintEl = document.getElementById("chat-hint")!;
    this.fab = document.getElementById("chat-fab") as HTMLButtonElement;

    // Mobile : FAB visible, hint avec wording adapté.
    if (this.isTouch) {
      this.fab.classList.remove("hidden");
      this.hintEl.innerHTML = "Touche pour discuter";
    }

    // Compteur de chars en temps réel.
    this.input.addEventListener("input", () => {
      const len = this.input.value.length;
      this.cntEl.textContent = `${len}/${CHAT_MESSAGE_MAX_LENGTH}`;
    });

    // Submit / annulation depuis l'input (clavier physique).
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        this.submit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });

    // Bouton "envoyer" — pour mobile (clavier virtuel ne donne pas
    // toujours un Enter fiable selon les keyboard apps) et accessibilité.
    this.sendBtn.addEventListener("click", (e) => {
      e.preventDefault();
      this.submit();
    });

    // FAB mobile : tap = ouvre l'input.
    this.fab.addEventListener("click", (e) => {
      e.preventDefault();
      this.open();
    });

    // Tap sur la zone de log (mobile) → ouvre aussi le chat. Pratique
    // quand l'user veut répondre à un message qu'il vient de voir
    // passer.
    this.logEl.addEventListener("click", () => {
      if (this.isTouch && !this.isOpenFlag) this.open();
    });

    // Tap/click sur le hint → ouvre l'input. Hover desktop "Entrée pour
    // discuter" reste actif comme rappel, mais le hint est aussi
    // cliquable au cas où.
    this.hintEl.addEventListener("click", () => this.open());

    // Entrée GLOBALE (desktop) : ouvre le chat si pas déjà ouvert et
    // qu'on n'est pas en train de taper dans un AUTRE input. Ne déclenche
    // pas sur mobile (pas de touche Entrée physique).
    window.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      if (this.isOpenFlag) return; // déjà ouvert, le handler local s'en charge
      const active = document.activeElement;
      if (active && active.tagName === "INPUT") return; // autre input focus
      const hud = document.getElementById("hud");
      if (!hud || hud.classList.contains("hidden")) return; // pas en jeu
      e.preventDefault();
      this.open();
    });
  }

  setLocalPlayerId(id: string): void {
    this.localPlayerId = id;
  }

  setSendCallback(fn: SendFn): void {
    this.send = fn;
  }

  // Affiche le panel + focus l'input. Appelé par le keydown global Entrée
  // ou potentiellement par un bouton mobile (à brancher plus tard).
  open(): void {
    if (this.isOpenFlag) return;
    const hud = document.getElementById("hud");
    if (!hud || hud.classList.contains("hidden")) return; // pas en jeu, on n'ouvre pas
    this.isOpenFlag = true;
    this.root.classList.remove("hidden");
    this.root.classList.add("active");
    this.root.classList.add("editing"); // CSS hook pour repositionner sur mobile
    this.inputRow.classList.remove("hidden");
    this.hintEl.classList.add("hidden");
    if (this.isTouch) this.fab.classList.add("hidden");
    this.input.value = "";
    this.cntEl.textContent = `0/${CHAT_MESSAGE_MAX_LENGTH}`;
    this.input.focus();
    this.cancelFade();
  }

  close(): void {
    if (!this.isOpenFlag) return;
    this.isOpenFlag = false;
    this.root.classList.remove("active");
    this.root.classList.remove("editing");
    this.inputRow.classList.add("hidden");
    this.hintEl.classList.remove("hidden");
    if (this.isTouch) this.fab.classList.remove("hidden");
    this.input.blur();
    this.scheduleFade();
    // Sur mobile, si la log est vide, on cache complètement le panel
    // pour ne laisser que le FAB. Pas de "Touche pour discuter" qui
    // flotte au milieu de l'écran.
    this.updateMobileVisibility();
  }

  // Sur mobile, le panel est caché par défaut (pas de hint affichée). Il
  // ne devient visible que quand y a du contenu (un message dans la log)
  // ou quand on est en édition. Desktop : toujours visible (la hint sert
  // d'affordance "Entrée pour discuter").
  private updateMobileVisibility(): void {
    if (!this.isTouch) return;
    const hasMessages = this.logEl.children.length > 0;
    const shouldShow = this.isOpenFlag || hasMessages;
    this.root.classList.toggle("hidden", !shouldShow);
  }

  // Indique à InputManager si le chat capture les frappes (auquel cas
  // ignorer WASD/flèches/space pour le mouvement).
  isOpen(): boolean {
    return this.isOpenFlag;
  }

  private submit(): void {
    const text = this.input.value.trim();
    if (text.length > 0) {
      try { this.send(text); } catch { /* noop */ }
    }
    this.close();
  }

  // Reçoit un ChatEvent du serveur (broadcast à toute la room).
  onChatEvent(ev: ChatEvent): void {
    this.appendMessage(ev);
    // Auto-show le panel : un message qui arrive doit être visible.
    this.root.classList.remove("hidden");
    this.root.classList.add("active");
    this.scheduleFade();
    this.updateMobileVisibility();
  }

  // Pousse un message dans la log. FIFO : si on dépasse CHAT_LOG_CAP, on
  // dégage les plus anciens. Auto-scroll en bas.
  private appendMessage(ev: ChatEvent): void {
    const row = document.createElement("div");
    row.className = "chat-row";
    if (ev.system) row.classList.add("chat-row-system");
    if (ev.playerId === this.localPlayerId) row.classList.add("chat-row-self");

    if (!ev.system) {
      const name = document.createElement("span");
      name.className = "chat-name";
      name.textContent = ev.playerName + " ";
      row.appendChild(name);
    }
    const text = document.createElement("span");
    text.className = "chat-text";
    text.textContent = ev.text;
    row.appendChild(text);

    this.logEl.appendChild(row);
    while (this.logEl.children.length > CHAT_LOG_CAP) {
      this.logEl.removeChild(this.logEl.firstChild!);
    }
    // Scroll vers le bas (le plus récent).
    this.logEl.scrollTop = this.logEl.scrollHeight;

    // Auto-effacement après MESSAGE_DISPLAY_MS pour ne pas obstruer la
    // vision. Fade out de MESSAGE_FADE_MS juste avant suppression →
    // disparition graduelle, pas un blink. Si le row a déjà été éjecté
    // par le FIFO cap entre-temps, parentNode est null et on no-op.
    window.setTimeout(() => {
      row.classList.add("fading");
      window.setTimeout(() => {
        if (row.parentNode === this.logEl) {
          this.logEl.removeChild(row);
        }
        this.updateMobileVisibility();
      }, MESSAGE_FADE_MS);
    }, MESSAGE_DISPLAY_MS - MESSAGE_FADE_MS);
  }

  // Cache complètement le panel (sortie de match). Reset state interne.
  hide(): void {
    this.close();
    this.root.classList.add("hidden");
    this.root.classList.remove("active");
    if (this.isTouch) this.fab.classList.add("hidden");
    this.cancelFade();
    this.logEl.innerHTML = "";
  }

  // Re-affiche le panel à l'entrée en match. Sur desktop, le hint
  // "Entrée pour discuter" est visible (panel en mode idle). Sur mobile,
  // SEULEMENT le FAB est visible — le panel reste caché tant qu'y a pas
  // de contenu (message reçu ou input ouvert).
  show(): void {
    if (this.isTouch) {
      this.fab.classList.remove("hidden");
      // Le panel reste caché s'il n'y a aucun message en log.
      this.updateMobileVisibility();
    } else {
      this.root.classList.remove("hidden");
    }
    this.scheduleFade();
  }

  // Fade auto : après FADE_DELAY_MS sans activité, on retire la classe
  // .active → opacité réduite via CSS. Le panel reste cliquable, juste
  // moins voyant pour ne pas distraire pendant le combat.
  private scheduleFade(): void {
    this.cancelFade();
    this.fadeTimer = window.setTimeout(() => {
      this.fadeTimer = null;
      if (this.isOpenFlag) return; // ne pas fade si l'user tape
      this.root.classList.remove("active");
    }, FADE_DELAY_MS);
  }

  private cancelFade(): void {
    if (this.fadeTimer != null) {
      window.clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
    }
  }
}
