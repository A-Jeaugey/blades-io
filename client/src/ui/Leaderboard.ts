export interface LeaderboardEntry {
  id: string;
  name: string;
  score: number;
  bladeCount: number;
}

export class Leaderboard {
  private root: HTMLElement;
  private lastUpdate = 0;

  constructor() {
    this.root = document.getElementById("leaderboard")!;
    this.root.innerHTML = `<h4>TROPHÉES</h4><div id="lb-rows"></div>`;
  }

  // Classement compact (tâche 3.4) : les cinq premiers et soi, avec score et
  // lames. Avant, dix lignes à trois colonnes occupaient près de la moitié
  // de l'écran d'un téléphone en portrait.
  update(entries: LeaderboardEntry[], myId: string, now: number): void {
    if (now - this.lastUpdate < 500) return;
    this.lastUpdate = now;
    const sorted = [...entries].sort((a, b) => b.score - a.score);
    const top = sorted.slice(0, TOP_ROWS);
    const rows = document.getElementById("lb-rows")!;
    let html = "";
    for (let i = 0; i < top.length; i++) html += row(top[i], i, top[i].id === myId);
    const myRank = sorted.findIndex((e) => e.id === myId);
    if (myRank >= TOP_ROWS) html += row(sorted[myRank], myRank, true);
    rows.innerHTML = html;
  }
}

const TOP_ROWS = 5;

function row(e: LeaderboardEntry, rank: number, me: boolean): string {
  const crown = rank === 0 ? " 👑" : "";
  return `<div class="${me ? "lb-row me" : "lb-row"}">
    <span class="name">${rank + 1}. ${escapeHtml(e.name)}${crown}</span>
    <div class="lb-stat"><span class="icon">🏆</span><span class="val">${e.score}</span></div>
    <div class="lb-stat"><span class="icon">🗡️</span><span class="val">${e.bladeCount}</span></div>
  </div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
