import { CrateKind, PULSE_PLAYER_DPS, VAULT_PLAYER_DPS } from "@bladeio/shared";
import { Crate } from "../state/Crate";

// Dégâts qu'un même joueur peut faire par seconde à une caisse de ce genre
// (0 : pas de plafond) : coffre-fort, obélisque qui se charge.
function playerDpsCap(kind: number): number {
  if (kind === CrateKind.Vault) return VAULT_PLAYER_DPS;
  if (kind === CrateKind.Obelisk) return PULSE_PLAYER_DPS;
  return 0;
}

// Dégâts portés à une caisse par une lame (en orbite ou lancée) : PV
// retirés, renvoie ce qui a compté. Coffre-fort et obélisque : un même
// joueur n'y fait pas plus que leur plafond par seconde (VAULT_PLAYER_DPS). Sa réserve se remplit à ce
// débit, jusqu'à une seconde d'avance : un coup qui la dépasse est réduit,
// à réserve vide il ne compte pas. Sans ce plafond, le temps d'ouverture
// suivait la taille de l'orbite (une lame touche jusqu'à 5 fois par
// seconde) et le plus gros l'ouvrait avant que quiconque arrive.
export function damageCrate(crate: Crate, attackerId: string | null, dmg: number, nowMs: number): number {
  let dealt = Math.min(dmg, crate.hp);
  const cap = playerDpsCap(crate.kind);
  if (cap > 0 && attackerId) {
    let entry = crate.credits.get(attackerId);
    if (!entry) {
      entry = { credit: cap, at: nowMs };
      crate.credits.set(attackerId, entry);
    }
    entry.credit = Math.min(cap, entry.credit + ((nowMs - entry.at) / 1000) * cap);
    entry.at = nowMs;
    dealt = Math.min(dealt, Math.floor(entry.credit));
    if (dealt <= 0) return 0;
    entry.credit -= dealt;
  }
  crate.hp = Math.max(0, crate.hp - dealt);
  crate.lastDamageAt = nowMs;
  return dealt;
}
