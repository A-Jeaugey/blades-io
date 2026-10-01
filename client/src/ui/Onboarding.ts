// Onboarding (tâche 3.1) : carte des contrôles à la première entrée en jeu,
// indications contextuelles uniques pendant les premières parties, page
// « How to play » depuis le lobby. Tout est mémorisé localement : une
// indication déjà vue ne revient pas (sauf remise à zéro depuis la page).
//
// Textes en anglais, comme le reste de l'interface en jeu, et regroupés ici
// pour l'internationalisation (tâche 3.7).

export type HintId = "throw" | "boost" | "border" | "bush";

const TEXT = {
  cardTitle: "HOW TO PLAY",
  gotIt: "GOT IT",
  desktop: [
    ["MOVE", "Mouse, or WASD"],
    ["AIM", "Cursor (also with WASD)"],
    ["THROW", "Right-click or SPACE"],
    ["BOOST", "Left-click or SHIFT · burns blades"],
  ],
  touch: [
    ["MOVE", "Left stick"],
    ["THROW", "Tap THROW · drag from it to aim"],
    ["BOOST", "Hold BOOST · burns blades"],
  ],
  rules: [
    "Your blades break enemy blades. A blade touching a body kills.",
    "Grab loose blades to grow. Throwing and boosting spend them.",
    "The red edge of the arena is deadly.",
  ],
  hints: {
    throw: {
      desktop: "Enemy in range! THROW with right-click or SPACE: the blade flies toward your cursor.",
      touch: "Enemy in range! Tap THROW, or drag from it to aim.",
    },
    boost: {
      desktop: "Hold left-click or SHIFT to BOOST. It burns 1 blade every 0.5 s.",
      touch: "Hold BOOST to sprint. It burns 1 blade every 0.5 s.",
    },
    border: {
      desktop: "The red edge kills. Turn back!",
      touch: "The red edge kills. Turn back!",
    },
    bush: {
      desktop: "Inside a bush, other players can't see you.",
      touch: "Inside a bush, other players can't see you.",
    },
  } as Record<HintId, { desktop: string; touch: string }>,
  tipsReset: "Tips will show again in your next game.",
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
      if (msg) msg.textContent = TEXT.tipsReset;
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
    this.hintEl.textContent = TEXT.hints[id][this.isTouch() ? "touch" : "desktop"];
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
    const rows = (this.isTouch() ? TEXT.touch : TEXT.desktop)
      .map(([k, v]) => `<div class="onboard-row"><span class="onboard-key">${k}</span><span>${v}</span></div>`)
      .join("");
    const rules = TEXT.rules.map((r) => `<li>${r}</li>`).join("");
    this.card.innerHTML =
      `<div class="onboard-title">${TEXT.cardTitle}</div>${rows}<ul class="onboard-rules">${rules}</ul>` +
      `<button type="button" class="onboard-ok">${TEXT.gotIt}</button>`;
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
