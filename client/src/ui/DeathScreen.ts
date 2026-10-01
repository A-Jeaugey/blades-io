import { KillCause } from "@bladeio/shared";

// Carte de fin de vie (tâche 3.5) : score, record, trophées, cause de la
// mort en clair et un conseil adapté. Textes en anglais, comme le reste de
// l'interface en jeu (traduction : tâche 3.7).

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
    this.title.textContent = s.cause === "wall" ? "OUT OF BOUNDS" : "YOU WERE SHREDDED";
    const headline = s.privateRoom
      ? `${s.score} <span class="score-total-unit">PTS</span>`
      : `🏆 +${s.score}`;
    const best = s.best === null ? "" : s.best.isNew && s.best.previous > 0
      ? `<div class="row death-best new"><span class="label">best</span><span>NEW RECORD · was ${s.best.previous}</span></div>`
      : s.best.isNew
        ? `<div class="row death-best new"><span class="label">best</span><span>FIRST RECORD</span></div>`
        : `<div class="row death-best"><span class="label">best</span><span>${s.best.previous}</span></div>`;
    const total = (!s.privateRoom && s.walletTotal !== undefined && s.walletTotal !== null && s.walletTotal > 0)
      ? `<div class="row rank-row"><span class="label">total</span><span>🏆 ${s.walletTotal}</span></div>`
      : "";

    this.stats.innerHTML = `
      <div class="score-total-container">
        <div class="score-total">${headline}</div>
        <div class="score-sub">💀 ${s.kills} &nbsp;&nbsp; 🗡️ ${s.maxBlades} &nbsp;&nbsp; ⏱ ${formatDuration(s.lifeSeconds)}</div>
      </div>
      <div class="row death-cause"><span class="label">cause</span><span>${causeText(s)}</span></div>
      ${best}
      <div class="row rank-row"><span class="label">rank</span><span>#${s.rank}</span></div>
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

// Cause en une ligne : qui, comment, et avec combien de lames.
function causeText(s: DeathStats): string {
  if (s.cause === "wall" || !s.killerName) return "touched the red edge of the arena";
  const who = `<b>${escapeHtml(s.killerName)}</b>`;
  const blades = s.killerBlades !== null ? ` · ${s.killerBlades} blades` : "";
  if (s.cause === "throw") return `hit by a blade thrown by ${who}${blades}`;
  if (s.victimBlades === 0) return `touched by ${who} while you had no blades${blades}`;
  return `cut down by ${who}'s blades${blades}`;
}

function accountRow(s: DeathStats): string {
  if (s.privateRoom) {
    return `<div class="row death-guest"><span class="label">private room</span><span>no trophées · unranked</span></div>`;
  }
  if (s.scorePersisted) {
    return `<div class="row death-saved"><span class="label">trophées</span><span>added to your account</span></div>`;
  }
  // Invité : ses trophées ne sont pas perdus, ils l'attendent sur cet
  // appareil (avant, « sign in to keep your trophées » laissait croire
  // l'inverse).
  if (s.guestSaved) {
    return `<div class="row death-saved"><span class="label">guest</span><span>trophées kept on this device · sign in to move them to an account</span></div>`;
  }
  return `<div class="row death-guest"><span class="label">guest</span><span>trophées not saved · sign in to keep them</span></div>`;
}

// Conseil selon la cause et le rapport de force.
function tipFor(s: DeathStats): string {
  if (s.cause === "wall" || !s.killerName) {
    return "The red edge kills, outer blades first. When the screen glows red and the alarm beeps, turn back.";
  }
  if (s.cause === "throw") {
    return "Thrown blades fly straight: keep moving sideways when someone faces you, and duck into bushes to break their aim.";
  }
  if (s.victimBlades === 0) {
    return "With no blades left, any contact kills. Grab loose blades before going near anyone.";
  }
  if (s.killerBlades !== null && s.killerBlades > s.victimBlades) {
    return `${s.killerName} had ${s.killerBlades} blades, you had ${s.victimBlades}. Players marked ▲ are stronger: keep your distance until you have grown.`;
  }
  return "Blades of the same rarity break each other: win even fights with rarer blades (Epic, Legendary), or throw before you clash.";
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
