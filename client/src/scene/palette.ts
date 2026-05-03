import { BladeRarity, PowerUpType } from "@bladeio/shared";

// ─────────────────────────────────────────────────────────────────────────────
// Palette "Sanctuaire des Esprits"
// Direction artistique : monde des esprits féérique, mix mystique
// (violets profonds + roses poudrés + or sacré + crème lunaire).
//
// Les couleurs des raretés et power-ups sont volontairement re-mappées ici
// côté client uniquement — `shared/src/constants.ts` reste intact (les valeurs
// d'origine y servent de fallback / contrat). Toute couleur affichée par le
// client doit passer par ce module pour rester cohérente avec le thème.
// ─────────────────────────────────────────────────────────────────────────────

// Couleurs de base du monde.
export const PALETTE = {
  // Atmosphère
  nightDeep: 0x0e0820,      // fond nuit étoilée (clear color)
  fogMid: 0x2a1f4a,         // brume mauve mid-distance
  groundBase: 0x140a26,     // sol au plus profond
  groundMid: 0x2a1d4a,      // sol mauve nappes
  groundHighlight: 0xe8d4f0, // wisps lumineux dans le sol

  // Joueurs
  playerLocalPrimary: 0xf5e8d8,    // crème / clair de lune
  playerLocalAccent: 0xd8a4e8,     // rose poudré (halo, ring)
  playerLocalAccentDim: 0x6e4d8a,  // violet sombre (emissive subtle)
  playerRemotePrimary: 0xe8d4e0,   // crème rosée (légère diff vs local)
  playerRemoteAccent: 0xa685f4,    // violet vif (accent remote)
  playerRemoteAccentDim: 0x4a2f7a, // violet sombre

  // Décor
  shrinePrimary: 0xa685f4,     // pierre violette mystique
  shrineAccent: 0xd8a4e8,      // veines roses
  mushroomGlow: 0xa4f0d4,      // champignons mint spirit
  groveFoliage: 0x3a2a5a,      // bosquets translucides (sombre)
  groveAccent: 0xc9a4ff,       // halo rose-violet sur les bushes

  // Limites & danger
  boundary: 0xff5d8a,        // mur frontière (sakura, zone de mort)
  dangerAccent: 0xff5d8a,    // toute zone critique

  // Or sacré (légendaires, hero items)
  sacredGold: 0xf4d471,
} as const;

// Couleurs des raretés de lames (re-mappées spirit-world).
// Logique de progression :
//   Common    = wisp pâle (numerous, ambiance)
//   Rare      = rose poudré (visible mais doux)
//   Epic      = violet profond (mystique)
//   Legendary = OR sacré (chaud, contraste fort dans la mer froide)
export const RARITY_COLOR: Record<BladeRarity, number> = {
  [BladeRarity.Common]: 0xf0e4f5,
  [BladeRarity.Rare]: 0xd8a4e8,
  [BladeRarity.Epic]: 0x9d7dff,
  [BladeRarity.Legendary]: 0xf4d471,
};

// Couleurs des power-ups par type (indépendantes des raretés).
// Re-mappées sur la palette spirit-world tout en gardant 5 teintes
// distinctes pour la lecture rapide.
export const POWERUP_COLOR: Record<PowerUpType, number> = {
  [PowerUpType.Speed]: 0xf9c74f,    // or chaud (vitesse = élan)
  [PowerUpType.Spin]: 0x9d7dff,     // violet profond
  [PowerUpType.Magnet]: 0xff8eb5,   // rose vif
  [PowerUpType.Shield]: 0xf5e8d8,   // crème lunaire (protection)
  [PowerUpType.Blades]: 0xa4f0d4,   // mint spirit (gain de matière)
};

// Helper : luminance perçue (Rec. 601) pour compenser le bloom selon la couleur.
// UnrealBloomPass extrait les pixels au-dessus d'un threshold ; les couleurs
// très saturées-mais-sombres (violet profond) franchissent moins facilement
// le seuil que les couleurs claires. On compense avec un multiplicateur
// d'emissiveIntensity proportionnel à 1 / luminance.
function luminance(hex: number): number {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// Compensation glow par rareté, calculée dynamiquement à partir des couleurs.
// Sécurise : si on retouche RARITY_COLOR, la compensation suit automatiquement.
export const RARITY_GLOW_COMP: Record<BladeRarity, number> = {
  [BladeRarity.Common]: 1 / Math.max(0.2, luminance(RARITY_COLOR[BladeRarity.Common])),
  [BladeRarity.Rare]: 1 / Math.max(0.2, luminance(RARITY_COLOR[BladeRarity.Rare])),
  [BladeRarity.Epic]: 1 / Math.max(0.2, luminance(RARITY_COLOR[BladeRarity.Epic])),
  [BladeRarity.Legendary]: 1 / Math.max(0.2, luminance(RARITY_COLOR[BladeRarity.Legendary])),
};
