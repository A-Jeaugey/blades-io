import type { CosmeticId, CosmeticSlot, GameModeId } from "@bladeio/shared";
import { en } from "./en";
import { fr } from "./fr";

// Traduction de l'interface (tâche 3.7, décision D1) : français et anglais
// complets ; langue choisie dans les réglages, sinon celle du navigateur,
// sinon l'anglais.
//
// - Texte fixe du HTML : attributs data-i18n (textContent), data-i18n-html
//   (innerHTML, pour les chaînes du dictionnaire qui portent du balisage)
//   et data-i18n-attr="attribut:clé;…" ; appliqués par applyI18n().
// - Texte construit en TS : t(clé, paramètres). Les modules qui gardent du
//   texte déjà rendu s'abonnent à onLangChange() pour le refaire.
//
// Les dictionnaires sont de confiance (data-i18n-html, innerHTML) ; les
// paramètres venus des joueurs (pseudos) sont échappés par l'appelant.

export type Lang = "fr" | "en";
export type I18nKey = keyof typeof en;

const DICTS: Record<Lang, Record<I18nKey, string>> = { en, fr };
const STORAGE_KEY = "blade.lang";

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "fr" || saved === "en") return saved;
  } catch {
    // Stockage indisponible : langue du navigateur.
  }
  const langs = typeof navigator === "undefined"
    ? []
    : navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const l of langs) {
    const p = (l ?? "").slice(0, 2).toLowerCase();
    if (p === "fr" || p === "en") return p;
  }
  return "en";
}

let current: Lang = detect();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

function format(s: string, params?: Record<string, string | number>): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

// Nombre à décimales fixes, au format de la langue (virgule en français).
export function formatNumber(x: number, digits: number): string {
  return x.toLocaleString(current === "fr" ? "fr-FR" : "en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function t(key: I18nKey, params?: Record<string, string | number>): string {
  return format(DICTS[current][key] ?? en[key] ?? key, params);
}

// Clé construite à l'exécution (ex. nom d'un thème) : repli sur `fallback`
// si le dictionnaire ne la connaît pas.
export function tOr(key: string, fallback: string, params?: Record<string, string | number>): string {
  const s = (DICTS[current] as Record<string, string>)[key] ?? (en as Record<string, string>)[key];
  return s === undefined ? fallback : format(s, params);
}

// Nom et accroche d'un thème : dictionnaire, à défaut ceux du thème (un
// nouveau thème s'affiche donc avant d'être traduit).
export function themeName(theme: { id: string; displayName: string }): string {
  return tOr(`theme.${theme.id}.name`, theme.displayName);
}
export function themeTagline(theme: { id: string; tagline?: string }): string {
  return tOr(`theme.${theme.id}.tagline`, theme.tagline ?? "");
}

// Nom et description d'un cosmétique (tâche 6.2) ; id "" = l'apparence de
// base de l'emplacement. Le compilateur exige ces clés dans en.ts pour tout
// le catalogue partagé.
type CosmeticKey = `cos.${CosmeticId | `base.${CosmeticSlot}`}`;
export function cosmeticName(slot: CosmeticSlot, id: string): string {
  return t(`cos.${id || `base.${slot}`}` as CosmeticKey);
}
export function cosmeticDesc(slot: CosmeticSlot, id: string): string {
  return t(`cos.${id || `base.${slot}`}.desc` as `${CosmeticKey}.desc`);
}

// Nom et accroche d'un mode de jeu (tâche 7.3) : le compilateur exige les
// deux clés pour chaque mode du registre partagé.
export function gameModeName(id: GameModeId): string {
  return t(`mode.${id}.name` as `mode.${GameModeId}.name`);
}
export function gameModeHint(id: GameModeId): string {
  return t(`mode.${id}.hint` as `mode.${GameModeId}.hint`);
}

export function applyI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n as I18nKey);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-html]").forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml as I18nKey);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-attr]").forEach((el) => {
    for (const pair of (el.dataset.i18nAttr ?? "").split(";")) {
      const [attr, key] = pair.split(":").map((x) => x.trim());
      if (attr && key) el.setAttribute(attr, t(key as I18nKey));
    }
  });
  if (typeof document !== "undefined") document.documentElement.lang = current;
}

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Choix valable pour la session.
  }
  applyI18n();
  for (const cb of listeners) cb();
}

export function onLangChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
