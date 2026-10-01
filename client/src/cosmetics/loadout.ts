import { COSMETIC_SLOTS, CosmeticSlot, DEFAULT_LOADOUT, Loadout, getCosmetic } from "@bladeio/shared";

// Équipement choisi sur cet appareil (tâche 6.1) : proposé au serveur en
// entrant en partie, qui ne garde que ce qui appartient au joueur. Pas de
// rechargement : la prochaine partie le porte.

const STORAGE_KEY = "blade.loadout";
const listeners = new Set<() => void>();

function read(): Loadout {
  const out: Loadout = { ...DEFAULT_LOADOUT };
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (raw && typeof raw === "object") {
      for (const slot of COSMETIC_SLOTS) {
        const id = raw[slot];
        if (typeof id === "string" && (id === "" || getCosmetic(id)?.slot === slot)) out[slot] = id;
      }
    }
  } catch { /* stockage indisponible ou illisible : apparence de base */ }
  return out;
}

let current = read();

export function getLoadout(): Loadout {
  return { ...current };
}

export function equip(slot: CosmeticSlot, id: string): void {
  current = { ...current, [slot]: id };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch { /* idem */ }
  for (const l of listeners) l();
}

export function subscribeLoadout(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
