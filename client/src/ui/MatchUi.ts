import { MatchEndEvent, MatchPhase, MatchStanding, ROUND_SHRINK_MS, TEAM_NONE, otherTeam } from "@bladeio/shared";
import { formatNumber, onLangChange, t } from "../i18n";

// Partie qui a une fin (manches, tâche 7.1 ; modes équipe, 7.2) :
// minuterie en haut de l'écran, score des équipes, podium de fin.
// Générique : un mode dont la partie a une échéance (ArenaState.phaseEndsAt)
// a sa minuterie, un mode qui finit a son podium (évènement matchEnd) ;
// l'arène sans fin n'affiche ni l'un ni l'autre.

function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function span(className: string, text: string): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = className;
  el.textContent = text;
  return el;
}

// Marque de son équipe, en plus de la couleur (tâche 3.8 : jamais la
// couleur seule) : la même dans la minuterie, le podium et les nametags.
export const ALLY_MARK = "◆";
// Lignes par équipe dans le tableau du podium.
const TABLE_ROWS = 6;

// Ce que la minuterie montre d'une partie en cours.
export interface MatchHud {
  phase: number;
  endsAt: number;
  // Manches (manches chronométrées, dernière équipe en vie) ou parties
  // (Team Deathmatch, drapeau) : libellés de la minuterie et de la reprise.
  roundBased: boolean;
  // L'arène se resserre pendant la dernière minute (manches, dernière
  // équipe en vie).
  shrinks: boolean;
  // Modes équipe : les deux scores vus de son équipe, et leur libellé
  // (éliminations, joueurs en vie, captures).
  team: { label: string; mine: number; theirs: number } | null;
}

export class MatchUi {
  private readonly timer = document.getElementById("match-timer") as HTMLElement;
  private readonly podium = document.getElementById("podium") as HTMLElement;
  private readonly title = document.getElementById("podium-title") as HTMLElement;
  private readonly teams = document.getElementById("podium-teams") as HTMLElement;
  private readonly mvp = document.getElementById("podium-mvp") as HTMLElement;
  private readonly steps = document.getElementById("podium-steps") as HTMLElement;
  private readonly table = document.getElementById("podium-table") as HTMLElement;
  private readonly me = document.getElementById("podium-me") as HTMLElement;
  private readonly next = document.getElementById("podium-next") as HTMLElement;
  private shown: MatchEndEvent | null = null;
  private myId = "";
  private myTeam = TEAM_NONE;
  private shrinking = false;
  private roundBased = true;
  private timerText = "";
  private nextText = "";

  constructor(onMenu: () => void) {
    document.getElementById("podium-menu")?.addEventListener("click", onMenu);
    onLangChange(() => {
      this.timerText = "";
      this.nextText = "";
      if (this.shown) this.renderPodium();
    });
  }

  get podiumShown(): boolean {
    return this.shown !== null;
  }

  // À chaque image. Renvoie true à l'image où l'arène commence à se
  // resserrer (dernière minute), pour l'annonce.
  update(hud: MatchHud, serverNow: number): boolean {
    let shrinkStarts = false;
    let label: string | null = null;
    const left = hud.endsAt - serverNow;
    this.roundBased = hud.roundBased;
    if (hud.phase === MatchPhase.Playing && hud.endsAt > 0) {
      const shrinking = hud.shrinks && left <= ROUND_SHRINK_MS;
      if (shrinking && !this.shrinking && left > 0) shrinkStarts = true;
      this.shrinking = shrinking;
      label = t(shrinking ? "match.shrinking" : hud.roundBased ? "match.timer" : "match.timerMatch");
    } else if (hud.phase === MatchPhase.Over && hud.endsAt > 0 && !this.shown) {
      // Arrivée pendant l'entracte, sans podium : la reprise.
      label = t(hud.roundBased ? "match.nextShort" : "match.nextMatchShort");
    }
    if (label !== null) {
      const time = clock(left);
      const score = hud.team ? `${ALLY_MARK} ${hud.team.mine} – ${hud.team.theirs}` : "";
      const text = `${label} · ${time}${score ? ` · ${hud.team!.label} ${score}` : ""}`;
      if (text !== this.timerText) {
        this.timerText = text;
        // Libellés masqués sur téléphone : le temps et le score seuls
        // tiennent entre l'état du joueur et la minimap.
        const parts = [span("mt-label", `${label} · `), span("mt-time", time)];
        if (hud.team) parts.push(span("mt-score-label", ` · ${hud.team.label}`), span("mt-score", ` ${score}`));
        this.timer.replaceChildren(...parts);
        this.timer.setAttribute("aria-label", text);
        this.timer.classList.toggle("urgent", hud.phase === MatchPhase.Playing && this.shrinking);
        this.timer.classList.remove("hidden");
      }
    } else if (this.timerText) {
      this.timerText = "";
      this.timer.classList.add("hidden");
    }
    if (this.shown) {
      const s = Math.max(0, Math.ceil((this.shown.nextAt - serverNow) / 1000));
      const text = t(this.roundBased ? "match.next" : "match.nextMatch", { s });
      if (text !== this.nextText) {
        this.nextText = text;
        this.next.textContent = text;
      }
    }
    return shrinkStarts;
  }

  // myTeam : l'équipe du joueur (modes équipe), pour la victoire et les
  // marques d'alliés.
  showPodium(ev: MatchEndEvent, myId: string, myTeam: number): void {
    this.shown = ev;
    this.myId = myId;
    this.myTeam = myTeam;
    this.nextText = "";
    this.renderPodium();
    this.podium.classList.remove("hidden");
  }

  hidePodium(): void {
    this.shown = null;
    this.podium.classList.add("hidden");
  }

  // Retour au menu : plus de minuterie ni de podium.
  reset(): void {
    this.hidePodium();
    this.timerText = "";
    this.shrinking = false;
    this.timer.classList.add("hidden");
  }

  private renderPodium(): void {
    const ev = this.shown;
    if (!ev) return;
    const teams = this.renderTeams(ev);
    // Modes équipe : un tableau par équipe à la place des marches.
    this.steps.classList.toggle("hidden", teams);
    this.table.classList.toggle("hidden", !teams);
    if (teams) {
      this.renderTable(ev);
    } else {
      const top = ev.standings.slice(0, 3);
      // Marches dans l'ordre visuel : 2e, 1er, 3e.
      const order = [1, 0, 2].filter((i) => i < top.length);
      this.steps.replaceChildren(...order.map((i) => this.step(top[i], i)));
    }
    const rank = ev.standings.findIndex((s) => s.id === this.myId);
    if (rank < 0) {
      this.me.textContent = "";
      return;
    }
    const s = ev.standings[rank];
    let text = t("match.me", {
      rank: rank + 1,
      total: ev.standings.length,
      points: formatNumber(s.score, 0),
      kills: s.kills,
      blades: s.bestBlades,
    });
    if (s.bonus > 0) text += ` · ${t("match.bonus", { n: formatNumber(s.bonus, 0) })}`;
    this.me.textContent = text;
  }

  // Modes équipe : victoire, défaite ou égalité vues de son équipe, les
  // deux scores (la sienne d'abord) et le meilleur joueur de la partie.
  // Renvoie false hors modes équipe.
  private renderTeams(ev: MatchEndEvent): boolean {
    const teams = ev.teams;
    const mine = this.myTeam;
    if (!teams || mine === TEAM_NONE) {
      this.title.textContent = t("match.over");
      this.teams.classList.add("hidden");
      this.mvp.classList.add("hidden");
      return false;
    }
    this.title.textContent = t(teams.winner === TEAM_NONE ? "match.draw" : teams.winner === mine ? "match.victory" : "match.defeat");
    const [a, b] = teams.scores;
    const [ours, theirs] = mine === 1 ? [a, b] : [b, a];
    this.teams.textContent = t("match.teamScore", { mark: ALLY_MARK, mine: ours, theirs });
    this.teams.classList.remove("hidden");
    const best = ev.standings.find((s) => s.id === ev.mvp);
    if (best) {
      this.mvp.textContent = t("match.mvp", {
        name: best.name,
        points: formatNumber(best.score, 0),
        kills: best.kills,
      });
      this.mvp.classList.remove("hidden");
    } else {
      this.mvp.classList.add("hidden");
    }
    return true;
  }

  // Deux colonnes, la sienne (◆) à gauche : les joueurs de chaque équipe,
  // du meilleur au moins bon, avec leurs points et éliminations.
  private renderTable(ev: MatchEndEvent): void {
    const mine = this.myTeam;
    const cols = [mine, otherTeam(mine)].map((team) => {
      const ally = team === mine;
      const col = document.createElement("section");
      col.className = `podium-col ${ally ? "ally" : "foe"}`;
      const head = span("podium-col-head", ally ? `${ALLY_MARK} ${t("match.yourTeam")}` : t("match.theirTeam"));
      const list = document.createElement("ol");
      for (const s of ev.standings.filter((row) => row.team === team).slice(0, TABLE_ROWS)) {
        const li = document.createElement("li");
        if (s.id === this.myId) li.className = "is-me";
        const name = span("pt-name", "");
        name.append(span("pt-n", s.name));
        if (s.bot) name.append(span("lb-bot", t("hud.bot")));
        li.append(name, span("pt-stats", `${t("match.points", { n: formatNumber(s.score, 0) })} · ${t("match.kills", { n: s.kills })}`));
        list.append(li);
      }
      col.append(head, list);
      return col;
    });
    this.table.replaceChildren(...cols);
  }

  private step(s: MatchStanding, rank: number): HTMLLIElement {
    const li = document.createElement("li");
    li.className = `podium-step podium-step-${rank + 1}${s.id === this.myId ? " is-me" : ""}`;
    const ally = this.myTeam !== TEAM_NONE && s.team === this.myTeam;
    li.append(span("podium-rank", String(rank + 1)), span("podium-name", ally ? `${ALLY_MARK} ${s.name}` : s.name));
    // Mention BOT sous le pseudo : à côté, elle débordait des marches étroites.
    if (s.bot) li.append(span("lb-bot", t("hud.bot")));
    li.append(
      span("podium-points", t("match.points", { n: formatNumber(s.score, 0) })),
      span("podium-kills", t("match.kills", { n: s.kills })),
    );
    return li;
  }
}
