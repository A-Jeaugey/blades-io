import { I18nKey, t } from "../i18n";

// Onboarding (tâche 3.1) : carte des contrôles à la première entrée en jeu,
// indications contextuelles uniques pendant les premières parties, page
// « How to play » depuis le lobby. Tout est mémorisé localement : une
// indication déjà vue ne revient pas (sauf remise à zéro depuis la page).
// Textes : dictionnaires de i18n/ (tâche 3.7).

export type HintId = "throw" | "boost" | "border" | "bush";

const CARD_ROWS: Record<"desktop" | "touch", Array<[I18nKey, I18nKey]>> = {
  desktop: [
    ["onboard.keyMove", "onboard.desktopMove"],
    ["onboard.keyAim", "onboard.desktopAim"],
    ["onboard.keyThrow", "onboard.desktopThrow"],
    ["onboard.keyBoost", "onboard.desktopBoost"],
  ],
  touch: [
    ["onboard.keyMove", "onboard.touchMove"],
    ["onboard.keyThrow", "onboard.touchThrow"],
    ["onboard.keyBoost", "onboard.touchBoost"],
  ],
};
const CARD_RULES: I18nKey[] = ["onboard.rule1", "onboard.rule2", "onboard.rule3"];
const HINTS: Record<HintId, { desktop: I18nKey; touch: I18nKey }> = {
  throw: { desktop: "onboard.hintThrowDesktop", touch: "onboard.hintThrowTouch" },
  boost: { desktop: "onboard.hintBoostDesktop", touch: "onboard.hintBoostTouch" },
  border: { desktop: "onboard.hintBorder", touch: "onboard.hintBorder" },
  bush: { desktop: "onboard.hintBush", touch: "onboard.hintBush" },
};

const STORAGE_KEY = "blade.onboarding";
// Carte : fermée par le bouton, ou d'elle-même (elle ne bloque rien, mais
// cache le centre de l'écran).
const CARD_MS = 15000;
const HINT_MS = 5500;
const HINT_GAP_MS = 700;
// La bordure tue : son indication passe devant la carte et interrompt celle
// en cours, sinon elle arriverait après la mort. Une indication interrompue
// avant ce délai n'a pas pu être lue : elle reviendra juste après.
const URGENT: ReadonlySet<HintId> = new Set<HintId>(["border"]);
const MIN_READ_MS = 2000;

interface Stored {
  controls: boolean;
  hints: HintId[];
}

// Le stockage peut être indisponible (navigation privée, données bloquées) :
// l'onboarding se montre alors à chaque partie, sans casser le jeu.
function load(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Partial<Stored>;
      return { controls: !!s.controls, hints: Array.isArray(s.hints) ? s.hints : [] };
    }
  } catch { /* stockage indisponible */ }
  return { controls: false, hints: [] };
}

function save(s: Stored): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* idem */ }
}

export class Onboarding {
  private stored = load();
  private card: HTMLElement;
  private hintEl: HTMLElement;
  private howto: HTMLElement;
  private cardUntil = 0;
  private hintUntil = 0;
  private nextHintAt = 0;
  private queue: HintId[] = [];
  private current: HintId | null = null;
  private shownAt = 0;
  private inGame = false;

  constructor(private isTouch: () => boolean) {
    this.card = document.getElementById("onboard-card") as HTMLElement;
    this.hintEl = document.getElementById("onboard-hint") as HTMLElement;
    this.howto = document.getElementById("howto") as HTMLElement;
    document.getElementById("open-howto-btn")?.addEventListener("click", () => this.openHowTo());
    this.howto.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", () => this.closeHowTo()));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.howto.classList.contains("hidden")) this.closeHowTo();
    });
    const reset = document.getElementById("howto-reset");
    reset?.addEventListener("click", () => {
      this.stored = { controls: false, hints: [] };
      save(this.stored);
      const msg = document.getElementById("howto-reset-msg");
      if (msg) msg.textContent = t("onboard.tipsReset");
    });
  }

  // Entrée en jeu : carte des contrôles la toute première fois.
  enterGame(now: number): void {
    this.inGame = true;
    if (this.stored.controls) return;
    this.stored.controls = true;
    save(this.stored);
    this.renderCard();
    this.card.classList.remove("hidden");
    this.cardUntil = now + CARD_MS;
  }

  // Sortie de partie (mort, retour au menu) : tout disparaît, la file aussi.
  leaveGame(): void {
    this.inGame = false;
    this.queue.length = 0;
    this.card.classList.add("hidden");
    this.hintEl.classList.remove("show");
    this.cardUntil = 0;
    this.hintUntil = 0;
    this.current = null;
  }

  // Condition remplie pour une indication : montrée une seule fois, après
  // la carte et après l'indication en cours.
  hint(id: HintId): void {
    if (!this.inGame || this.stored.hints.includes(id) || this.queue.includes(id)) return;
    if (URGENT.has(id)) this.queue.unshift(id);
    else this.queue.push(id);
  }

  update(now: number): void {
    if (this.cardUntil && now >= this.cardUntil) this.closeCard();
    const urgent = this.queue.length > 0 && URGENT.has(this.queue[0]);
    if (this.hintUntil && (now >= this.hintUntil || urgent)) this.endHint(now, urgent);
    if (!this.inGame || this.hintUntil) return;
    if (!urgent && (this.cardUntil || now < this.nextHintAt)) return;
    const id = this.queue.shift();
    if (!id) return;
    this.stored.hints.push(id);
    save(this.stored);
    this.current = id;
    this.shownAt = now;
    this.hintEl.textContent = t(HINTS[id][this.isTouch() ? "touch" : "desktop"]);
    this.hintEl.classList.add("show");
    this.hintUntil = now + HINT_MS;
  }

  get cardVisible(): boolean {
    return this.cardUntil > 0;
  }

  private endHint(now: number, interrupted: boolean): void {
    if (interrupted && this.current && now - this.shownAt < MIN_READ_MS) {
      const id = this.current;
      this.stored.hints = this.stored.hints.filter((h) => h !== id);
      save(this.stored);
      this.queue.splice(1, 0, id);
    }
    this.current = null;
    this.hintUntil = 0;
    this.hintEl.classList.remove("show");
    this.nextHintAt = now + HINT_GAP_MS;
  }

  private closeCard(): void {
    this.cardUntil = 0;
    this.card.classList.add("hidden");
  }

  // Contenu de la carte selon l'appareil du moment (tactile ou non).
  private renderCard(): void {
    const rows = CARD_ROWS[this.isTouch() ? "touch" : "desktop"]
      .map(([k, v]) => `<div class="onboard-row"><span class="onboard-key">${t(k)}</span><span>${t(v)}</span></div>`)
      .join("");
    const rules = CARD_RULES.map((r) => `<li>${t(r)}</li>`).join("");
    this.card.innerHTML =
      `<div class="onboard-title">${t("onboard.title")}</div>${rows}<ul class="onboard-rules">${rules}</ul>` +
      `<button type="button" class="onboard-ok">${t("onboard.gotIt")}</button>`;
    this.card.querySelector(".onboard-ok")?.addEventListener("click", () => this.closeCard());
  }

  private openHowTo(): void {
    const msg = document.getElementById("howto-reset-msg");
    if (msg) msg.textContent = "";
    this.howto.classList.remove("hidden");
    this.howto.setAttribute("aria-hidden", "false");
  }

  private closeHowTo(): void {
    this.howto.classList.add("hidden");
    this.howto.setAttribute("aria-hidden", "true");
  }
}
