import {
  BladeRarity,
  POWERUP_BLADES_COUNT,
  POWERUP_MAGNET_MULT,
  POWERUP_SPEED_MULT,
  POWERUP_SPIN_DAMAGE_MULT,
  POWERUP_SPIN_MULT,
  PowerUpType,
} from "@bladeio/shared";
import { I18nKey, formatNumber, t } from "../i18n";

// Ce que fait chaque power-up, en clair (retour de jeu du 2026-10-12 :
// « la rotation elle sert à quoi en vrai ?? ») : bandeau au ramassage,
// infobulle des badges d'effet, icônes de la page « How to play ». Les
// chiffres viennent des constantes partagées : un rééquilibrage met les
// textes à jour.

const NAMES: Record<PowerUpType, I18nKey> = {
  [PowerUpType.Speed]: "hud.fxSpeed",
  [PowerUpType.Spin]: "hud.fxSpin",
  [PowerUpType.Magnet]: "hud.fxMagnet",
  [PowerUpType.Shield]: "hud.fxShield",
  [PowerUpType.Blades]: "pu.blades.name",
};

const RARITY_KEYS: Record<BladeRarity, I18nKey> = {
  [BladeRarity.Common]: "pu.rarity.0",
  [BladeRarity.Rare]: "pu.rarity.1",
  [BladeRarity.Epic]: "pu.rarity.2",
  [BladeRarity.Legendary]: "pu.rarity.3",
};

// Pourcentage d'un multiplicateur (1,6 → 60).
function pct(mult: number): number {
  return Math.round((mult - 1) * 100);
}

// Multiplicateur lisible (1,5 → « 1,5 », 3 → « 3 »).
function times(mult: number): string {
  return formatNumber(mult, Number.isInteger(mult) ? 0 : 1);
}

export function powerUpName(type: PowerUpType): string {
  return t(NAMES[type] ?? "pu.blades.name");
}

// Effet en quelques mots (« +60 % de vitesse »). rarity : seulement pour
// Blades, dont le nombre et la rareté des lames en dépendent.
export function powerUpEffect(type: PowerUpType, rarity: BladeRarity = BladeRarity.Common): string {
  switch (type) {
    case PowerUpType.Speed: return t("pu.speed.effect", { pct: pct(POWERUP_SPEED_MULT) });
    case PowerUpType.Spin: return t("pu.spin.effect", { pct: pct(POWERUP_SPIN_MULT), dmg: times(POWERUP_SPIN_DAMAGE_MULT) });
    case PowerUpType.Magnet: return t("pu.magnet.effect", { mult: times(POWERUP_MAGNET_MULT) });
    case PowerUpType.Shield: return t("pu.shield.effect");
    case PowerUpType.Blades: return t("pu.blades.effect", { n: POWERUP_BLADES_COUNT[rarity], rarity: t(RARITY_KEYS[rarity]) });
  }
  return "";
}

// Bandeau du ramassage, sur deux lignes : « VITESSE · 5 s », puis
// « +60 % de vitesse ». durationMs : celle que le serveur a appliquée
// (améliorations comprises), 0 pour un effet instantané.
export function powerUpToast(type: PowerUpType, rarity: BladeRarity, durationMs: number): { title: string; effect: string } {
  const name = powerUpName(type);
  const effect = powerUpEffect(type, rarity);
  if (durationMs <= 0) return { title: name, effect };
  const s = durationMs / 1000;
  return { title: t("pu.toastTitle", { name, s: formatNumber(s, Math.abs(s - Math.round(s)) < 0.05 ? 0 : 1) }), effect };
}

// Infobulle d'un badge d'effet du HUD.
export function powerUpTip(type: PowerUpType): string {
  return t("pu.tip", { name: powerUpName(type), effect: powerUpEffect(type) });
}

// Icônes de la page « How to play » : les formes de PowerUpView (mêmes
// coordonnées, y vers le haut), en SVG construit ici, rien de stocké.
type Pt = [number, number];

function arc(cx: number, cy: number, r: number, a0: number, a1: number, steps = 18): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

function quad(p0: Pt, c: Pt, p1: Pt, steps = 12): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    const v = 1 - u;
    out.push([v * v * p0[0] + 2 * v * u * c[0] + u * u * p1[0], v * v * p0[1] + 2 * v * u * c[1] + u * u * p1[1]]);
  }
  return out;
}

function shapesFor(type: PowerUpType): Pt[][] {
  switch (type) {
    case PowerUpType.Speed: {
      const chevron = (dx: number): Pt[] => [
        [-0.35 + dx, 0.65], [0.05 + dx, 0.65], [0.55 + dx, 0], [0.05 + dx, -0.65], [-0.35 + dx, -0.65], [0.15 + dx, 0],
      ];
      return [chevron(0.2), chevron(-0.4)];
    }
    case PowerUpType.Spin: {
      const a0 = 0.5, a1 = Math.PI * 1.75, ro = 0.85, ri = 0.55;
      const ring = [...arc(0, 0, ro, a0, a1), ...arc(0, 0, ri, a1, a0)];
      const head: Pt[] = [
        [Math.cos(a0) * 0.35, Math.sin(a0) * 0.35],
        [Math.cos(a0) * 1.05, Math.sin(a0) * 1.05],
        [Math.cos(a0 - 0.55) * 0.7, Math.sin(a0 - 0.55) * 0.7],
      ];
      return [ring, head];
    }
    case PowerUpType.Magnet:
      return [[
        [-0.8, 0.65], ...arc(0, 0, 0.8, Math.PI, Math.PI * 2), [0.8, 0.65], [0.42, 0.65],
        ...arc(0, 0, 0.42, 0, -Math.PI), [-0.42, 0.65],
      ]];
    case PowerUpType.Shield:
      return [[[-0.7, 0.75], [0.7, 0.75], ...quad([0.7, 0.75], [0.78, -0.2], [0, -0.95]), ...quad([0, -0.95], [-0.78, -0.2], [-0.7, 0.75])]];
    case PowerUpType.Blades: {
      const star: Pt[] = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r = i % 2 === 0 ? 1.0 : 0.3;
        star.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      // Trou central (fill-rule evenodd).
      return [star, arc(0, 0, 0.14, 0, Math.PI * 2, 12)];
    }
  }
  return [];
}

// Balisage SVG d'une icône, à la couleur donnée (« #rrggbb », celle du
// power-up dans le thème actif).
export function powerUpIconSvg(type: PowerUpType, color: string): string {
  const d = shapesFor(type)
    .map((pts) => "M" + pts.map(([x, y]) => `${x.toFixed(3)} ${(-y).toFixed(3)}`).join("L") + "Z")
    .join("");
  return `<svg viewBox="-1.1 -1.1 2.2 2.2" aria-hidden="true" focusable="false"><path d="${d}" fill="${color}" fill-rule="evenodd"/></svg>`;
}
