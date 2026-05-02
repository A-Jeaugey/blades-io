export interface LeaderboardEntry {
  id: string;
  name: string;
  score: number;
  kills: number;
  bladeCount: number;
}

export class Leaderboard {
  private root: HTMLElement;
  private lastUpdate = 0;

  constructor() {
    this.root = document.getElementById("leaderboard")!;
    this.root.innerHTML = `<h4>TROPHÉES</h4><div id="lb-rows"></div>`;
  }

  update(entries: LeaderboardEntry[], myId: string, now: number): void {
    if (now - this.lastUpdate < 500) return;
    this.lastUpdate = now;
    const sorted = [...entries].sort((a, b) => b.score - a.score);
    // Sur petit écran, on tronque à 5 entrées : la liste à 10 lignes occupait
    // près de la moitié de la zone de jeu en portrait.
    const maxRows = window.innerWidth <= 600 ? 5 : 10;
    const top = sorted.slice(0, maxRows);
    const rows = document.getElementById("lb-rows")!;
    let html = "";
    for (let i = 0; i < top.length; i++) {
      const e = top[i];
      const cls = e.id === myId ? "lb-row me" : "lb-row";
      const crown = i === 0 ? " 👑" : "";
      html += `<div class="${cls}">
        <span class="name">${i + 1}. ${escapeHtml(e.name)}${crown}</span>
        <div class="lb-stat"><span class="icon">🏆</span><span class="val">${e.score}</span></div>
        <div class="lb-stat"><span class="icon">💀</span><span class="val">${e.kills}</span></div>
        <div class="lb-stat"><span class="icon">🗡️</span><span class="val">${e.bladeCount}</span></div>
      </div>`;
    }
    const myRank = sorted.findIndex((e) => e.id === myId);
    if (myRank >= maxRows) {
      const me = sorted[myRank];
      html += `<div class="lb-row me">
        <span class="name">${myRank + 1}. ${escapeHtml(me.name)}</span>
        <div class="lb-stat"><span class="icon">🏆</span><span class="val">${me.score}</span></div>
        <div class="lb-stat"><span class="icon">💀</span><span class="val">${me.kills}</span></div>
        <div class="lb-stat"><span class="icon">🗡️</span><span class="val">${me.bladeCount}</span></div>
      </div>`;
    }
    rows.innerHTML = html;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
