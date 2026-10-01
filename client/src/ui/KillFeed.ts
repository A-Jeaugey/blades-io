import { KillCause } from "@bladeio/shared";
import { t } from "../i18n";

// Fil des éliminations (tâche 3.4) : les dernières morts de la room, quatre
// lignes au plus, chacune 4 s. Les lignes qui concernent le joueur local
// (il a tué, il est mort) ressortent en couleur.

const MAX_LINES = 4;
const LINE_MS = 4000;
const FADE_MS = 400;

const ICON: Record<KillCause, string> = {
  blades: "⚔",
  throw: "➶",
  wall: "⚡",
};

export interface KillFeedEntry {
  killerName: string | null;
  victimName: string;
  cause: KillCause;
  // Rôle du joueur local dans cette élimination, s'il y en a un.
  mine: "killer" | "victim" | null;
  // Prime du leader versée au tueur, kill contre plus gros (tâche 4.2).
  bounty?: number;
  underdog?: boolean;
}

interface Line {
  el: HTMLDivElement;
  until: number;
}

function span(cls: string, text: string): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = cls;
  el.textContent = text;
  return el;
}

export class KillFeed {
  private root: HTMLElement;
  private lines: Line[] = [];

  constructor() {
    this.root = document.getElementById("kill-feed") as HTMLElement;
  }

  push(e: KillFeedEntry, now: number): void {
    const el = document.createElement("div");
    el.className = e.mine ? `kf-line kf-${e.mine}` : "kf-line";
    // Noms en textContent : ce sont des pseudos de joueurs.
    if (e.cause === "wall" || !e.killerName) {
      el.append(span("kf-name", e.victimName), span("kf-icon", ICON.wall), span("kf-border", t("feed.border")));
    } else {
      el.append(span("kf-name", e.killerName), span("kf-icon", ICON[e.cause] ?? ICON.blades), span("kf-name", e.victimName));
      if (e.bounty) el.append(span("kf-bounty", `👑 +${e.bounty}`));
      if (e.underdog) el.append(span("kf-underdog", t("feed.underdog")));
    }
    this.root.appendChild(el);
    this.lines.push({ el, until: now + LINE_MS });
    while (this.lines.length > MAX_LINES) this.lines.shift()!.el.remove();
  }

  update(now: number): void {
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const line = this.lines[i];
      const left = line.until - now;
      if (left <= 0) {
        line.el.remove();
        this.lines.splice(i, 1);
      } else if (left < FADE_MS) {
        line.el.style.opacity = (left / FADE_MS).toFixed(2);
      }
    }
  }

  clear(): void {
    for (const line of this.lines) line.el.remove();
    this.lines.length = 0;
  }
}
