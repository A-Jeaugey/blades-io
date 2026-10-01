import { levelProgress, titleForLevel } from "@bladeio/shared";
import { I18nKey, formatNumber, t } from "../i18n";

// Niveau de compte (tâche 5.2) mis en texte : lobby, profil, fin de vie.

export function titleName(level: number): string {
  return t(`title.${titleForLevel(level)}` as I18nKey);
}

export interface LevelText {
  level: number;
  // « NIV. 12 »
  short: string;
  // « Niveau 12 · Duelliste »
  full: string;
  // « 1 230 / 2 017 XP » (dans le niveau)
  xp: string;
  fraction: number;
}

export function levelText(xp: number): LevelText {
  const p = levelProgress(xp);
  return {
    level: p.level,
    short: t("level.short", { n: p.level }),
    full: t("level.full", { n: p.level, title: titleName(p.level) }),
    xp: t("level.xp", { current: formatNumber(p.current, 0), needed: formatNumber(p.needed, 0) }),
    fraction: p.fraction,
  };
}
