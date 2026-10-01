export interface LeaderboardEntry {
  id: string;
  name: string;
  score: number;
  bladeCount: number;
  bot?: boolean;
}

// Repliable (tâche 3.6) : sur téléphone, le classement cachait le haut de
// l'écran, d'où arrivent les menaces ; replié par défaut sur les petits
// écrans (le rang et les trophées restent dans le bloc d'état). Le choix du
// joueur est retenu.
const COLLAPSED_KEY = "blade.lbCollapsed";
const SMALL_SCREEN = "(max-width: 600px), (max-height: 500px)";

export class Leaderboard {
  private root: HTMLElement;
  private toggle: HTMLButtonElement;
  private lastUpdate = 0;
  private collapsed = false;

  constructor() {
    this.root = document.getElementById("leaderboard")!;
    this.root.innerHTML = `<button type="button" id="lb-toggle" class="lb-head" aria-controls="lb-rows">
      <span>TROPHÉES</span><span class="lb-caret" aria-hidden="true">▾</span>
    </button><div id="lb-rows"></div>`;
    this.toggle = this.root.querySelector<HTMLButtonElement>("#lb-toggle")!;
    this.setCollapsed(initiallyCollapsed());
    // Tout le panneau bascule (cible tactile plus grande que l'en-tête) ;
    // le bouton reste pour le clavier, son clic remonte jusqu'ici.
    this.root.addEventListener("click", () => {
      this.setCollapsed(!this.collapsed);
      try {
        localStorage.setItem(COLLAPSED_KEY, this.collapsed ? "1" : "0");
      } catch {
        // Stockage indisponible : le choix vaut pour la session.
      }
    });
  }

  private setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.root.classList.toggle("collapsed", collapsed);
    this.toggle.setAttribute("aria-expanded", String(!collapsed));
  }

  // Classement compact (tâche 3.4) : les cinq premiers et soi, avec score et
  // lames. Avant, dix lignes à trois colonnes occupaient près de la moitié
  // de l'écran d'un téléphone en portrait.
  // La couronne marque le leader (meilleur score parmi les vivants, tâche
  // 4.2), pas forcément le premier : un joueur mort garde son score tant
  // qu'il n'est pas revenu.
  update(entries: LeaderboardEntry[], myId: string, leaderId: string | null, now: number): void {
    if (now - this.lastUpdate < 500) return;
    this.lastUpdate = now;
    const sorted = [...entries].sort((a, b) => b.score - a.score);
    const top = sorted.slice(0, TOP_ROWS);
    const rows = document.getElementById("lb-rows")!;
    let html = "";
    for (let i = 0; i < top.length; i++) html += row(top[i], i, top[i].id === myId, top[i].id === leaderId);
    const myRank = sorted.findIndex((e) => e.id === myId);
    if (myRank >= TOP_ROWS) html += row(sorted[myRank], myRank, true, sorted[myRank].id === leaderId);
    rows.innerHTML = html;
  }
}

const TOP_ROWS = 5;

function initiallyCollapsed(): boolean {
  try {
    const saved = localStorage.getItem(COLLAPSED_KEY);
    if (saved !== null) return saved === "1";
  } catch {
    // Stockage indisponible : défaut selon l'écran.
  }
  return window.matchMedia(SMALL_SCREEN).matches;
}

// Les bots gardent leurs noms humoristiques, avec une petite mention
// (décision D8, tâche 4.6).
// Seul le nom se tronque : la mention et la couronne restent visibles.
function row(e: LeaderboardEntry, rank: number, me: boolean, leader: boolean): string {
  const bot = e.bot ? `<span class="lb-bot" title="Bot">BOT</span>` : "";
  const crown = leader ? `<span class="lb-crown">👑</span>` : "";
  return `<div class="${me ? "lb-row me" : "lb-row"}">
    <span class="name"><span class="lb-name">${rank + 1}. ${escapeHtml(e.name)}</span>${bot}${crown}</span>
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
