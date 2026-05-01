// Full-screen modal opened from the main menu, exposing the two
// public leaderboards (best score / most coins). Lazily fetches each tab
// on first open and caches the result for the lifetime of the page.

type Tab = "score" | "coins";

interface ScoreEntry {
  user_id: string;
  username: string;
  score: number;
  kills: number;
  max_blades: number;
  games_played: number;
}
interface CoinsEntry {
  user_id: string;
  username: string;
  balance: number;
  total_earned: number;
}

export class LeaderboardsModal {
  private root: HTMLElement;
  private body: HTMLElement;
  private tabBtns: Map<Tab, HTMLButtonElement> = new Map();
  private cache: Partial<Record<Tab, string>> = {};
  private active: Tab = "score";

  constructor() {
    this.root = document.getElementById("leaderboards-modal")!;
    this.body = document.getElementById("leaderboards-body")!;
    this.tabBtns.set("score", document.getElementById("lb-tab-score") as HTMLButtonElement);
    this.tabBtns.set("coins", document.getElementById("lb-tab-coins") as HTMLButtonElement);
    this.tabBtns.forEach((btn, tab) => {
      btn.addEventListener("click", () => this.setTab(tab));
    });
    document.getElementById("lb-modal-close")?.addEventListener("click", () => this.hide());
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root) this.hide();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.root.classList.contains("hidden")) this.hide();
    });
  }

  show(): void {
    this.root.classList.remove("hidden");
    this.setTab(this.active);
  }
  hide(): void {
    this.root.classList.add("hidden");
  }

  private setTab(tab: Tab): void {
    this.active = tab;
    this.tabBtns.forEach((btn, t) => btn.classList.toggle("active", t === tab));
    if (this.cache[tab]) {
      this.body.innerHTML = this.cache[tab]!;
      return;
    }
    this.body.innerHTML = `<div class="lb-modal-empty">loading…</div>`;
    void this.fetchTab(tab);
  }

  private async fetchTab(tab: Tab): Promise<void> {
    try {
      const url = tab === "score" ? "/api/leaderboards/score?limit=100" : "/api/leaderboards/coins?limit=100";
      const r = await fetch(url);
      if (!r.ok) {
        this.body.innerHTML = `<div class="lb-modal-empty">unavailable (status ${r.status})</div>`;
        return;
      }
      const j = await r.json();
      const entries = (j.entries ?? []) as Array<ScoreEntry | CoinsEntry>;
      if (this.active !== tab) return; // user switched away
      const html = renderTable(tab, entries);
      this.cache[tab] = html;
      this.body.innerHTML = html;
    } catch (e) {
      this.body.innerHTML = `<div class="lb-modal-empty">network error</div>`;
      console.warn("[blade.io] leaderboard fetch failed", e);
    }
  }
}

function renderTable(tab: Tab, entries: Array<ScoreEntry | CoinsEntry>): string {
  if (entries.length === 0) {
    return `<div class="lb-modal-empty">no entries yet — be the first 🏆</div>`;
  }
  const rows = entries
    .map((e, i) => {
      const rank = String(i + 1).padStart(2, "0");
      const tier = i === 0 ? "lg" : i < 3 ? "ep" : i < 10 ? "ra" : "co";
      if (tab === "score") {
        const s = e as ScoreEntry;
        return `<tr class="bio2-tier-${tier}">
          <td class="lb-rank">${rank}</td>
          <td class="lb-name">${escapeHtml(s.username ?? "?")}</td>
          <td class="lb-num">${formatNum(s.score)}</td>
          <td class="lb-num lb-sub">${s.kills}</td>
          <td class="lb-num lb-sub">${s.games_played}</td>
        </tr>`;
      }
      const c = e as CoinsEntry;
      return `<tr class="bio2-tier-${tier}">
        <td class="lb-rank">${rank}</td>
        <td class="lb-name">${escapeHtml(c.username ?? "?")}</td>
        <td class="lb-num">${formatNum(c.total_earned)}</td>
        <td class="lb-num lb-sub">${formatNum(c.balance)}</td>
      </tr>`;
    })
    .join("");
  const head = tab === "score"
    ? `<tr><th></th><th>OPERATOR</th><th>SCORE</th><th>KILLS</th><th>GAMES</th></tr>`
    : `<tr><th></th><th>OPERATOR</th><th>EARNED</th><th>BALANCE</th></tr>`;
  return `<table class="lb-modal-table"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
}

function formatNum(n: number): string {
  if (n == null) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + "M";
  if (n >= 10_000) return Math.floor(n / 1_000) + "k";
  return String(Math.floor(n));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
