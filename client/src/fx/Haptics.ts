// Retour haptique sur téléphone (tâche 3.6) : vibrations courtes aux moments
// qui comptent pour le joueur local. L'API n'existe pas partout (iOS Safari
// ne l'expose pas) : sans elle, rien ne se passe. Seulement en mode tactile,
// et désactivable dans les réglages.
export type HapticKind =
  | "clash" // une de mes lames heurte une lame adverse
  | "hitTaken" // je perds une lame (coup reçu, bordure)
  | "kill" // j'élimine quelqu'un
  | "death"; // je meurs

const PATTERNS: Record<HapticKind, number | number[]> = {
  clash: 10,
  hitTaken: 30,
  kill: [35, 45, 35],
  death: 160,
};

// Importance : dans une même fenêtre, une vibration ne passe que si elle
// compte plus que la précédente. En plein combat, les chocs s'enchaînent à
// plusieurs par seconde et le téléphone vibrerait en continu ; une lame
// perdue juste après un choc doit pourtant se sentir.
const LEVEL: Record<HapticKind, number> = { clash: 0, hitTaken: 1, kill: 2, death: 3 };
const MIN_GAP_MS = 90;

export class Haptics {
  enabled = true;
  private lastAt = -Infinity;
  private lastLevel = -1;
  private readonly supported = Haptics.available;

  constructor(private readonly isTouch: () => boolean) {}

  static get available(): boolean {
    return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
  }

  play(kind: HapticKind): void {
    if (!this.enabled || !this.supported || !this.isTouch()) return;
    const now = performance.now();
    if (now - this.lastAt < MIN_GAP_MS && LEVEL[kind] <= this.lastLevel) return;
    this.lastAt = now;
    this.lastLevel = LEVEL[kind];
    try {
      navigator.vibrate(PATTERNS[kind]);
    } catch {
      // Refusé (cadre sans activation utilisateur, politique du navigateur).
    }
  }
}
