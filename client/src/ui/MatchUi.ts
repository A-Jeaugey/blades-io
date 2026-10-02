import { MatchEndEvent, MatchPhase, MatchStanding, ROUND_SHRINK_MS } from "@bladeio/shared";
import { formatNumber, onLangChange, t } from "../i18n";

// Partie qui a une fin (manches, tâche 7.1) : minuterie en haut de l'écran
// et podium de fin. Générique : un mode dont la partie a une échéance
// (ArenaState.phaseEndsAt) a sa minuterie, un mode qui finit a son podium
// (évènement matchEnd) ; l'arène sans fin n'affiche ni l'un ni l'autre.

function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function span(className: string, text: string): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = className;
  el.textContent = text;
  return el;
}

export class MatchUi {
  private readonly timer = document.getElementById("match-timer") as HTMLElement;
  private readonly podium = document.getElementById("podium") as HTMLElement;
  private readonly steps = document.getElementById("podium-steps") as HTMLElement;
  private readonly me = document.getElementById("podium-me") as HTMLElement;
  private readonly next = document.getElementById("podium-next") as HTMLElement;
  private shown: MatchEndEvent | null = null;
  private myId = "";
  private shrinking = false;
  private timerText = "";
  private nextText = "";

  constructor(onMenu: () => void) {
    document.getElementById("podium-menu")?.addEventListener("click", onMenu);
    onLangChange(() => {
      this.timerText = "";
      this.nextText = "";
      if (this.shown) this.renderPodium();
    });
  }

  get podiumShown(): boolean {
    return this.shown !== null;
  }

  // À chaque image. Renvoie true à l'image où l'arène commence à se
  // resserrer (dernière minute), pour l'annonce.
  update(phase: number, endsAt: number, serverNow: number): boolean {
    let shrinkStarts = false;
    let label: string | null = null;
    const left = endsAt - serverNow;
    if (phase === MatchPhase.Playing && endsAt > 0) {
      const shrinking = left <= ROUND_SHRINK_MS;
      if (shrinking && !this.shrinking && left > 0) shrinkStarts = true;
      this.shrinking = shrinking;
      label = t(shrinking ? "match.shrinking" : "match.timer");
    } else if (phase === MatchPhase.Over && endsAt > 0 && !this.shown) {
      // Arrivée pendant l'entracte, sans podium : la reprise.
      label = t("match.nextShort");
    }
    if (label !== null) {
      const time = clock(left);
      const text = `${label} · ${time}`;
      if (text !== this.timerText) {
        this.timerText = text;
        // Libellé masqué sur téléphone : le temps seul tient entre l'état du
        // joueur et la minimap.
        this.timer.replaceChildren(span("mt-label", `${label} · `), span("mt-time", time));
        this.timer.setAttribute("aria-label", text);
        this.timer.classList.toggle("urgent", phase === MatchPhase.Playing && this.shrinking);
        this.timer.classList.remove("hidden");
      }
    } else if (this.timerText) {
      this.timerText = "";
      this.timer.classList.add("hidden");
    }
    if (this.shown) {
      const text = t("match.next", { s: Math.max(0, Math.ceil((this.shown.nextAt - serverNow) / 1000)) });
      if (text !== this.nextText) {
        this.nextText = text;
        this.next.textContent = text;
      }
    }
    return shrinkStarts;
  }

  showPodium(ev: MatchEndEvent, myId: string): void {
    this.shown = ev;
    this.myId = myId;
    this.nextText = "";
    this.renderPodium();
    this.podium.classList.remove("hidden");
  }

  hidePodium(): void {
    this.shown = null;
    this.podium.classList.add("hidden");
  }

  // Retour au menu : plus de minuterie ni de podium.
  reset(): void {
    this.hidePodium();
    this.timerText = "";
    this.shrinking = false;
    this.timer.classList.add("hidden");
  }

  private renderPodium(): void {
    const ev = this.shown;
    if (!ev) return;
    const top = ev.standings.slice(0, 3);
    // Marches dans l'ordre visuel : 2e, 1er, 3e.
    const order = [1, 0, 2].filter((i) => i < top.length);
    this.steps.replaceChildren(...order.map((i) => this.step(top[i], i)));
    const rank = ev.standings.findIndex((s) => s.id === this.myId);
    if (rank < 0) {
      this.me.textContent = "";
      return;
    }
    const s = ev.standings[rank];
    let text = t("match.me", {
      rank: rank + 1,
      total: ev.standings.length,
      points: formatNumber(s.score, 0),
      kills: s.kills,
      blades: s.bestBlades,
    });
    if (s.bonus > 0) text += ` · ${t("match.bonus", { n: formatNumber(s.bonus, 0) })}`;
    this.me.textContent = text;
  }

  private step(s: MatchStanding, rank: number): HTMLLIElement {
    const li = document.createElement("li");
    li.className = `podium-step podium-step-${rank + 1}${s.id === this.myId ? " is-me" : ""}`;
    li.append(span("podium-rank", String(rank + 1)), span("podium-name", s.name));
    // Mention BOT sous le pseudo : à côté, elle débordait des marches étroites.
    if (s.bot) li.append(span("lb-bot", t("hud.bot")));
    li.append(
      span("podium-points", t("match.points", { n: formatNumber(s.score, 0) })),
      span("podium-kills", t("match.kills", { n: s.kills })),
    );
    return li;
  }
}
