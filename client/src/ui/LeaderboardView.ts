import { LEADERBOARD_PERIODS, LeaderboardPeriod, LeaderboardResponse, RankedBoardResponse, rankOf, seasonAt } from "@bladeio/shared";
import { auth } from "../auth/supabase";
import { formatNumber, t } from "../i18n";
import { formatCountdown } from "./challenges";
import { prText, rankEmblemHtml, rankLabel } from "./ranked";

// Classements du jour, de la semaine, de la saison et de tous les temps
// (tâche 5.4) : onglets, dix premiers, rang du joueur connecté et fin de la
// saison. Le même composant sert au rail du lobby et au profil (le rail est
// masqué sur téléphone).

const STORAGE_KEY = "blade.lbPeriod";

// Onglet CLASSÉ : les points de rang de la saison (mode classé), à côté des
// meilleurs scores.
type BoardTab = LeaderboardPeriod | "ranked";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function savedPeriod(): BoardTab {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "ranked") return v;
    if (v && (LEADERBOARD_PERIODS as readonly string[]).includes(v)) return v as LeaderboardPeriod;
  } catch { /* stockage indisponible */ }
  return "season";
}

export class LeaderboardView {
  private period: BoardTab = savedPeriod();
  private data: LeaderboardResponse | null = null;
  private ranked: RankedBoardResponse | null = null;
  private failed = false;
  private request = 0;
  private loaded = false;
  private rendered = false;

  // root contient : [data-period] (onglets), ol.bio2-lb, .lb-me, .lb-season.
  constructor(private root: HTMLElement, private limit = 10) {
    root.querySelectorAll<HTMLButtonElement>("[data-period]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.period = btn.dataset.period as BoardTab;
        try { localStorage.setItem(STORAGE_KEY, this.period); } catch { /* idem */ }
        void this.load();
      });
    });
    // Le rang du joueur dépend de la session : recharger quand elle change
    // (session restaurée après le premier chargement, connexion, déconnexion).
    let token = auth.getAccessToken();
    auth.subscribe(() => {
      const next = auth.getAccessToken();
      if (next === token) return;
      token = next;
      if (this.loaded) void this.load();
    });
  }

  async load(): Promise<void> {
    const id = ++this.request;
    this.loaded = true;
    this.renderTabs();
    const token = auth.getAccessToken();
    const ranked = this.period === "ranked";
    try {
      const url = ranked
        ? `/api/ranked/leaderboard?limit=${this.limit}`
        : `/api/leaderboard?period=${this.period}&limit=${this.limit}`;
      const r = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      if (id !== this.request) return;
      this.data = ranked ? null : (data as LeaderboardResponse);
      this.ranked = ranked ? (data as RankedBoardResponse) : null;
      this.failed = false;
    } catch {
      if (id !== this.request) return;
      // Pas de rang ni de saison d'une autre période sous « indisponible ».
      this.data = null;
      this.ranked = null;
      this.failed = true;
    }
    this.render();
  }

  private renderTabs(): void {
    this.root.querySelectorAll<HTMLButtonElement>("[data-period]").forEach((btn) => {
      const on = btn.dataset.period === this.period;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", String(on));
    });
  }

  // Rendu seul (changement de langue).
  render(): void {
    this.renderTabs();
    const list = this.root.querySelector("ol.bio2-lb") as HTMLOListElement;
    // Entrée en cascade au premier affichage seulement : rejouée à chaque
    // onglet, elle laissait la liste vide pendant un tiers de seconde.
    if (this.rendered) list.classList.add("lb-settled");
    this.rendered = true;
    if (this.period === "ranked") {
      this.renderRanked(list);
      return;
    }
    const me = this.root.querySelector(".lb-me") as HTMLElement | null;
    const d = this.data;
    this.renderSeason(d);
    if (me) {
      me.textContent = d?.me ? t("lobby.myRank", { rank: d.me.rank, score: formatNumber(d.me.score, 0) }) : "";
      me.classList.toggle("hidden", !d?.me);
    }
    if (this.failed || !d) {
      list.innerHTML = row("--", escapeHtml(this.failed ? t("lobby.leaderboardOffline") : t("lobby.loading")), "", "lb-msg");
      return;
    }
    if (d.entries.length === 0) {
      list.innerHTML = row("--", escapeHtml(t("lobby.noScores")), "", "lb-msg");
      return;
    }
    const state = auth.getState();
    const self = state.status === "signed_in" ? state.session.user.id : null;
    list.innerHTML = d.entries
      .map((e, i) => {
        const tier = i === 0 ? "lg" : i < 3 ? "ep" : i < 5 ? "ra" : "co";
        const cls = `bio2-tier-${tier}${e.user_id === self ? " lb-self" : ""}`;
        return row(String(i + 1).padStart(2, "0"), escapeHtml(e.username ?? "?"), formatNumber(e.score, 0), cls);
      })
      .join("");
  }

  // Fin de la saison : celle du serveur, calculée ici si le classement est
  // injoignable.
  private renderSeason(d: { season: { number: number; endsAt: string } } | null): void {
    const season = this.root.querySelector(".lb-season") as HTMLElement | null;
    if (!season) return;
    const local = d ? null : seasonAt(new Date());
    const n = d ? d.season.number : local!.number;
    const left = (d ? Date.parse(d.season.endsAt) : local!.endsAt.getTime()) - Date.now();
    season.textContent = n > 0
      ? t("lobby.seasonEnds", { n, time: formatCountdown(left) })
      : t("lobby.seasonStarts", { time: formatCountdown(left) });
  }

  // Onglet CLASSÉ : emblème, pseudo et PR de chaque joueur, sa place, et la
  // saison (la même que celle des scores).
  private renderRanked(list: HTMLOListElement): void {
    const d = this.ranked;
    this.renderSeason(d);
    const me = this.root.querySelector(".lb-me") as HTMLElement | null;
    if (me) {
      me.textContent = d?.me ? t("ranked.myRank", { rank: d.me.rank, pr: prText(d.me.pr) }) : "";
      me.classList.toggle("hidden", !d?.me);
    }
    if (this.failed || !d) {
      list.innerHTML = row("--", escapeHtml(this.failed ? t("lobby.leaderboardOffline") : t("lobby.loading")), "", "lb-msg");
      return;
    }
    if (d.entries.length === 0) {
      list.innerHTML = row("--", escapeHtml(t("ranked.noGames")), "", "lb-msg");
      return;
    }
    const state = auth.getState();
    const self = state.status === "signed_in" ? state.session.user.id : null;
    list.innerHTML = d.entries
      .map((e, i) => {
        const info = rankOf(e.pr);
        const name = `<span class="lb-rank-name" title="${escapeHtml(rankLabel(info))}">${rankEmblemHtml(info)}<span class="lb-rank-n">${escapeHtml(e.username ?? "?")}</span></span>`;
        return row(String(i + 1).padStart(2, "0"), name, escapeHtml(prText(e.pr)), `lb-ranked${e.user_id === self ? " lb-self" : ""}`);
      })
      .join("");
  }
}

function row(rank: string, nameHtml: string, score: string, cls = ""): string {
  return `<li class="bio2-lb-row ${cls}"><span class="bio2-lb-rank">${rank}</span><span class="bio2-lb-name">${nameHtml}</span><span class="bio2-lb-score">${score}</span></li>`;
}
