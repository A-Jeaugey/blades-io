import { DEFAULT_AGENT, isAgentId, type AgentId } from "@bladeio/shared";

// Agent choisi sur cet appareil (docs/AGENTS.md) : proposé au serveur en
// entrant en partie et à chaque réapparition. Tous sont gratuits : le
// serveur ne refuse qu'un identifiant inconnu.

const STORAGE_KEY = "blade.agent";
const listeners = new Set<(agent: AgentId) => void>();

function read(): AgentId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (isAgentId(raw)) return raw;
  } catch { /* stockage indisponible : l'agent des débuts */ }
  return DEFAULT_AGENT;
}

let current: AgentId = read();

export function getAgent(): AgentId {
  return current;
}

export function setAgent(agent: AgentId): void {
  if (agent === current) return;
  current = agent;
  try { localStorage.setItem(STORAGE_KEY, agent); } catch { /* idem */ }
  for (const l of listeners) l(agent);
}

export function subscribeAgent(cb: (agent: AgentId) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
