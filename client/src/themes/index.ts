import { Theme } from "./Theme";
import { NEON_THEME } from "./neon";
import { SANCTUAIRE_THEME } from "./sanctuaire";
import { FORGE_VERMEILLE_THEME } from "./forge-vermeille";
import { PROFONDEURS_GLACEES_THEME } from "./profondeurs-glacees";

export type { Theme } from "./Theme";
export type { DecorVariant } from "./Theme";

// Registre central des thèmes. Pour ajouter un thème : importer son module
// et l'ajouter ici. C'est aussi ce que la future boutique listera.
export const THEMES: Record<string, Theme> = {
  [NEON_THEME.id]: NEON_THEME,
  [SANCTUAIRE_THEME.id]: SANCTUAIRE_THEME,
  [FORGE_VERMEILLE_THEME.id]: FORGE_VERMEILLE_THEME,
  [PROFONDEURS_GLACEES_THEME.id]: PROFONDEURS_GLACEES_THEME,
};

export const DEFAULT_THEME_ID = NEON_THEME.id;

const STORAGE_KEY = "blade.theme";

// Cache local du thème actif. Les modules de rendu lisent ce cache une seule
// fois à l'init. Changement de thème runtime = reload de la page (acceptable
// vu que le thème est sélectionné en lobby, jamais en plein match).
let activeTheme: Theme = readActiveTheme();

function readActiveTheme(): Theme {
  if (typeof localStorage === "undefined") return THEMES[DEFAULT_THEME_ID];
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && THEMES[saved]) return THEMES[saved];
  return THEMES[DEFAULT_THEME_ID];
}

export function getActiveTheme(): Theme {
  return activeTheme;
}

export function setActiveTheme(id: string): void {
  if (!THEMES[id]) {
    console.warn(`[theme] Unknown theme id "${id}", keeping ${activeTheme.id}.`);
    return;
  }
  if (id === activeTheme.id) return;
  activeTheme = THEMES[id];
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, id);
  }
}

export function listThemes(): Theme[] {
  return Object.values(THEMES);
}

// Helper : convertit un int hex (0xff8a3e) en chaîne CSS "#rrggbb".
function hexToCss(hex: number): string {
  return "#" + hex.toString(16).padStart(6, "0");
}

// Injecte les variables CSS du thème dans :root au boot. Permet aux règles
// CSS qui utilisent var(--cyan) etc. de basculer automatiquement quand on
// change de thème (sans recompiler le CSS). Doit être appelé avant la
// première frame de rendu DOM.
export function applyThemeCss(theme: Theme = activeTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const ui = theme.ui;
  // Noms de variables historiques préservés (--cyan, --pink, --purple…) pour
  // éviter de toucher à toutes les règles CSS du fichier styles.css.
  root.style.setProperty("--cyan", ui.accentCool);
  root.style.setProperty("--pink", ui.accentWarm);
  root.style.setProperty("--purple", ui.purple);
  root.style.setProperty("--dark", ui.dark);
  root.style.setProperty("--panel", ui.panelBg);
  root.style.setProperty("--panel-border", ui.panelBorder);
  root.style.setProperty("--fg-bright", ui.fgBright);
  root.style.setProperty("--fg-muted", ui.fgMuted);
  // RGB triplets pour les box-shadow / glow constructs en CSS.
  // Usage côté CSS : `rgba(var(--accent-cool-rgb), 0.X)`.
  root.style.setProperty("--accent-cool-rgb", ui.accentCoolRgb);
  root.style.setProperty("--accent-warm-rgb", ui.accentWarmRgb);
  // Couleurs des raretés pour les éléments UI qui les affichent (rarity
  // strip dots du login screen, badges éventuels). Tirées de
  // theme.palette.rarityColor pour rester cohérent avec le rendu 3D.
  const rc = theme.palette.rarityColor;
  root.style.setProperty("--rarity-common", hexToCss(rc[0 as 0]));     // BladeRarity.Common = 0
  root.style.setProperty("--rarity-rare", hexToCss(rc[1 as 1]));       // = 1
  root.style.setProperty("--rarity-epic", hexToCss(rc[2 as 2]));       // = 2
  root.style.setProperty("--rarity-legendary", hexToCss(rc[3 as 3]));  // = 3
}
