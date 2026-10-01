import { BladeRarity } from "@bladeio/shared";

// Palette daltonienne (tâche 3.8), en option dans les réglages. Elle
// remplace, quel que soit le thème, les couleurs des raretés et celles de la
// menace. Les teintes des thèmes confondent des raretés pour un œil
// daltonien (pourpre et rose du Néon, orange et or de la Forge, givre et
// cyan des Profondeurs) ; celles-ci restent distinctes en vision normale et
// sous les trois dichromasies (simulation de Machado et al., 2009, écart
// CIEDE2000), y compris une fois rendues avec le glow des lames.
// L'ordre suit l'usage des jeux (commun blanc, rare bleu, épique pourpre,
// légendaire orange), le pourpre tiré vers le rouge : un pourpre se lit bleu
// pour un deutéranope.
export const COLORBLIND_RARITY_COLOR: Record<BladeRarity, number> = {
  [BladeRarity.Common]: 0xffffff,
  [BladeRarity.Rare]: 0x0a84ff,
  [BladeRarity.Epic]: 0xf0337a,
  [BladeRarity.Legendary]: 0xffa31a,
};

// Menace : vermillon et bleu au lieu du rouge et du vert, la paire que les
// deutéranopes distinguent le moins. Les nametags gardent leurs symboles ▲
// et ▼.
export const COLORBLIND_DANGER_COLOR = 0xff5a1f;
export const COLORBLIND_PREY_COLOR = 0x2d9cff;
