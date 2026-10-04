import { DEATH_LOOT_WINDOW_MS, RECENT_LOSS_BUFFER_CAP } from "@bladeio/shared";
import { Blade } from "../state/Blade";
import { Player } from "../state/Player";

// Plus haut nombre de lames d'un joueur sur DEATH_LOOT_WINDOW_MS : c'est le
// butin de sa mort. File monotone décroissante (relevés plus récents et plus
// petits à la fin) : relevé et lecture en O(1) amorti, à chaque tick. Relevé
// en début de tick : il compte ce que les ticks précédents ont changé.
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

// Lames que la mort de p fait tomber : son pic de la fenêtre, moins celles
// sorties de son orbite depuis ce pic qui sont encore dans le monde ailleurs
// que dans son orbite (traînée de boost, lancers en vol ou retombés, même
// ramassés par un autre). Son pic retourne ainsi au monde en entier, sans
// doublon : au banc, ce doublon faisait un tiers du butin de mort.
export function deathLootCount(p: Player, blades: { get(id: string): Blade | undefined }, now: number): number {
  const cutoff = now - DEATH_LOOT_WINDOW_MS;
  let peak = p.bladeCount;
  let at = Infinity;
  for (let i = 0; i < p.peakTs.length; i++) {
    if (p.peakTs[i] < cutoff) continue;
    if (p.peakCount[i] > peak) {
      peak = p.peakCount[i];
      at = p.peakTs[i];
    }
    break;
  }
  // Le relevé du pic précède les changements de son tick : une lame sortie
  // au même instant est sortie après lui.
  let away = 0;
  for (const r of p.released) {
    if (r.ts < at) continue;
    const b = blades.get(r.id);
    if (b && b.ownerId !== p.id) away++;
  }
  return Math.max(p.bladeCount, peak - away);
}

export function resetBladePeak(p: Player): void {
  p.peakTs.length = 0;
  p.peakCount.length = 0;
  p.released.length = 0;
}

// Lame sortie de l'orbite de p en restant dans le monde (posée au boost,
// lancée), cf. deathLootCount.
export function recordRelease(p: Player, id: string, now: number): void {
  p.released.push({ id, ts: now });
  const cutoff = now - DEATH_LOOT_WINDOW_MS;
  while (p.released.length > 0 && p.released[0].ts < cutoff) p.released.shift();
}

// Lame perdue par p du fait de `by` ("" : mur, échéance...). Lue au drop de
// la mort de p (raretés du butin) et quand p tue `by` : il récupère les
// lames qu'il a perdues contre lui. `thrown` : lancée par p et consommée sur
// `by`, pas un dégât subi (cf. BotController.recentDamageRate).
export function recordLoss(p: Player, rarity: number, by: string, now: number, thrown = false): void {
  p.recentLosses.push({ rarity, ts: now, by, thrown });
  if (p.recentLosses.length > RECENT_LOSS_BUFFER_CAP) p.recentLosses.shift();
}
