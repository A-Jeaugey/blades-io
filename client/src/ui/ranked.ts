import { GameModeId, RankInfo, RankedMeResponse, isRankedMode, rankOf } from "@bladeio/shared";
import { auth } from "../auth/supabase";
import { I18nKey, formatNumber, onLangChange, t } from "../i18n";

// Mode classé, côté client : emblèmes des rangs, rang du joueur connecté
// (lobby, profil) et lecture de GET /api/ranked/me.

const ROMAN = ["", "I", "II", "III"];

// « OR II », « MAÎTRE ».
export function rankLabel(info: RankInfo): string {
  const name = t(`rank.${info.tier}` as I18nKey);
  return info.division > 0 ? `${name} ${ROMAN[info.division]}` : name;
}

export function prText(pr: number): string {
  return t("ranked.pr", { n: formatNumber(pr, 0) });
}

// Emblème d'un rang : une forme par rang (rond, carré, écu, hexagone,
// losange, étoile) et le chiffre de la division, en plus de la couleur
// (tâche 3.8 : jamais la couleur seule). Couleurs des raretés du thème
// (styles.css).
export function rankEmblem(info: RankInfo, large = false): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = `rank-emblem rank-${info.tier}${large ? " rank-emblem-lg" : ""}`;
  el.setAttribute("aria-hidden", "true");
  const b = document.createElement("b");
  b.textContent = ROMAN[info.division] ?? "";
  el.append(b);
  return el;
}

// Même emblème en HTML, pour les listes construites en chaîne (classements).
export function rankEmblemHtml(info: RankInfo): string {
  return `<span class="rank-emblem rank-${info.tier}" aria-hidden="true"><b>${ROMAN[info.division] ?? ""}</b></span>`;
}

// Rang du joueur connecté : null sans session, "offline" si le serveur ou la
// base ne répondent pas (migration absente comprise).
export async function fetchRankedMe(): Promise<RankedMeResponse | null | "offline"> {
  const token = auth.getAccessToken();
  if (!token) return null;
  try {
    const r = await fetch("/api/ranked/me", { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 401) return null;
    if (!r.ok) return "offline";
    return (await r.json()) as RankedMeResponse;
  } catch {
    return "offline";
  }
}

// Lobby : rang du joueur connecté à côté de ses trophées, et, mode classé
// choisi sans compte, l'invitation à se connecter.
export class RankedLobby {
  private readonly badge = document.getElementById("ranked-badge");
  private readonly note = document.getElementById("ranked-note");
  private me: RankedMeResponse | null | "offline" = null;
  private gameMode: GameModeId | undefined;
  private request = 0;

  constructor() {
    let token = auth.getAccessToken();
    auth.subscribe(() => {
      const next = auth.getAccessToken();
      if (next === token) return;
      token = next;
      void this.refresh();
    });
    onLangChange(() => this.render());
  }

  // Mode choisi au sélecteur (undefined : aucun à choisir).
  setGameMode(mode: GameModeId | undefined): void {
    this.gameMode = mode;
    this.render();
  }

  async refresh(): Promise<void> {
    const id = ++this.request;
    const me = await fetchRankedMe();
    if (id !== this.request) return;
    this.me = me;
    this.render();
  }

  private render(): void {
    const signedIn = auth.getAccessToken() !== null;
    // Sans comptes sur ce serveur (Supabase absent), rien à proposer.
    const invite = !signedIn && auth.isConfigured() && !!this.gameMode && isRankedMode(this.gameMode);
    this.note?.classList.toggle("hidden", !invite);
    if (!this.badge) return;
    const me = this.me;
    if (!signedIn || !me || me === "offline") {
      this.badge.classList.add("hidden");
      return;
    }
    const info = rankOf(me.pr);
    const name = document.createElement("b");
    name.textContent = rankLabel(info);
    const value = document.createElement("span");
    value.className = "bio2-ranked-val";
    value.textContent = prText(me.pr);
    this.badge.replaceChildren(rankEmblem(info), name, value);
    const title = t("ranked.badgeTitle", { season: me.season.number, games: me.games, best: formatNumber(me.best, 0) });
    this.badge.title = title;
    this.badge.classList.remove("hidden");
  }
}

// Profil : rang, PR, avancée dans la division, manches et place de la
// saison ; invitation à se connecter pour un invité.
export class RankedProfile {
  private me: RankedMeResponse | null | "offline" = null;
  private loaded = false;
  private request = 0;

  constructor(private readonly root: HTMLElement | null) {}

  async load(): Promise<void> {
    const id = ++this.request;
    const me = await fetchRankedMe();
    if (id !== this.request) return;
    this.me = me;
    this.loaded = true;
    this.render();
  }

  render(): void {
    const root = this.root;
    if (!root || !this.loaded) return;
    root.classList.remove("hidden");
    const title = root.querySelector(".profile-ranked-title") as HTMLElement;
    const body = root.querySelector(".profile-ranked-body") as HTMLElement;
    const me = this.me;
    const p = (cls: string, text: string) => {
      const el = document.createElement("p");
      el.className = cls;
      el.textContent = text;
      return el;
    };
    if (!me || me === "offline") {
      title.textContent = t("profile.rankedTitle");
      // Sans comptes sur ce serveur (Supabase absent), pas d'invitation.
      const offline = me === "offline" || !auth.isConfigured();
      body.replaceChildren(p("profile-note", t(offline ? "profile.rankedOffline" : "profile.rankedGuest")));
      return;
    }
    title.textContent = t("profile.rankedSeason", { n: me.season.number });
    const info = rankOf(me.pr);
    const head = document.createElement("div");
    head.className = "profile-ranked-head";
    const name = document.createElement("span");
    name.className = "profile-ranked-name";
    name.textContent = rankLabel(info);
    const pr = document.createElement("span");
    pr.className = "profile-ranked-pr";
    pr.textContent = prText(me.pr);
    const bar = document.createElement("i");
    bar.className = "profile-ranked-bar";
    bar.style.setProperty("--p", info.progress.toFixed(3));
    head.append(rankEmblem(info, true), name, pr, bar);
    const lines: HTMLElement[] = [head];
    if (info.next !== null) {
      lines.push(p("profile-ranked-next", t("profile.rankedNext", { n: formatNumber(info.next - me.pr, 0), rank: rankLabel(rankOf(info.next)) })));
    }
    lines.push(p("profile-note", me.games > 0
      ? t("profile.rankedStats", { games: me.games, best: formatNumber(me.best, 0) }) + (me.rank !== null ? ` · ${t("profile.rankedPlace", { rank: me.rank })}` : "")
      : t("profile.rankedNoGames", { pr: prText(me.pr) })));
    body.replaceChildren(...lines);
  }
}
