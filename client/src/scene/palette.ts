import { BladeRarity, PowerUpType } from "@bladeio/shared";
import { getActiveTheme } from "../themes";

// ─────────────────────────────────────────────────────────────────────────────
// Palette — façade rétro-compatible au-dessus du thème actif.
//
// Avant le système de thèmes, ce fichier exportait des constantes statiques.
// Maintenant tout vient du thème actif (themes/index.ts), ce module ne fait
// que ré-exporter les valeurs sous les noms historiques pour minimiser la
// chirurgie dans les call sites de rendu.
//
// Note : RARITY_COLOR / POWERUP_COLOR ici sont volontairement nommés à
// l'identique de ceux dans @bladeio/shared (qu'ils shadowent côté client).
// Le serveur n'utilise jamais ces constantes — c'est purement cosmétique.
// ─────────────────────────────────────────────────────────────────────────────

const theme = getActiveTheme();

// Couleurs "world" exposées comme un objet PALETTE pour les call sites
// existants qui font PALETTE.shrineAccent etc. Le mapping suit la convention
// du Sanctuaire mais les valeurs viennent du thème actif (donc neon vs
// sanctuaire pointe sur des hex différents).
export const PALETTE = {
  // Atmosphère
  nightDeep: theme.palette.clearColor,
  fogMid: theme.palette.fogColor,
  groundBase: theme.palette.clearColor, // pas utilisé par neon (shader baked)
  groundMid: theme.palette.fogColor,
  groundHighlight: theme.palette.playerLocal.primary,

  // Joueurs
  playerLocalPrimary: theme.palette.playerLocal.primary,
  playerLocalAccent: theme.palette.playerLocal.accent,
  playerLocalAccentDim: theme.palette.playerLocal.accentDim,
  playerRemotePrimary: theme.palette.playerRemote.primary,
  playerRemoteAccent: theme.palette.playerRemote.accent,
  playerRemoteAccentDim: theme.palette.playerRemote.accentDim,

  // Décor — exposés depuis decor variant
  shrinePrimary:
    theme.decor.kind === "spirit" ? theme.decor.shrineCore : theme.decor.shrineCore,
  shrineAccent:
    theme.decor.kind === "spirit" ? theme.decor.shrineHalo : theme.decor.shrineHalo,
  mushroomGlow:
    theme.decor.kind === "spirit" ? theme.decor.obeliskInner : theme.decor.obeliskInner,
  groveFoliage:
    theme.decor.kind === "spirit" ? theme.decor.mossColor : theme.decor.bushFoliage,
  groveAccent:
    theme.decor.kind === "spirit" ? theme.decor.mushroomCap : theme.decor.bushAccent,

  // Limites
  boundary: theme.palette.boundary,
  dangerAccent: theme.palette.fx.deathExplosion,

  // Or sacré (présent dans les deux thèmes mais utilisé différemment)
  sacredGold:
    theme.decor.kind === "spirit"
      ? theme.decor.shrineCore
      : theme.palette.fx.tierUpHi,
} as const;

// Couleurs raretés / powerups : pointent directement sur le thème.
export const RARITY_COLOR: Record<BladeRarity, number> = theme.palette.rarityColor;
export const POWERUP_COLOR: Record<PowerUpType, number> = theme.palette.powerUpColor;
export const RARITY_GLOW_COMP: Record<BladeRarity, number> = theme.palette.rarityGlowComp;
