import { CrateKind, VAULT_PLAYER_DPS } from "@bladeio/shared";
import { Crate } from "../state/Crate";

// Dégâts portés à une caisse par une lame (en orbite ou lancée) : PV
// retirés, renvoie ce qui a compté. Coffre-fort : un même joueur n'y fait
// pas plus de VAULT_PLAYER_DPS par seconde. Sa réserve se remplit à ce
// débit, jusqu'à une seconde d'avance : un coup qui la dépasse est réduit,
// à réserve vide il ne compte pas. Sans ce plafond, le temps d'ouverture
// suivait la taille de l'orbite (une lame touche jusqu'à 5 fois par
// seconde) et le plus gros l'ouvrait avant que quiconque arrive.
export function damageCrate(crate: Crate, attackerId: string | null, dmg: number, nowMs: number): number {
  let dealt = Math.min(dmg, crate.hp);
  if (crate.kind === CrateKind.Vault && attackerId) {
    let entry = crate.credits.get(attackerId);
    if (!entry) {
      entry = { credit: VAULT_PLAYER_DPS, at: nowMs };
      crate.credits.set(attackerId, entry);
    }
    entry.credit = Math.min(VAULT_PLAYER_DPS, entry.credit + ((nowMs - entry.at) / 1000) * VAULT_PLAYER_DPS);
    entry.at = nowMs;
    dealt = Math.min(dealt, Math.floor(entry.credit));
    if (dealt <= 0) return 0;
    entry.credit -= dealt;
  }
  crate.hp = Math.max(0, crate.hp - dealt);
  return dealt;
}
