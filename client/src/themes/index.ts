import { DANGER_COLOR, PREY_COLOR, Theme, computeRarityGlowComp } from "./Theme";
import { COLORBLIND_DANGER_COLOR, COLORBLIND_PREY_COLOR, COLORBLIND_RARITY_COLOR } from "./colorblind";
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
const COLORBLIND_KEY = "blade.colorblind";

// Palette daltonienne (tâche 3.8) : lue une fois au démarrage, comme le
// thème, puisque les matériaux sont construits avec. La changer demande un
// rechargement.
const colorblind = readColorblindChoice();

function readColorblindChoice(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(COLORBLIND_KEY) === "1";
}

// Thème tel qu'il est rendu : la palette daltonienne remplace les couleurs
// des raretés. Les thèmes du registre (boutique, sélecteur) restent intacts.
function resolve(theme: Theme): Theme {
  if (!colorblind) return theme;
  return {
    ...theme,
    palette: {
      ...theme.palette,
      rarityColor: COLORBLIND_RARITY_COLOR,
      rarityGlowComp: computeRarityGlowComp(COLORBLIND_RARITY_COLOR),
    },
  };
}

// Cache local du thème actif. Les modules de rendu lisent ce cache une seule
// fois à l'init. Changement de thème runtime = reload de la page (acceptable
// vu que le thème est sélectionné en lobby, jamais en plein match).
let activeTheme: Theme = resolve(readActiveTheme());

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
  activeTheme = resolve(THEMES[id]);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, id);
  }
}

export function listThemes(): Theme[] {
  return Object.values(THEMES);
}

// Palette daltonienne du rendu en cours (lue au démarrage).
export function isColorblindActive(): boolean {
  return colorblind;
}

// Choix enregistré de la palette daltonienne (celui du prochain démarrage).
export function colorblindChoice(): boolean {
  return readColorblindChoice();
}

export function setColorblindChoice(on: boolean): void {
  if (typeof localStorage === "undefined") return;
  if (on) localStorage.setItem(COLORBLIND_KEY, "1");
  else localStorage.removeItem(COLORBLIND_KEY);
}

// Couleurs de menace en vigueur, communes à tous les thèmes (nametags,
// alerte de bordure, minimap).
export const THREAT_COLORS: Readonly<{ danger: number; prey: number }> = colorblind
  ? { danger: COLORBLIND_DANGER_COLOR, prey: COLORBLIND_PREY_COLOR }
  : { danger: DANGER_COLOR, prey: PREY_COLOR };

// Helper : convertit un int hex (0xff8a3e) en chaîne CSS "#rrggbb".
function hexToCss(hex: number): string {
  return "#" + hex.toString(16).padStart(6, "0");
}

// "R, G, B" pour les constructions CSS rgba(var(--x-rgb), a).
function rgbTriplet(hex: number): string {
  return `${(hex >> 16) & 255}, ${(hex >> 8) & 255}, ${hex & 255}`;
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
  // Couleurs de menace communes à tous les thèmes (nametags, alertes).
  root.style.setProperty("--danger-rgb", rgbTriplet(THREAT_COLORS.danger));
  root.style.setProperty("--prey-rgb", rgbTriplet(THREAT_COLORS.prey));
  // Équipes (tâche 7.2) : la sienne à la couleur de son propre anneau, les
  // adversaires à celle des autres joueurs (minimap, nametags, drapeaux).
  root.style.setProperty("--ally-rgb", rgbTriplet(theme.palette.playerLocal.accent));
  root.style.setProperty("--foe-rgb", rgbTriplet(theme.palette.playerRemote.accent));
  // Couleurs des raretés pour les éléments UI qui les affichent (rarity
  // strip dots du login screen, badges éventuels). Tirées de
  // theme.palette.rarityColor pour rester cohérent avec le rendu 3D.
  const rc = theme.palette.rarityColor;
  root.style.setProperty("--rarity-common", hexToCss(rc[0 as 0]));     // BladeRarity.Common = 0
  root.style.setProperty("--rarity-rare", hexToCss(rc[1 as 1]));       // = 1
  root.style.setProperty("--rarity-epic", hexToCss(rc[2 as 2]));       // = 2
  root.style.setProperty("--rarity-legendary", hexToCss(rc[3 as 3]));  // = 3
}
