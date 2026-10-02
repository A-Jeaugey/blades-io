import { TEAM_NONE } from "@bladeio/shared";
import { I18nKey, onLangChange, t } from "../i18n";
import { ALLY_MARK } from "./MatchUi";

// État des deux drapeaux (capture du drapeau, tâche 7.2), sous la
// minuterie : le sien (◆) à gauche, celui d'en face à droite. Le sien
// emporté passe en alerte.

export interface FlagStatus {
  team: number;
  carrierId: string;
  atBase: boolean;
  // Heure du serveur du retour automatique d'un drapeau à terre.
  returnsAt: number;
}

type Tone = "calm" | "good" | "alert";

export class FlagHud {
  private readonly root = document.getElementById("flag-status") as HTMLElement;
  private readonly mine = this.root.querySelector(".fs-mine") as HTMLElement;
  private readonly theirs = this.root.querySelector(".fs-theirs") as HTMLElement;
  private text = "";

  constructor() {
    onLangChange(() => { this.text = ""; });
  }

  update(flags: FlagStatus[], myTeam: number, myId: string, serverNow: number): void {
    const own = flags.find((f) => f.team === myTeam);
    const other = flags.find((f) => f.team !== myTeam);
    if (myTeam === TEAM_NONE || !own || !other) {
      this.hide();
      return;
    }
    const a = this.describe(own, true, myId, serverNow);
    const b = this.describe(other, false, myId, serverNow);
    const text = `${a.text}|${a.tone}|${b.text}|${b.tone}`;
    if (text === this.text) return;
    this.text = text;
    this.fill(this.mine, `${ALLY_MARK} ${t("flag.mine")}`, a.text, a.tone);
    this.fill(this.theirs, t("flag.theirs"), b.text, b.tone);
    this.root.classList.remove("hidden");
  }

  hide(): void {
    if (this.text === "" && this.root.classList.contains("hidden")) return;
    this.text = "";
    this.root.classList.add("hidden");
  }

  private describe(f: FlagStatus, own: boolean, myId: string, serverNow: number): { text: string; tone: Tone } {
    if (f.atBase) return { text: t("flag.home"), tone: "calm" };
    if (f.carrierId) {
      if (own) return { text: t("flag.taken"), tone: "alert" };
      return { text: t(f.carrierId === myId ? "flag.you" : "flag.carried"), tone: "good" };
    }
    const s = Math.max(0, Math.ceil((f.returnsAt - serverNow) / 1000));
    return { text: t("flag.down", { s }), tone: own ? "alert" : "good" };
  }

  private fill(el: HTMLElement, label: string, state: string, tone: Tone): void {
    const l = document.createElement("span");
    l.className = "fs-label";
    l.textContent = `${label} `;
    const v = document.createElement("span");
    v.className = "fs-state";
    v.textContent = `⚑ ${state}`;
    el.replaceChildren(l, v);
    el.dataset.tone = tone;
  }
}

export const FLAG_FEED_KEYS = {
  take: ["flag.feed.takeMine", "flag.feed.takeTheirs"],
  drop: ["flag.feed.dropMine", "flag.feed.dropTheirs"],
  return: ["flag.feed.returnMine", "flag.feed.returnTheirs"],
  home: ["flag.feed.homeMine", "flag.feed.homeTheirs"],
  capture: ["flag.feed.captureThem", "flag.feed.captureUs"],
} satisfies Record<string, [I18nKey, I18nKey]>;
