import { BOOST_DRAIN_INTERVAL } from "@bladeio/shared";
import { formatNumber, onLangChange, t } from "../i18n";

// Bloc d'état du joueur local (tâche 3.4) : rang, lames, score de la vie et
// record, coût du boost. En haut à gauche : en bas au centre, il masquait la
// zone juste sous le joueur, d'où arrivent les adversaires.
const BOOST_PER_SECOND = 1 / BOOST_DRAIN_INTERVAL;

export class Hud {
  private bladeCount: HTMLElement;
  private bladeLabel: HTMLElement;
  private scoreVal: HTMLElement;
  private bestVal: HTMLElement;
  private boostInfo: HTMLElement;
  private fps: HTMLElement;
  private loginFps: HTMLElement;
  private hud: HTMLElement;
  private roomBadge: HTMLElement;
  private roomCodeEl: HTMLElement;
  private currentCode = "";
  private effects: HTMLElement;
  private effectNodes: Map<string, { root: HTMLElement; bar: HTMLElement }> = new Map();
  private rankBadge: HTMLElement;
  // Dernières valeurs écrites : le DOM n'est touché que si elles changent.
  private shown = { blades: -1, rank: -1, score: -1, best: -1, newBest: false, boost: "", net: "" };

  constructor() {
    this.bladeCount = document.getElementById("blade-count")!;
    this.bladeLabel = document.getElementById("blade-label")!;
    this.scoreVal = document.getElementById("score-val")!;
    this.bestVal = document.getElementById("best-val")!;
    this.boostInfo = document.getElementById("boost-info")!;
    this.fps = document.getElementById("fps")!;
    this.loginFps = document.getElementById("login-fps")!;
    this.hud = document.getElementById("hud")!;
    this.roomBadge = document.getElementById("room-badge")!;
    this.roomCodeEl = document.getElementById("room-code")!;
    this.roomBadge.addEventListener("click", () => this.copyInviteLink());
    this.effects = document.getElementById("effects")!;
    this.rankBadge = document.getElementById("rank-badge")!;
    this.writeBoostButton();
    // Langue changée : tout le texte affiché est réécrit à la prochaine
    // mise à jour, badges d'effet compris (recréés).
    onLangChange(() => {
      this.shown = { blades: -1, rank: -1, score: -1, best: -1, newBest: false, boost: "", net: "" };
      for (const node of this.effectNodes.values()) node.root.remove();
      this.effectNodes.clear();
      this.writeBoostButton();
    });
  }

  // Tactile : le coût du boost est écrit sous le libellé du bouton.
  private writeBoostButton(): void {
    const sub = document.querySelector("#boost-btn .btn-sub");
    if (sub) sub.textContent = t("hud.boostSub", { n: BOOST_PER_SECOND });
  }

  // Met à jour un badge d'effet actif (SPEED, SPIN, MAGNET, SHIELD).
  // untilMs = date de fin, nowMs = heure du serveur estimée (les deux dans
  // l'horloge du serveur) ; si la fin est passée, on retire le badge.
  updateEffect(
    key: string,
    label: string,
    color: string,
    untilMs: number,
    durationMs: number,
    nowMs: number,
  ): void {
    const remaining = untilMs - nowMs;
    let node = this.effectNodes.get(key);
    if (remaining <= 0) {
      if (node) {
        node.root.remove();
        this.effectNodes.delete(key);
      }
      return;
    }
    if (!node) {
      const root = document.createElement("div");
      root.className = "effect-badge";
      root.style.setProperty("--fx-color", color);
      const lbl = document.createElement("span");
      lbl.className = "effect-label";
      lbl.textContent = label;
      const barBg = document.createElement("div");
      barBg.className = "effect-bar-bg";
      const bar = document.createElement("div");
      bar.className = "effect-bar";
      barBg.appendChild(bar);
      root.appendChild(lbl);
      root.appendChild(barBg);
      this.effects.appendChild(root);
      node = { root, bar };
      this.effectNodes.set(key, node);
    }
    const ratio = Math.max(0, Math.min(1, remaining / durationMs));
    node.bar.style.width = `${ratio * 100}%`;
  }

  clearEffects(): void {
    this.effectNodes.forEach((n) => n.root.remove());
    this.effectNodes.clear();
  }

  show(): void { this.hud.classList.remove("hidden"); }
  hide(): void { this.hud.classList.add("hidden"); }
  setBladeCount(n: number): void {
    if (n === this.shown.blades) return;
    this.shown.blades = n;
    this.bladeCount.textContent = String(n);
    this.bladeLabel.textContent = t(n === 1 ? "common.blade" : "common.blades");
  }

  // Score de la vie en cours et record personnel (null : room privée, où le
  // record ne compte pas) ; un record battu en cours de vie s'affiche comme
  // tel.
  setScore(score: number, best: number | null): void {
    const newBest = best !== null && best > 0 && score > best;
    if (score !== this.shown.score) {
      this.shown.score = score;
      this.scoreVal.textContent = `🏆 ${score}`;
    }
    const bestKey = best === null ? -2 : best;
    if (bestKey !== this.shown.best || newBest !== this.shown.newBest) {
      this.shown.best = bestKey;
      this.shown.newBest = newBest;
      this.bestVal.textContent = best === null ? "" : newBest ? t("hud.newBest") : best > 0 ? t("hud.best", { n: best }) : t("hud.bestNone");
      this.bestVal.classList.toggle("new", newBest);
    }
  }

  // Coût réel du boost : lames brûlées par seconde, et autonomie restante
  // pendant qu'on boost.
  setBoost(boosting: boolean, bladeCount: number): void {
    const text = boosting
      ? t("hud.boostLeft", { n: BOOST_PER_SECOND, s: formatNumber(bladeCount * BOOST_DRAIN_INTERVAL, 1) })
      : t("hud.boostCost", { n: BOOST_PER_SECOND });
    if (text === this.shown.boost) return;
    this.shown.boost = text;
    this.boostInfo.textContent = text;
    this.boostInfo.classList.toggle("on", boosting);
  }

  // Images par seconde et aller-retour réseau (ms, null tant qu'inconnu).
  setNet(fps: number, pingMs: number | null): void {
    const txt = pingMs === null ? `${fps.toFixed(0)} FPS` : `${fps.toFixed(0)} FPS · ${Math.round(pingMs)} ms`;
    if (txt === this.shown.net) return;
    this.shown.net = txt;
    this.fps.textContent = txt;
    this.loginFps.textContent = `${fps.toFixed(0)} FPS`;
  }

  setRank(rank: number): void {
    if (rank === this.shown.rank) return;
    this.shown.rank = rank;
    this.rankBadge.textContent = `#${rank}`;
  }

  // code vide = room publique, le badge est caché.
  setRoomCode(code: string): void {
    this.currentCode = code;
    if (!code) { this.roomBadge.classList.add("hidden"); return; }
    this.roomBadge.classList.remove("hidden");
    this.roomCodeEl.textContent = code;
  }

  private copyInviteLink(): void {
    if (!this.currentCode) return;
    const url = new URL(window.location.href);
    url.searchParams.set("room", this.currentCode);
    const link = url.toString();
    const fallback = () => {
      const ta = document.createElement("textarea");
      ta.value = link;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch {}
      document.body.removeChild(ta);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(link).catch(fallback);
    } else {
      fallback();
    }
    this.roomBadge.classList.add("copied");
    setTimeout(() => this.roomBadge.classList.remove("copied"), 900);
  }
}
