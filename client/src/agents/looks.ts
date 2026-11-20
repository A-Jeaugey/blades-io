import type { AgentId } from "@bladeio/shared";

// Couleurs des agents (docs/AGENTS.md) : des données, comme les thèmes et
// les cosmétiques (CLAUDE.md, « Couleurs »). Couleur d'identité : emblème,
// fiche, accent des effets de ses capacités. L'information ne passe jamais
// par elle seule : chaque agent a un emblème de forme distincte, et ses
// effets sont des formes (anneau, nuage, coque, spirale) qu'on ne peut pas
// prendre pour une lame.
export const AGENT_COLOR: Readonly<Record<AgentId, number>> = {
  volt: 0xffe14d,
  sagaie: 0xff8a3d,
  brume: 0xb59cff,
  vortex: 0x7b6bff,
  vigie: 0x52f5d0,
  rempart: 0xa8d4ff,
};

// Effets dans la scène.
export const AGENT_FX = {
  // Nuée : brume grise à peine teintée (elle doit se lire comme un nuage,
  // pas comme une zone de couleur).
  smoke: 0x8f8aa6,
  smokeCore: 0xc8c2e0,
  // Piège : vu de son poseur et de ses alliés seulement.
  trap: 0xff8a3d,
  // Puits : cœur sombre, spirale claire.
  well: 0x7b6bff,
  wellCore: 0x120c2a,
  // Sonar : l'anneau qui part de Vigie.
  sonar: 0x52f5d0,
  // Égide et Bastion : coque autour de l'orbite.
  aegis: 0xa8d4ff,
  // Surtension : arcs autour de Volt.
  surge: 0xffe14d,
  // Rafale : lueur de l'orbite de Sagaie.
  barrage: 0xff8a3d,
  // Ralenti par un piège.
  snared: 0xff8a3d,
} as const;
