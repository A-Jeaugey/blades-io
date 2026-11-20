import { AGENT_IDS, type AgentId } from "@bladeio/shared";
import { onLangChange, t } from "../i18n";
import { getAgent, setAgent, subscribeAgent } from "./agentStore";
import {
  ABILITY_KEY_LABEL,
  ULTIMATE_KEY_LABEL,
  abilityDesc,
  abilityName,
  agentName,
  agentRgb,
  agentRole,
  agentTagline,
  emblemSvg,
  roleName,
} from "./info";

// Choix de l'agent (docs/AGENTS.md) : une rangée d'emblèmes, et la fiche de
// l'agent choisi (rôle, capacité, ultime). Au lobby, et sur l'écran de mort
// en version courte (le nouvel agent part avec la vie suivante). Le choix
// est retenu sur l'appareil (agentStore) : les deux sélecteurs le suivent.
export class AgentPicker {
  private readonly row: HTMLElement;
  private readonly card: HTMLElement | null;
  private readonly buttons = new Map<AgentId, HTMLButtonElement>();

  constructor(container: HTMLElement, private readonly compact = false) {
    container.classList.add("agent-picker");
    if (compact) container.classList.add("agent-picker-compact");
    this.row = document.createElement("div");
    this.row.className = "agent-row";
    this.row.setAttribute("role", "radiogroup");
    container.replaceChildren(this.row);
    this.card = compact ? null : document.createElement("div");
    if (this.card) {
      this.card.className = "agent-card";
      this.card.setAttribute("aria-live", "polite");
      container.append(this.card);
    }
    for (const id of AGENT_IDS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "agent-chip";
      b.setAttribute("role", "radio");
      b.style.setProperty("--agent-rgb", agentRgb(id));
      b.addEventListener("click", () => setAgent(id));
      this.buttons.set(id, b);
      this.row.append(b);
    }
    this.render();
    subscribeAgent(() => this.render());
    onLangChange(() => this.render());
  }

  private render(): void {
    const current = getAgent();
    for (const [id, b] of this.buttons) {
      const on = id === current;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", String(on));
      b.title = `${agentName(id)} · ${roleName(agentRole(id))}`;
      b.setAttribute("aria-label", t("agent.pick", { name: agentName(id) }));
      b.innerHTML = `${emblemSvg(id)}<span class="agent-chip-name">${agentName(id)}</span>`;
    }
    if (!this.card) return;
    const id = current;
    this.card.style.setProperty("--agent-rgb", agentRgb(id));
    this.card.innerHTML =
      `<div class="agent-card-head">${emblemSvg(id, "agent-emblem agent-emblem-big")}` +
      `<div><div class="agent-card-name">${agentName(id)} <span class="agent-card-role">${roleName(agentRole(id))}</span></div>` +
      `<div class="agent-card-tag">${agentTagline(id)}</div></div></div>` +
      this.ability(id, false) +
      this.ability(id, true);
  }

  private ability(id: AgentId, ult: boolean): string {
    const key = ult ? ULTIMATE_KEY_LABEL : ABILITY_KEY_LABEL;
    return `<div class="agent-ability"><span class="agent-key${ult ? " agent-key-ult" : ""}">${key}</span>` +
      `<div><b>${abilityName(id, ult)}</b> <span class="agent-ability-desc">${abilityDesc(id, ult)}</span></div></div>`;
  }
}
