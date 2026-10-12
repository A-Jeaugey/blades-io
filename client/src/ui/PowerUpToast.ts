import { onLangChange } from "../i18n";

// Bandeau du ramassage d'un power-up (« VITESSE · 5 s », puis « +60 % de
// vitesse »), sous les badges d'effet, le temps de le lire : là où le badge
// du nouvel effet vient d'apparaître, et sur deux lignes pour rester étroit
// dans cette colonne. Pas dans la file des bandeaux du haut (défis,
// évènements, 4 s chacun) : un ramassage toutes les 20 à 30 s les aurait
// retardés. Le suivant remplace le précédent.
const SHOW_MS = 3200;

export class PowerUpToast {
  private el: HTMLElement | null;
  private titleEl: HTMLElement;
  private effectEl: HTMLElement;
  private timer = 0;

  constructor() {
    this.el = document.getElementById("powerup-toast");
    this.titleEl = document.createElement("span");
    this.titleEl.className = "put-title";
    this.effectEl = document.createElement("span");
    this.effectEl.className = "put-effect";
    this.el?.append(this.titleEl, this.effectEl);
    // Texte d'une autre langue : il ne reste que quelques secondes, on le
    // retire plutôt que de le réécrire.
    onLangChange(() => this.hide());
  }

  // color : « #rrggbb », celle du power-up dans le thème actif.
  show(title: string, effect: string, color: string): void {
    const el = this.el;
    if (!el) return;
    this.titleEl.textContent = title;
    this.effectEl.textContent = effect;
    el.style.setProperty("--fx-color", color);
    el.classList.remove("show");
    // Relance l'animation d'entrée quand un ramassage en remplace un autre.
    void el.offsetWidth;
    el.classList.add("show");
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.hide(), SHOW_MS);
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.el?.classList.remove("show");
  }
}
