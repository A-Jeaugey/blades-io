import { AGENTS, type AgentId, type AgentRole } from "@bladeio/shared";
import { t, type I18nKey } from "../i18n";
import { AGENT_COLOR } from "./looks";

// Fiche d'un agent pour l'interface : emblème (une forme par agent, la
// couleur n'est jamais seule), nom, rôle, capacités. Rien ici ne tire le
// moteur : le lobby l'importe.

// Emblèmes dessinés dans un carré de 24 (tracés, pas de fichier).
const EMBLEM_PATHS: Readonly<Record<AgentId, string>> = {
  // Éclair
  volt: '<path d="M13.5 2 4.5 13.5h6.2L9.8 22l9.7-12.3h-6.4z"/>',
  // Fer de lance et sa hampe
  sagaie: '<path d="M12 1.8 18.4 12 12 9.6 5.6 12z"/><path d="M11 10.4h2V22h-2z"/>',
  // Volute de brume
  brume: '<path d="M6.6 18.5a4.1 4.1 0 0 1-.5-8.2 5.6 5.6 0 0 1 10.9-1.3 4.8 4.8 0 0 1 .4 9.5z"/>',
  // Spirale
  vortex: '<path d="M12 4.2a7.8 7.8 0 1 1-7.8 7.8h2.2A5.6 5.6 0 1 0 12 6.4a3.4 3.4 0 1 1-3.4 3.4h2.2A1.2 1.2 0 1 0 12 8.6z"/>',
  // Œil
  vigie: '<path d="M12 5c5.2 0 9 4.4 10 7-1 2.6-4.8 7-10 7S3 14.6 2 12c1-2.6 4.8-7 10-7zm0 3.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6z"/>',
  // Bouclier
  rempart: '<path d="M12 2 20 5.2v6.1c0 5.1-3.4 9.1-8 10.7-4.6-1.6-8-5.6-8-10.7V5.2z"/>',
};

export function emblemSvg(agent: AgentId, className = "agent-emblem"): string {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${EMBLEM_PATHS[agent]}</svg>`;
}

// Couleur d'identité en CSS (rgb), pour les variables des éléments.
export function agentRgb(agent: AgentId): string {
  const c = AGENT_COLOR[agent];
  return `${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}`;
}

export function agentName(agent: AgentId): string {
  return t(`agent.${agent}.name` as I18nKey);
}

export function roleName(role: AgentRole): string {
  return t(`agent.role.${role}` as I18nKey);
}

export function agentRole(agent: AgentId): AgentRole {
  return AGENTS[agent].role;
}

export function abilityName(agent: AgentId, ult: boolean): string {
  return t(`agent.${agent}.${ult ? "ult" : "ability"}` as I18nKey);
}

export function abilityDesc(agent: AgentId, ult: boolean): string {
  return t(`agent.${agent}.${ult ? "ultDesc" : "abilityDesc"}` as I18nKey);
}

export function agentTagline(agent: AgentId): string {
  return t(`agent.${agent}.tagline` as I18nKey);
}

// Touches : E et R sont au même endroit en AZERTY et en QWERTY.
export const ABILITY_KEY = "KeyE";
export const ULTIMATE_KEY = "KeyR";
export const ABILITY_KEY_LABEL = "E";
export const ULTIMATE_KEY_LABEL = "R";
