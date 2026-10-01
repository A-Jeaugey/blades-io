import { QualityPreset, detectPreset, savePresetChoice } from "../quality";
import { colorblindChoice, getActiveTheme, isColorblindActive, listThemes, setActiveTheme, setColorblindChoice } from "../themes";
import { isOwned } from "../boutique/owned";
import { Haptics } from "../fx/Haptics";
import { I18nKey, Lang, getLang, onLangChange, setLang, t, themeName } from "../i18n";
import { showConfirm } from "./Dialog";
import { reloadAtMenu } from "./pendingReload";

export interface SettingsState {
  master: number;
  music: number;
  sfx: number;
  qualityChoice: "auto" | QualityPreset;
  joystickSens: number;
  // Affichage des nametags au-dessus des joueurs distants proches (le
  // joueur local n'en a pas). Actifs par défaut : le nombre de lames et la
  // couleur de menace aident à décider qui attaquer ou fuir.
  showNametags: boolean;
  // Vibrations au coup et à l'élimination (tactile, si le navigateur les
  // permet).
  vibration: boolean;
  // Secousse de l'écran, de 0 à 1 (tâche 3.8). null : valeur par défaut,
  // qui suit la préférence système « réduire les animations » tant que le
  // joueur n'a pas touché au curseur (cf. shakeIntensity).
  shake: number | null;
  // Flashs, de 0 à 1 : blanc des lames qui s'entrechoquent, éclat des
  // particules, pulsation de l'alerte de bordure.
  flashes: number;
  // Version du format enregistré, pour les migrations de valeurs par défaut.
  settingsVersion: number;
}

// v2 : nametags actifs par défaut. En v1 ils étaient désactivés par défaut,
// et tout l'état était enregistré au premier réglage modifié : un « false »
// stocké en v1 est presque toujours l'ancien défaut, pas un choix.
const SETTINGS_VERSION = 2;

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Secousse effective : celle du curseur, sinon aucune si le système demande
// de réduire les animations.
export function shakeIntensity(s: SettingsState): number {
  return s.shake ?? (prefersReducedMotion() ? 0 : 1);
}

function formatPercent(v: number): string {
  return new Intl.NumberFormat(getLang() === "fr" ? "fr-FR" : "en-US", { style: "percent", maximumFractionDigits: 0 }).format(v);
}

export class SettingsPanel {
  private panel: HTMLElement;
  private inGame = false;
  private icon: HTMLElement;
  private state: SettingsState = {
    master: 0.7,
    music: 0.5,
    sfx: 0.8,
    qualityChoice: "auto",
    joystickSens: 1,
    showNametags: true,
    vibration: true,
    shake: null,
    flashes: 1,
    settingsVersion: SETTINGS_VERSION,
  };
  private listeners: Array<(s: SettingsState) => void> = [];
  private quitListeners: Array<() => void> = [];

  constructor() {
    this.panel = document.getElementById("settings-panel")!;
    this.icon = document.getElementById("settings-icon")!;
    this.icon.addEventListener("click", () => this.panel.classList.remove("hidden"));
    
    const loginIcon = document.getElementById("login-settings-icon");
    if (loginIcon) {
      loginIcon.addEventListener("click", () => this.panel.classList.remove("hidden"));
    }

    document.getElementById("close-settings")!.addEventListener("click", () => {
      this.panel.classList.add("hidden");
    });

    const quitBtn = document.getElementById("quit-match-btn");
    if (quitBtn) {
      quitBtn.addEventListener("click", () => {
        this.panel.classList.add("hidden");
        for (const cb of this.quitListeners) cb();
      });
    }

    const saved = localStorage.getItem("blade.settings");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<SettingsState>;
        if ((parsed.settingsVersion ?? 1) < 2) parsed.showNametags = true;
        this.state = { ...this.state, ...parsed, settingsVersion: SETTINGS_VERSION };
      } catch {}
    }
    this.bindRange("vol-master", "master");
    this.bindRange("vol-music", "music");
    this.bindRange("vol-sfx", "sfx");
    this.bindRange("joy-sens", "joystickSens");
    this.bindRange("shake-intensity", "shake");
    this.bindRange("flash-intensity", "flashes");
    const qSel = document.getElementById("quality-select") as HTMLSelectElement | null;
    if (qSel) {
      qSel.value = this.state.qualityChoice;
      qSel.addEventListener("change", () => {
        this.state.qualityChoice = qSel.value as SettingsState["qualityChoice"];
        if (this.state.qualityChoice === "auto") {
          localStorage.removeItem("blade.quality");
        } else {
          savePresetChoice(this.state.qualityChoice);
        }
        this.persist();
        this.emit();
        // Les matériaux et shaders sont construits au démarrage selon le
        // preset : il faut recharger la page.
        void this.applyWithReload("settings.qualityReload");
      });
    }

    // Sélecteur de thème — limité aux thèmes POSSÉDÉS (via boutique). Pour
    // débloquer un thème non listé, l'user doit passer par la boutique.
    // Un reload est nécessaire car les shaders/matériaux/lumières/CSS sont
    // construits au boot.
    const themeSel = document.getElementById("theme-select") as HTMLSelectElement | null;
    if (themeSel) {
      const activeId = getActiveTheme().id;
      const fillThemes = () => {
        themeSel.innerHTML = "";
        for (const theme of listThemes().filter((th) => isOwned(th.id))) {
          const opt = document.createElement("option");
          opt.value = theme.id;
          opt.textContent = themeName(theme);
          if (theme.id === activeId) opt.selected = true;
          themeSel.appendChild(opt);
        }
      };
      fillThemes();
      onLangChange(fillThemes);
      themeSel.addEventListener("change", () => {
        const newId = themeSel.value;
        if (newId === activeId) return;
        setActiveTheme(newId);
        void this.applyWithReload("settings.themeReload");
      });
    }

    // Langue (tâche 3.7) : appliquée tout de suite, sans rechargement.
    const langSel = document.getElementById("lang-select") as HTMLSelectElement | null;
    if (langSel) {
      langSel.value = getLang();
      langSel.addEventListener("change", () => setLang(langSel.value as Lang));
    }

    // Toggle "afficher les nametags". Pas de reload nécessaire — main.ts
    // observe l'état via onChange et fait la bascule live.
    const nametagsToggle = document.getElementById("nametags-toggle") as HTMLInputElement | null;
    if (nametagsToggle) {
      nametagsToggle.checked = this.state.showNametags;
      nametagsToggle.addEventListener("change", () => {
        this.state.showNametags = nametagsToggle.checked;
        this.persist();
        this.emit();
      });
    }

    // Palette daltonienne (tâche 3.8) : comme le thème, elle s'applique au
    // rechargement.
    const colorblindToggle = document.getElementById("colorblind-toggle") as HTMLInputElement | null;
    if (colorblindToggle) {
      colorblindToggle.checked = colorblindChoice();
      colorblindToggle.addEventListener("change", () => {
        setColorblindChoice(colorblindToggle.checked);
        if (colorblindToggle.checked === isColorblindActive()) return;
        void this.applyWithReload("settings.colorblindReload");
      });
    }

    // Vibrations : la ligne n'apparaît que si le navigateur sait vibrer.
    const vibrationToggle = document.getElementById("vibration-toggle") as HTMLInputElement | null;
    if (vibrationToggle) {
      vibrationToggle.closest("label")?.classList.toggle("hidden", !Haptics.available);
      vibrationToggle.checked = this.state.vibration;
      vibrationToggle.addEventListener("change", () => {
        this.state.vibration = vibrationToggle.checked;
        this.persist();
        this.emit();
      });
    }

    this.applyToInputs();
    onLangChange(() => this.applyToInputs());
  }

  private bindRange(id: string, key: keyof SettingsState): void {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) return;
    el.addEventListener("input", () => {
      (this.state[key] as any) = parseFloat(el.value);
      el.setAttribute("aria-valuetext", formatPercent(parseFloat(el.value)));
      this.persist();
      this.emit();
    });
  }

  private persist(): void {
    localStorage.setItem("blade.settings", JSON.stringify(this.state));
  }

  // Curseurs : position, et valeur en pourcentage pour les lecteurs d'écran
  // (sinon annoncée en fraction, « 0,7 »).
  private applyToInputs(): void {
    const values: Array<[string, number]> = [
      ["vol-master", this.state.master],
      ["vol-music", this.state.music],
      ["vol-sfx", this.state.sfx],
      ["joy-sens", this.state.joystickSens],
      ["shake-intensity", shakeIntensity(this.state)],
      ["flash-intensity", this.state.flashes],
    ];
    for (const [id, v] of values) {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (!el) continue;
      el.value = String(v);
      el.setAttribute("aria-valuetext", formatPercent(v));
    }
  }

  onChange(cb: (s: SettingsState) => void): void {
    this.listeners.push(cb);
    cb(this.state);
  }

  onQuit(cb: () => void): void {
    this.quitListeners.push(cb);
  }

  // Changement qui demande un rechargement : jamais en pleine partie
  // (appliqué au retour au menu, une note le dit) ; au lobby, le joueur
  // choisit entre maintenant et au prochain retour au menu.
  private async applyWithReload(question: I18nKey): Promise<void> {
    const note = document.getElementById("settings-note");
    if (this.inGame) {
      reloadAtMenu();
      if (note) {
        note.textContent = t("settings.applyAtMenu");
        note.classList.remove("hidden");
      }
      return;
    }
    if (await showConfirm(t(question), t("dialog.reload"), t("dialog.later"))) window.location.reload();
    else reloadAtMenu();
  }

  setInGame(inGame: boolean): void {
    this.inGame = inGame;
    if (!inGame) document.getElementById("settings-note")?.classList.add("hidden");
    const quitBtn = document.getElementById("quit-match-btn");
    if (quitBtn) {
      if (inGame) quitBtn.classList.remove("hidden");
      else quitBtn.classList.add("hidden");
    }
  }

  private emit(): void {
    for (const cb of this.listeners) cb(this.state);
  }

  get current(): SettingsState {
    return this.state;
  }
}
