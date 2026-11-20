import { AGENTS, AgentEffect, CastSlot, isAgentId, type AgentId } from "@bladeio/shared";
import { onLangChange, t } from "../i18n";
import {
  ABILITY_KEY,
  ABILITY_KEY_LABEL,
  ULTIMATE_KEY,
  ULTIMATE_KEY_LABEL,
  abilityName,
  agentRgb,
  emblemSvg,
} from "./info";

// HUD de l'agent (docs/AGENTS.md) : sa capacité (recharge) et son ultime
// (jauge). Au bureau, en bas à droite, avec les touches E et R ; en mode
// tactile, deux boutons ronds au-dessus de LANCER, qu'on tape (visée : sens
// de marche) ou depuis lesquels on glisse pour viser, comme LANCER.
// Le HUD ne fait que collecter les demandes : le jeu les envoie avec le
// prochain input (consume).

export interface CastRequest {
  slot: CastSlot;
  // Touche (visée au curseur), clic sur le bouton (sans visée : le curseur
  // est sur le HUD) ou doigt.
  source: "key" | "click" | "touch";
  // Glisser depuis le bouton (px écran, depuis son centre), null : sans
  // glisser (touche, clic, tap).
  drag: { x: number; y: number } | null;
}

export interface AbilityHudState {
  agent: string;
  alive: boolean;
  serverNow: number;
  abilityReadyAt: number;
  ultCharge: number;
  effect: number;
  effectUntil: number;
}

// Glisser plus court : un tap (sens de marche).
const DRAG_MIN_PX = 18;

function isTyping(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable;
}

interface Slot {
  root: HTMLElement;
  icon: HTMLElement;
  cd: HTMLElement;
  key: HTMLElement;
  touchId: number | null;
  startX: number;
  startY: number;
  curX: number;
  curY: number;
}

export class AbilityHud {
  private readonly root: HTMLElement;
  private readonly ability: Slot;
  private readonly ult: Slot;
  private readonly ring: SVGCircleElement | null;
  private readonly nameAbility: HTMLElement | null;
  private readonly nameUlt: HTMLElement | null;
  private pending: CastRequest | null = null;
  private agent: AgentId | null = null;
  private touch = false;
  // Dernières valeurs écrites : le DOM n'est touché que si elles changent.
  private shown = { cd: "", ult: -1, ready: false, ultReady: false, effect: "", visible: false };
  // Une première mise à jour faite depuis le changement d'agent : un ultime
  // déjà plein à ce moment-là ne sonne pas.
  private primed = false;
  // Le jeu lui demande si la saisie est à lui (partie en cours, pas de menu).
  enabled = false;
  // Appelé quand l'ultime devient prêt (son, vibration).
  onUltReady: (() => void) | null = null;

  constructor() {
    this.root = document.getElementById("ability-hud")!;
    this.ability = this.slot(this.root.querySelector<HTMLElement>(".ab-ability")!, CastSlot.Ability);
    this.ult = this.slot(this.root.querySelector<HTMLElement>(".ab-ult")!, CastSlot.Ultimate);
    this.ring = this.root.querySelector<SVGCircleElement>(".ab-ring-fill");
    this.nameAbility = this.root.querySelector(".ab-name-ability");
    this.nameUlt = this.root.querySelector(".ab-name-ult");
    this.ability.key.textContent = ABILITY_KEY_LABEL;
    this.ult.key.textContent = ULTIMATE_KEY_LABEL;
    window.addEventListener("keydown", (e) => {
      if (!this.enabled || e.repeat || isTyping()) return;
      if (e.code === ABILITY_KEY) this.request(CastSlot.Ability, "key", null);
      else if (e.code === ULTIMATE_KEY) this.request(CastSlot.Ultimate, "key", null);
    });
    onLangChange(() => this.writeAgent());
  }

  private slot(root: HTMLElement, slot: CastSlot): Slot {
    const s: Slot = {
      root,
      icon: root.querySelector<HTMLElement>(".ab-icon")!,
      cd: root.querySelector<HTMLElement>(".ab-cd")!,
      key: root.querySelector<HTMLElement>(".ab-key")!,
      touchId: null,
      startX: 0, startY: 0, curX: 0, curY: 0,
    };
    // Souris : un clic lance (sans visée : le curseur est sur le bouton).
    root.addEventListener("mousedown", (e) => {
      if (this.touch) return;
      e.preventDefault();
      e.stopPropagation();
      this.request(slot, "click", null);
    });
    root.addEventListener("touchstart", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (s.touchId !== null || e.changedTouches.length === 0) return;
      const tch = e.changedTouches[0];
      s.touchId = tch.identifier;
      s.startX = s.curX = tch.clientX;
      s.startY = s.curY = tch.clientY;
    }, { passive: false });
    root.addEventListener("touchmove", (e) => {
      const tch = this.find(e.changedTouches, s.touchId);
      if (!tch) return;
      e.preventDefault();
      s.curX = tch.clientX;
      s.curY = tch.clientY;
      root.classList.toggle("aiming", Math.hypot(s.curX - s.startX, s.curY - s.startY) >= DRAG_MIN_PX);
    }, { passive: false });
    const release = (e: TouchEvent, cancel: boolean) => {
      const tch = this.find(e.changedTouches, s.touchId);
      if (!tch) return;
      s.curX = tch.clientX;
      s.curY = tch.clientY;
      s.touchId = null;
      root.classList.remove("aiming");
      if (cancel) return;
      const dx = s.curX - s.startX;
      const dy = s.curY - s.startY;
      this.request(slot, "touch", Math.hypot(dx, dy) >= DRAG_MIN_PX ? { x: dx, y: dy } : null);
    };
    root.addEventListener("touchend", (e) => release(e, false));
    root.addEventListener("touchcancel", (e) => release(e, true));
    return s;
  }

  private find(list: TouchList, id: number | null): Touch | null {
    if (id === null) return null;
    for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
    return null;
  }

  private request(slot: CastSlot, source: CastRequest["source"], drag: { x: number; y: number } | null): void {
    if (!this.enabled || !this.agent) return;
    this.pending = { slot, source, drag };
  }

  // Demande en attente, envoyée avec le prochain input.
  consume(): CastRequest | null {
    const p = this.pending;
    this.pending = null;
    return p;
  }

  // Glisser en cours depuis un bouton (visée tactile), null sinon.
  get dragging(): { slot: CastSlot; x: number; y: number } | null {
    for (const [s, slot] of [[this.ability, CastSlot.Ability], [this.ult, CastSlot.Ultimate]] as const) {
      if (s.touchId === null) continue;
      const x = s.curX - s.startX;
      const y = s.curY - s.startY;
      if (Math.hypot(x, y) >= DRAG_MIN_PX) return { slot, x, y };
    }
    return null;
  }

  setTouch(on: boolean): void {
    this.touch = on;
    this.root.classList.toggle("touch", on);
  }

  hide(): void {
    this.root.classList.add("hidden");
    this.shown.visible = false;
    this.pending = null;
  }

  update(s: AbilityHudState): void {
    const agent = isAgentId(s.agent) ? s.agent : null;
    const visible = agent !== null && s.alive;
    if (visible !== this.shown.visible) {
      this.shown.visible = visible;
      this.root.classList.toggle("hidden", !visible);
    }
    if (agent !== this.agent) {
      this.agent = agent;
      this.writeAgent();
    }
    if (!agent || !visible) return;
    // Capacité : décompte en secondes, ou prête.
    const left = Math.max(0, s.abilityReadyAt - s.serverNow);
    const cd = left > 0 ? String(Math.ceil(left / 1000)) : "";
    if (cd !== this.shown.cd) {
      this.shown.cd = cd;
      this.ability.cd.textContent = cd;
      this.ability.root.classList.toggle("cooldown", cd !== "");
    }
    // Ultime : jauge, PRÊT, ou durée de l'effet en cours.
    const cost = AGENTS[agent].ultCost;
    const charge = Math.min(cost, s.ultCharge);
    if (charge !== this.shown.ult && this.ring) {
      this.shown.ult = charge;
      const circ = 2 * Math.PI * 20;
      this.ring.style.strokeDasharray = `${circ}`;
      this.ring.style.strokeDashoffset = `${circ * (1 - charge / cost)}`;
    }
    const ultReady = charge >= cost;
    if (ultReady !== this.shown.ultReady) {
      if (ultReady && this.primed) this.onUltReady?.();
      this.shown.ultReady = ultReady;
      this.ult.root.classList.toggle("ready", ultReady);
    }
    const active = s.effectUntil > s.serverNow && s.effect !== AgentEffect.None && s.effect === AGENTS[agent].ultEffect;
    const effect = active ? String(Math.ceil((s.effectUntil - s.serverNow) / 1000)) : ultReady ? t("hud.ready") : `${Math.floor((100 * charge) / cost)}%`;
    if (effect !== this.shown.effect) {
      this.shown.effect = effect;
      this.ult.cd.textContent = effect;
      this.ult.root.classList.toggle("active", active);
    }
    this.primed = true;
  }

  private writeAgent(): void {
    const agent = this.agent;
    if (!agent) return;
    this.root.style.setProperty("--agent-rgb", agentRgb(agent));
    this.ability.icon.innerHTML = emblemSvg(agent, "ab-emblem");
    this.ult.icon.innerHTML = emblemSvg(agent, "ab-emblem");
    const an = abilityName(agent, false);
    const un = abilityName(agent, true);
    if (this.nameAbility) this.nameAbility.textContent = an;
    if (this.nameUlt) this.nameUlt.textContent = un;
    this.ability.root.title = `${an} · ${t("hud.abilityKey", { key: ABILITY_KEY_LABEL })}`;
    this.ult.root.title = `${un} · ${t("hud.ultKey", { key: ULTIMATE_KEY_LABEL })}`;
    this.ability.root.setAttribute("aria-label", this.ability.root.title);
    this.ult.root.setAttribute("aria-label", this.ult.root.title);
    this.shown = { cd: "", ult: -1, ready: false, ultReady: false, effect: "", visible: this.shown.visible };
    this.primed = false;
  }
}
