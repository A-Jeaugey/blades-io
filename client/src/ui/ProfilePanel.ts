import { ProfileGame, ProfileStats } from "@bladeio/shared";
import { auth } from "../auth/supabase";
import { I18nKey, formatNumber, getLang, onLangChange, t } from "../i18n";
import { getLocalStats } from "./localStats";
import { levelText } from "./level";
import { fetchGuestWallet } from "../auth/guestToken";
import { wallet } from "../auth/wallet";
import { ChallengesResponse, ChallengeState } from "@bladeio/shared";
import { challengeText, fetchChallenges, formatCountdown } from "./challenges";
import { LeaderboardView } from "./LeaderboardView";

// Profil joueur (tâche 5.1), depuis le lobby. Compte : statistiques du
// serveur (GET /api/profile/stats). Invité, ou serveur injoignable :
// statistiques gardées dans ce navigateur (ui/localStats.ts).

type Source = "account" | "local" | "fallback";

function locale(): string {
  return getLang() === "fr" ? "fr-FR" : "en-US";
}

function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return t("profile.durS", { s });
  if (s < 3600) return t("profile.durMin", { m: Math.floor(s / 60), s: String(s % 60).padStart(2, "0") });
  return t("profile.durH", { h: Math.floor(s / 3600), m: String(Math.floor((s % 3600) / 60)).padStart(2, "0") });
}

// « il y a 3 heures », « hier »… ; au-delà d'un mois, la date.
function formatWhen(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const sec = Math.round((at - now) / 1000);
  if (sec > -60) return t("profile.justNow");
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
  if (sec > -3600) return rtf.format(Math.round(sec / 60), "minute");
  if (sec > -86400) return rtf.format(Math.round(sec / 3600), "hour");
  if (sec > -30 * 86400) return rtf.format(Math.round(sec / 86400), "day");
  return new Date(at).toLocaleDateString(locale());
}

const count = (n: number) => formatNumber(n, 0);

// Une ligne de défi : texte, récompense, barre et « 12 / 20 » (ou réussi).
function challengeRow(c: ChallengeState): HTMLLIElement {
  const li = document.createElement("li");
  li.className = c.completed ? "challenge done" : "challenge";
  const name = document.createElement("span");
  name.className = "challenge-name";
  name.textContent = challengeText(c);
  const reward = document.createElement("span");
  reward.className = "challenge-reward";
  reward.textContent = `🏆 ${c.reward}`;
  const bar = document.createElement("i");
  bar.className = "challenge-bar";
  bar.style.setProperty("--p", (c.progress / c.target).toFixed(3));
  const progress = document.createElement("span");
  progress.className = "challenge-progress";
  const shown = c.metric === "survivalTotal" || c.metric === "lifeSurvival"
    ? `${Math.floor(c.progress / 60)} / ${Math.round(c.target / 60)} min`
    : `${c.progress} / ${c.target}`;
  progress.textContent = c.completed ? `✓ ${t("profile.challengeDone")}` : shown;
  li.append(name, reward, bar, progress);
  return li;
}

export class ProfilePanel {
  private root: HTMLElement;
  private stats: ProfileStats | null = null;
  private source: Source = "local";
  private loading = false;
  private request = 0;
  private challenges: ChallengesResponse | null = null;
  // Classements (tâche 5.4) : le rail du lobby est masqué sur téléphone.
  private board: LeaderboardView;

  constructor() {
    this.root = document.getElementById("profile") as HTMLElement;
    this.board = new LeaderboardView(this.root.querySelector("#profile-board") as HTMLElement);
    document.getElementById("open-profile-btn")?.addEventListener("click", () => this.open());
    this.root.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", () => this.close()));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.root.classList.contains("hidden")) this.close();
    });
    onLangChange(() => {
      if (this.root.classList.contains("hidden")) return;
      this.render();
      this.renderChallenges();
      this.board.render();
    });
  }

  open(): void {
    this.root.classList.remove("hidden");
    this.root.setAttribute("aria-hidden", "false");
    void this.load();
    void this.loadChallenges();
    void this.board.load();
  }

  // Défis réussis du jour sur le bouton PROFIL (« 1/3 »), relu à chaque
  // retour au lobby.
  async refreshBadge(): Promise<void> {
    const c = await fetchChallenges();
    if (c) this.challenges = c;
    this.renderBadge();
  }

  private renderBadge(): void {
    const badge = document.getElementById("profile-badge");
    if (!badge) return;
    const daily = this.challenges?.day.challenges;
    if (!daily) {
      badge.classList.add("hidden");
      return;
    }
    const done = daily.filter((c) => c.completed).length;
    badge.textContent = `${done}/${daily.length}`;
    badge.classList.toggle("done", done === daily.length);
    badge.classList.remove("hidden");
  }

  private async loadChallenges(): Promise<void> {
    const c = await fetchChallenges();
    if (c) this.challenges = c;
    this.renderChallenges();
    this.renderBadge();
  }

  private renderChallenges(): void {
    const daily = this.root.querySelector("#profile-daily") as HTMLElement;
    const weekly = this.root.querySelector("#profile-weekly") as HTMLElement;
    const section = this.root.querySelector(".profile-challenges") as HTMLElement;
    const c = this.challenges;
    section.classList.toggle("hidden", !c);
    if (!c) return;
    const now = Date.now();
    (this.root.querySelector("#profile-daily-reset") as HTMLElement).textContent =
      t("profile.dailyReset", { time: formatCountdown(Date.parse(c.day.resetsAt) - now) });
    (this.root.querySelector("#profile-weekly-reset") as HTMLElement).textContent =
      t("profile.weeklyReset", { time: formatCountdown(Date.parse(c.week.resetsAt) - now) });
    daily.innerHTML = "";
    for (const ch of c.day.challenges) daily.append(challengeRow(ch));
    weekly.innerHTML = "";
    weekly.append(challengeRow(c.week.challenge));
  }

  close(): void {
    this.request++;
    this.root.classList.add("hidden");
    this.root.setAttribute("aria-hidden", "true");
  }

  private async load(): Promise<void> {
    const id = ++this.request;
    const token = auth.getAccessToken();
    if (!token) {
      this.source = "local";
      this.stats = getLocalStats();
      this.loading = false;
      this.render();
      // Niveau d'un invité : son solde de trophées (il ne dépense rien).
      const g = await fetchGuestWallet();
      if (id !== this.request || !this.stats) return;
      if (g && !g.claimed) {
        this.stats = { ...this.stats, xp: g.balance };
        this.render();
      }
      return;
    }
    this.loading = true;
    this.render();
    let stats: ProfileStats | null = null;
    try {
      const r = await fetch("/api/profile/stats", { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) stats = (await r.json())?.stats ?? null;
    } catch { /* réseau : repli local */ }
    if (id !== this.request) return;
    this.loading = false;
    this.source = stats ? "account" : "fallback";
    // Repli : l'XP du compte reste connue par le portefeuille, s'il a répondu.
    this.stats = stats ?? { ...getLocalStats(), xp: wallet.get()?.total_earned ?? null };
    this.render();
  }

  private render(): void {
    const who = this.root.querySelector("#profile-who") as HTMLElement;
    const grid = this.root.querySelector("#profile-grid") as HTMLElement;
    const level = this.root.querySelector("#profile-level") as HTMLElement;
    const recent = this.root.querySelector("#profile-recent") as HTMLElement;
    const note = this.root.querySelector("#profile-note") as HTMLElement;
    // Connecté, le pseudo, même si le serveur ne répond pas (la note dit
    // alors d'où viennent les chiffres).
    who.textContent = auth.getUsername() ?? t("profile.guest");
    grid.innerHTML = "";
    recent.innerHTML = "";
    level.classList.add("hidden");
    if (this.loading || !this.stats) {
      note.textContent = t("profile.loading");
      return;
    }
    const s = this.stats;
    if (s.xp !== null) {
      const lv = levelText(s.xp);
      (level.querySelector(".profile-level-name") as HTMLElement).textContent = lv.full;
      (level.querySelector(".profile-level-xp") as HTMLElement).textContent = lv.xp;
      (level.querySelector(".profile-level-bar") as HTMLElement).style.setProperty("--p", lv.fraction.toFixed(3));
      level.classList.remove("hidden");
    }
    const tiles: Array<[I18nKey, string, string?]> = [
      ["profile.games", count(s.games)],
      ["profile.kills", count(s.kills)],
      ["profile.bestScore", count(s.bestScore), s.rank !== null ? t("profile.rank", { rank: count(s.rank) }) : undefined],
      ["profile.bestBlades", count(s.bestBlades)],
      ["profile.avgSurvival", formatDuration(s.avgSurvivalSeconds)],
      ["profile.bestSurvival", formatDuration(s.bestSurvivalSeconds)],
      ["profile.crates", count(s.crates)],
      ["profile.powerups", count(s.powerups)],
    ];
    for (const [label, value, sub] of tiles) {
      const tile = document.createElement("div");
      tile.className = "profile-tile";
      const l = document.createElement("span");
      l.className = "profile-tile-label";
      l.textContent = t(label);
      const v = document.createElement("span");
      v.className = "profile-tile-value";
      v.textContent = value;
      tile.append(l, v);
      if (sub) {
        const su = document.createElement("span");
        su.className = "profile-tile-sub";
        su.textContent = sub;
        tile.append(su);
      }
      grid.append(tile);
    }
    this.renderRecent(recent, s.recent);
    const notes: string[] = [t(this.source === "account" ? "profile.noteAccount" : this.source === "local" ? "profile.noteGuest" : "profile.noteFallback")];
    if (s.firstPlayedAt) notes.push(t("profile.since", { date: new Date(s.firstPlayedAt).toLocaleDateString(locale()) }));
    note.textContent = notes.join(" ");
  }

  private renderRecent(root: HTMLElement, games: ProfileGame[]): void {
    if (games.length === 0) {
      const p = document.createElement("p");
      p.className = "profile-empty";
      p.textContent = t("profile.empty");
      root.append(p);
      return;
    }
    const table = document.createElement("table");
    table.className = "profile-recent";
    const head = document.createElement("tr");
    for (const key of ["profile.colWhen", "profile.colScore", "profile.colKills", "profile.colBlades", "profile.colSurvival"] as I18nKey[]) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = t(key);
      head.append(th);
    }
    table.append(head);
    const now = Date.now();
    for (const g of games) {
      const tr = document.createElement("tr");
      for (const text of [formatWhen(g.at, now), count(g.score), count(g.kills), count(g.maxBlades), formatDuration(g.survivalSeconds)]) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.append(td);
      }
      table.append(tr);
    }
    root.append(table);
  }
}
