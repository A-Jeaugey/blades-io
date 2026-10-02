import type { Boutique } from "./Boutique";

// Boutique chargée à sa première ouverture : son code et son aperçu 3D ne
// pèsent pas sur le premier chargement de la page.
let boutique: Promise<Boutique> | null = null;

export function bindBoutiqueButton(): void {
  document.getElementById("open-boutique-btn")?.addEventListener("click", () => {
    boutique ??= import("./Boutique").then((m) => new m.Boutique());
    boutique.then(
      (b) => b.open(),
      (e) => {
        // Réseau coupé : on retentera au prochain clic.
        console.warn("[blade.io] boutique failed to load", e);
        boutique = null;
      },
    );
  });
}

// Boutique ouverte : le moniteur de qualité de main.ts se met en pause (son
// aperçu 3D fait baisser les FPS du lobby sans rien dire de la partie, et
// abaisser le preset hors partie recharge la page, en plein achat).
export function isBoutiqueOpen(): boolean {
  return !(document.getElementById("boutique")?.classList.contains("hidden") ?? true);
}
