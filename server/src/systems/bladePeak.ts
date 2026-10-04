import { DEATH_LOOT_WINDOW_MS, RECENT_LOSS_BUFFER_CAP } from "@bladeio/shared";
import { Player } from "../state/Player";

// Plus haut nombre de lames d'un joueur sur DEATH_LOOT_WINDOW_MS : c'est le
// butin de sa mort. File monotone décroissante (relevés plus récents et plus
// petits à la fin) : relevé et lecture en O(1) amorti, à chaque tick.
export function trackBladePeak(p: Player, now: number): void {
  const ts = p.peakTs;
  const counts = p.peakCount;
  const count = p.bladeCount;
  while (counts.length > 0 && counts[counts.length - 1] <= count) {
    counts.pop();
    ts.pop();
  }
  counts.push(count);
  ts.push(now);
  const cutoff = now - DEATH_LOOT_WINDOW_MS;
  while (ts.length > 1 && ts[0] < cutoff) {
    ts.shift();
    counts.shift();
  }
}

export function bladePeak(p: Player, now: number): number {
  const cutoff = now - DEATH_LOOT_WINDOW_MS;
  for (let i = 0; i < p.peakTs.length; i++) {
    if (p.peakTs[i] >= cutoff) return Math.max(p.peakCount[i], p.bladeCount);
  }
  return p.bladeCount;
}

export function resetBladePeak(p: Player): void {
  p.peakTs.length = 0;
  p.peakCount.length = 0;
}

// Lame perdue par p du fait de `by` ("" : mur, échéance...). Lue au drop de
// la mort de p (raretés du butin) et quand p tue `by` : il récupère les
// lames qu'il a perdues contre lui. `thrown` : lancée par p et consommée sur
// `by`, pas un dégât subi (cf. BotController.recentDamageRate).
export function recordLoss(p: Player, rarity: number, by: string, now: number, thrown = false): void {
  p.recentLosses.push({ rarity, ts: now, by, thrown });
  if (p.recentLosses.length > RECENT_LOSS_BUFFER_CAP) p.recentLosses.shift();
}
