import { QualityPreset, detectPreset, savePresetChoice } from "../quality";
import { getActiveTheme, listThemes, setActiveTheme } from "../themes";

export interface SettingsState {
  master: number;
  music: number;
  sfx: number;
  qualityChoice: "auto" | QualityPreset;
  joystickSens: number;
}

export class SettingsPanel {
  private panel: HTMLElement;
  private icon: HTMLElement;
  private state: SettingsState = {
    master: 0.7,
    music: 0.5,
    sfx: 0.8,
    qualityChoice: "auto",
    joystickSens: 1,
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
        this.state = { ...this.state, ...JSON.parse(saved) };
      } catch {}
    }
    this.bindRange("vol-master", "master");
    this.bindRange("vol-music", "music");
    this.bindRange("vol-sfx", "sfx");
    this.bindRange("joy-sens", "joystickSens");
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
        // Un reload est nécessaire parce que les matériaux/shaders sont
        // construits au boot selon le preset.
        if (confirm("Le changement de qualité nécessite un reload. Recharger maintenant ?")) {
          window.location.reload();
        }
      });
    }

    // Sélecteur de thème — populated depuis themes/index.ts. Un reload est
    // nécessaire car les shaders, matériaux, lumières et CSS sont construits
    // au boot selon le thème actif (cf. getActiveTheme appelé à l'init de
    // chaque module de rendu).
    const themeSel = document.getElementById("theme-select") as HTMLSelectElement | null;
    if (themeSel) {
      themeSel.innerHTML = "";
      const activeId = getActiveTheme().id;
      for (const t of listThemes()) {
        const opt = document.createElement("option");
        opt.value = t.id;
        opt.textContent = t.displayName;
        if (t.id === activeId) opt.selected = true;
        themeSel.appendChild(opt);
      }
      themeSel.addEventListener("change", () => {
        const newId = themeSel.value;
        if (newId === activeId) return;
        setActiveTheme(newId);
        if (confirm("Le changement de thème nécessite un reload. Recharger maintenant ?")) {
          window.location.reload();
        }
      });
    }

    this.applyToInputs();
  }

  private bindRange(id: string, key: keyof SettingsState): void {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) return;
    el.addEventListener("input", () => {
      (this.state[key] as any) = parseFloat(el.value);
      this.persist();
      this.emit();
    });
  }

  private persist(): void {
    localStorage.setItem("blade.settings", JSON.stringify(this.state));
  }

  private applyToInputs(): void {
    (document.getElementById("vol-master") as HTMLInputElement).value = String(this.state.master);
    (document.getElementById("vol-music") as HTMLInputElement).value = String(this.state.music);
    (document.getElementById("vol-sfx") as HTMLInputElement).value = String(this.state.sfx);
    (document.getElementById("joy-sens") as HTMLInputElement).value = String(this.state.joystickSens);
  }

  onChange(cb: (s: SettingsState) => void): void {
    this.listeners.push(cb);
    cb(this.state);
  }

  onQuit(cb: () => void): void {
    this.quitListeners.push(cb);
  }

  setInGame(inGame: boolean): void {
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
