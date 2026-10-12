import type { ChallengesResponse } from "@bladeio/shared";
import type { QuestsPanel } from "./QuestsPanel";
import { fetchChallenges } from "./challenges";

// Bouton QUÊTES du lobby (retours du 2026-10-12) : défis, niveaux et
// améliorations des power-ups. Le panneau se charge à sa première ouverture,
// comme la boutique : il ne pèse pas sur le premier chargement. Seul le
// compteur des défis du jour, sur le bouton, reste dans le lobby.

let panel: Promise<QuestsPanel> | null = null;

export function bindQuestsButton(): void {
  document.getElementById("open-quests-btn")?.addEventListener("click", () => {
    panel ??= import("./QuestsPanel").then((m) => new m.QuestsPanel());
    panel.then(
      (p) => p.open(),
      (e) => {
        // Réseau coupé : on retentera au prochain clic.
        console.warn("[blade.io] quests failed to load", e);
        panel = null;
      },
    );
  });
}

// Défis réussis du jour sur le bouton (« 1/3 »), relus à chaque retour au
// lobby ; le panneau le met aussi à jour quand il relit les défis.
export async function refreshQuestsBadge(): Promise<void> {
  renderQuestsBadge(await fetchChallenges());
}

export function renderQuestsBadge(c: ChallengesResponse | null): void {
  const badge = document.getElementById("quests-badge");
  if (!badge) return;
  const daily = c?.day.challenges;
  if (!daily) {
    badge.classList.add("hidden");
    return;
  }
  const done = daily.filter((ch) => ch.completed).length;
  badge.textContent = `${done}/${daily.length}`;
  badge.classList.toggle("done", done === daily.length);
  badge.classList.remove("hidden");
}
