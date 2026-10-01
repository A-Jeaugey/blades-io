import { KillCause } from "@bladeio/shared";
import { I18nKey, t } from "../i18n";

// Carte de fin de vie (tâche 3.5) : score, record, trophées, cause de la
// mort en clair et un conseil adapté.

export interface DeathStats {
  lifeSeconds: number;
  maxBlades: number;
  kills: number;
  rank: number;
  score: number;
  cratesDestroyed: number;
  powerupsCollected: number;
  cause: KillCause;
  killerName: string | null;
  // Lames en orbite au moment de l'élimination (cf. PlayerKilledEvent).
  killerBlades: number | null;
  victimBlades: number;
  // Record personnel d'avant cette vie, et s'il vient d'être battu ; null
  // en room privée (elles n'y comptent pas).
  best: { previous: number; isNew: boolean } | null;
  // Joueur authentifié : le serveur a crédité son compte.
  scorePersisted?: boolean;
  // Invité avec un jeton : ses trophées sont gardés sur cet appareil et
  // transférés au compte à la connexion.
  guestSaved?: boolean;
  // Solde total après cette vie, s'il est connu.
  walletTotal?: number | null;
  // Room privée : aucun trophée, partie non classée. On affiche le score
  // brut, sans le « 🏆 +N » qui laisserait croire à un gain.
  privateRoom?: boolean;
}

export class DeathScreen {
  private root: HTMLElement;
  private title: HTMLElement;
  private stats: HTMLElement;
  private respawn: HTMLButtonElement;
  private back: HTMLButtonElement;

  constructor(onRespawn: () => void, onBackToMenu: () => void) {
    this.root = document.getElementById("death-screen")!;
    this.title = this.root.querySelector("h2")!;
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

  get visible(): boolean {
    return !this.root.classList.contains("hidden");
  }

  show(s: DeathStats): void {
    this.title.textContent = t(s.cause === "wall" ? "death.outOfBounds" : "death.shredded");
    const headline = s.privateRoom
      ? `${s.score} <span class="score-total-unit">${t("death.pts")}</span>`
      : `🏆 +${s.score}`;
    const best = s.best === null ? "" : s.best.isNew && s.best.previous > 0
      ? row("death.best", t("death.newRecord", { n: s.best.previous }), "death-best new")
      : s.best.isNew
        ? row("death.best", t("death.firstRecord"), "death-best new")
        : row("death.best", String(s.best.previous), "death-best");
    const total = (!s.privateRoom && s.walletTotal !== undefined && s.walletTotal !== null && s.walletTotal > 0)
      ? row("death.total", `🏆 ${s.walletTotal}`, "rank-row")
      : "";

    this.stats.innerHTML = `
      <div class="score-total-container">
        <div class="score-total">${headline}</div>
        <div class="score-sub">💀 ${s.kills} &nbsp;&nbsp; 🗡️ ${s.maxBlades} &nbsp;&nbsp; ⏱ ${formatDuration(s.lifeSeconds)}</div>
      </div>
      ${row("death.cause", causeText(s), "death-cause")}
      ${best}
      ${row("death.rank", `#${s.rank}`, "rank-row")}
      ${total}
      ${accountRow(s)}
      <div class="death-tip">${escapeHtml(tipFor(s))}</div>
    `;
    this.root.classList.remove("hidden");
  }

  hide(): void {
    this.root.classList.add("hidden");
  }
}

// Ligne libellé / valeur (valeur en HTML déjà échappé).
function row(label: I18nKey, valueHtml: string, cls: string): string {
  return `<div class="row ${cls}"><span class="label">${t(label)}</span><span>${valueHtml}</span></div>`;
}

// Cause en une ligne : qui, comment, et avec combien de lames.
function causeText(s: DeathStats): string {
  if (s.cause === "wall" || !s.killerName) return t("death.causeWall");
  const who = `<b>${escapeHtml(s.killerName)}</b>`;
  const blades = s.killerBlades !== null ? t("death.killerBlades", { n: s.killerBlades }) : "";
  if (s.cause === "throw") return t("death.causeThrow", { who, blades });
  if (s.victimBlades === 0) return t("death.causeNoBlades", { who, blades });
  return t("death.causeBlades", { who, blades });
}

function accountRow(s: DeathStats): string {
  if (s.privateRoom) return row("death.privateRoom", t("death.privateNoTrophies"), "death-guest");
  if (s.scorePersisted) return row("death.trophies", t("death.addedToAccount"), "death-saved");
  // Invité : ses trophées ne sont pas perdus, ils l'attendent sur cet
  // appareil (avant, « sign in to keep your trophées » laissait croire
  // l'inverse).
  if (s.guestSaved) return row("death.guest", t("death.guestKept"), "death-saved");
  return row("death.guest", t("death.guestLost"), "death-guest");
}

// Conseil selon la cause et le rapport de force.
function tipFor(s: DeathStats): string {
  if (s.cause === "wall" || !s.killerName) return t("death.tipWall");
  if (s.cause === "throw") return t("death.tipThrow");
  if (s.victimBlades === 0) return t("death.tipNoBlades");
  if (s.killerBlades !== null && s.killerBlades > s.victimBlades) {
    return t("death.tipBigger", { killer: s.killerName, killerBlades: s.killerBlades, victimBlades: s.victimBlades });
  }
  return t("death.tipRarity");
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
