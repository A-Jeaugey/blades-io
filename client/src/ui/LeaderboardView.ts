import { LEADERBOARD_PERIODS, LeaderboardPeriod, LeaderboardResponse, seasonAt } from "@bladeio/shared";
import { auth } from "../auth/supabase";
import { formatNumber, t } from "../i18n";
import { formatCountdown } from "./challenges";

// Classements du jour, de la semaine, de la saison et de tous les temps
// (tâche 5.4) : onglets, dix premiers, rang du joueur connecté et fin de la
// saison. Le même composant sert au rail du lobby et au profil (le rail est
// masqué sur téléphone).

const STORAGE_KEY = "blade.lbPeriod";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function savedPeriod(): LeaderboardPeriod {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && (LEADERBOARD_PERIODS as readonly string[]).includes(v)) return v as LeaderboardPeriod;
  } catch { /* stockage indisponible */ }
  return "season";
}

export class LeaderboardView {
  private period: LeaderboardPeriod = savedPeriod();
  private data: LeaderboardResponse | null = null;
  private failed = false;
  private request = 0;
  private loaded = false;
  private rendered = false;

  // root contient : [data-period] (onglets), ol.bio2-lb, .lb-me, .lb-season.
  constructor(private root: HTMLElement, private limit = 10) {
    root.querySelectorAll<HTMLButtonElement>("[data-period]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.period = btn.dataset.period as LeaderboardPeriod;
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
    try {
      const r = await fetch(`/api/leaderboard?period=${this.period}&limit=${this.limit}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) throw new Error(String(r.status));
      const data = (await r.json()) as LeaderboardResponse;
      if (id !== this.request) return;
      this.data = data;
      this.failed = false;
    } catch {
      if (id !== this.request) return;
      // Pas de rang ni de saison d'une autre période sous « indisponible ».
      this.data = null;
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
    const me = this.root.querySelector(".lb-me") as HTMLElement | null;
    const season = this.root.querySelector(".lb-season") as HTMLElement | null;
    const d = this.data;
    if (season) {
      // Saison du serveur ; calculée ici si le classement est injoignable.
      const local = d ? null : seasonAt(new Date());
      const n = d ? d.season.number : local!.number;
      const left = (d ? Date.parse(d.season.endsAt) : local!.endsAt.getTime()) - Date.now();
      season.textContent = n > 0
        ? t("lobby.seasonEnds", { n, time: formatCountdown(left) })
        : t("lobby.seasonStarts", { time: formatCountdown(left) });
    }
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
}

function row(rank: string, nameHtml: string, score: string, cls = ""): string {
  return `<li class="bio2-lb-row ${cls}"><span class="bio2-lb-rank">${rank}</span><span class="bio2-lb-name">${nameHtml}</span><span class="bio2-lb-score">${score}</span></li>`;
}
