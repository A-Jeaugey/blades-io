import {
  SCORE_KILL,
  SCORE_BLADE,
  SCORE_SURVIVAL_PTS,
  SCORE_SURVIVAL_INTERVAL,
  SCORE_CRATE,
  SCORE_POWERUP,
} from "@bladeio/shared";

export interface DeathStats {
  lifeSeconds: number;
  maxBlades: number;
  kills: number;
  rank: number;
  score: number;
  cratesDestroyed: number;
  powerupsCollected: number;
  killerName?: string | null;
}

export class DeathScreen {
  private root: HTMLElement;
  private stats: HTMLElement;
  private respawn: HTMLButtonElement;
  private back: HTMLButtonElement;

  constructor(onRespawn: () => void, onBackToMenu: () => void) {
    this.root = document.getElementById("death-screen")!;
    this.stats = document.getElementById("death-stats")!;
    this.respawn = document.getElementById("respawn-btn") as HTMLButtonElement;
    this.back = document.getElementById("back-menu-btn") as HTMLButtonElement;
    this.respawn.addEventListener("click", onRespawn);
    this.back.addEventListener("click", onBackToMenu);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.root.classList.contains("hidden")) {
        onBackToMenu();
      }
    });
  }

  show(s: DeathStats): void {
    const killedBy = s.killerName ? `<div class="row"><span class="label">killed by</span><span>${escapeHtml(s.killerName)}</span></div>` : "";

    this.stats.innerHTML = `
      <div class="score-total-container">
        <div class="score-total">🏆 ${s.score}</div>
        <div class="score-sub">💀 ${s.kills} &nbsp;&nbsp;&nbsp; 🗡️ ${s.maxBlades}</div>
      </div>
      <div class="row rank-row"><span class="label">rank</span><span>#${s.rank}</span></div>
      ${killedBy}
    `;
    this.root.classList.remove("hidden");
  }
  hide(): void {
    this.root.classList.add("hidden");
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
