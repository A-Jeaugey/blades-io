import * as THREE from "three";
import { PlayerView } from "../entities/PlayerView";

// ─────────────────────────────────────────────────────────────────────────────
// NametagOverlay — étiquettes 2D positionnées en screen-space au-dessus
// des joueurs distants.
//
// Implémentation : DOM overlay (un <div> par joueur) plutôt que sprite
// Three.js avec CanvasTexture. Pourquoi DOM :
//   - Texte plus crisp (pas de filtrage texture)
//   - CSS theme-aware out of the box (utilise --cyan, --pink, etc.)
//   - Pas de coût allocation canvas + texture upload à chaque changement
//     de pseudo (rename, kill, etc.)
//
// Coût par frame : 1 projection Vector3 + 1 setStyle par joueur visible.
// O(60) trivial même au pic.
//
// On NE rend PAS le nametag du joueur local — il sait qui il est, et
// l'avoir au milieu de l'écran cache son propre avatar.
// ─────────────────────────────────────────────────────────────────────────────

interface TagEntry {
  el: HTMLDivElement;
  lastName: string;
}

// Distance world au-delà de laquelle on cache complètement le nametag.
// 60 unités = ~à la limite du visible à zoom standard. Plus loin, le
// joueur est trop petit pour qu'on lise son pseudo de toute façon.
const HIDE_DISTANCE = 60;
// Distance world en-dessous de laquelle le nametag est en pleine opacité.
// Entre les deux, fade linéaire.
const FULL_OPACITY_DISTANCE = 25;

export class NametagOverlay {
  private container: HTMLElement;
  private tags = new Map<string, TagEntry>();
  private enabled = false;
  private projected = new THREE.Vector3();

  constructor() {
    this.container = document.getElementById("nametag-layer")!;
  }

  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    if (on) {
      this.container.classList.remove("hidden");
    } else {
      this.container.classList.add("hidden");
      // Retire tous les tags pour libérer la mémoire — ils seront
      // recréés à la volée si l'user re-toggle.
      this.clear();
    }
  }

  // Appelée chaque frame depuis main.ts si enabled. Met à jour la position
  // de chaque tag visible, masque ceux trop loin / hors champ / morts.
  update(
    players: Map<string, PlayerView>,
    localId: string,
    isAlive: (id: string) => boolean,
    nameOf: (id: string) => string,
    isHidden: (id: string) => boolean,
    camera: THREE.PerspectiveCamera,
    width: number,
    height: number,
  ): void {
    if (!this.enabled) return;

    const localView = players.get(localId);
    const lx = localView?.renderX ?? 0;
    const ly = localView?.renderY ?? 0;

    const stillPresent = new Set<string>();

    players.forEach((view, id) => {
      // Skip self.
      if (id === localId) return;
      if (!isAlive(id) || isHidden(id)) return;

      stillPresent.add(id);

      // Distance au joueur local pour le fade. Si très loin, on skip
      // direct (pas la peine de projeter).
      const dx = view.renderX - lx;
      const dy = view.renderY - ly;
      const dist = Math.hypot(dx, dy);
      if (dist > HIDE_DISTANCE) {
        // Toujours créer/cacher pour éviter de constamment churner du
        // DOM ; ce sera display:none via opacity 0 + display none via
        // class.
        const tag = this.getOrCreateTag(id);
        tag.el.style.opacity = "0";
        tag.el.style.display = "none";
        return;
      }

      // Position monde au-dessus de la tête du joueur.
      // Player head visuel ~y=1.55, on tag à y=2.55 (juste au-dessus).
      this.projected.set(view.renderX, 2.55, view.renderY);
      // .project() transforme world → NDC (-1..1).
      this.projected.project(camera);
      // NDC z hors [-1..1] = derrière la caméra ou trop loin du clipping
      // far plane. On hide.
      if (this.projected.z < -1 || this.projected.z > 1) {
        const tag = this.getOrCreateTag(id);
        tag.el.style.opacity = "0";
        tag.el.style.display = "none";
        return;
      }

      // NDC → pixel coords (origine top-left, y vers le bas).
      const screenX = (this.projected.x * 0.5 + 0.5) * width;
      const screenY = (-this.projected.y * 0.5 + 0.5) * height;

      // Fade linéaire entre FULL_OPACITY_DISTANCE et HIDE_DISTANCE.
      const fadeT = Math.min(1, Math.max(0,
        (HIDE_DISTANCE - dist) / (HIDE_DISTANCE - FULL_OPACITY_DISTANCE)
      ));

      const tag = this.getOrCreateTag(id);
      // Update name si change (rename, etc.)
      const name = nameOf(id);
      if (name !== tag.lastName) {
        tag.el.textContent = name;
        tag.lastName = name;
      }
      tag.el.style.display = "";
      tag.el.style.opacity = String(fadeT);
      // translate(-50%, -100%) : centre horizontalement + ancre par le
      // BAS du label sur la position projetée → le tag flotte au-dessus
      // de la tête sans la chevaucher.
      tag.el.style.transform = `translate(${screenX}px, ${screenY}px) translate(-50%, -100%)`;
    });

    // Cleanup : retire les tags des joueurs disparus (déco, kill, etc).
    for (const [id, tag] of this.tags) {
      if (!stillPresent.has(id)) {
        tag.el.remove();
        this.tags.delete(id);
      }
    }
  }

  private getOrCreateTag(id: string): TagEntry {
    let tag = this.tags.get(id);
    if (!tag) {
      const el = document.createElement("div");
      el.className = "nametag";
      this.container.appendChild(el);
      tag = { el, lastName: "" };
      this.tags.set(id, tag);
    }
    return tag;
  }

  clear(): void {
    for (const tag of this.tags.values()) tag.el.remove();
    this.tags.clear();
  }
}
