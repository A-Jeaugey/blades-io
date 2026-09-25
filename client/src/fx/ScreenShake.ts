// Secousse de caméra, en bruit continu : somme de sinus de fréquences
// incommensurables, à phases tirées au hasard. Avant, un tirage aléatoire
// par frame faisait vibrer l'image au rythme du framerate (plus nerveux à
// 144 Hz qu'à 30 Hz) au lieu de la secouer.
const FREQS_X = [5.3, 9.7, 14.1];
const FREQS_Y = [6.1, 10.9, 13.3];
// Poids des trois sinus (somme 1 : amplitude maximale 1).
const WEIGHTS = [0.5, 0.3, 0.2];

export class ScreenShake {
  private trauma = 0;
  private time = 0;
  private readonly phases = Array.from({ length: 6 }, () => Math.random() * Math.PI * 2);

  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  // Ajout plafonné : des secousses en rafale (clashs) ne montent pas
  // au-delà de cap, sans rabaisser une secousse plus forte déjà en cours.
  addCapped(amount: number, cap: number): void {
    if (this.trauma >= cap) return;
    this.trauma = Math.min(cap, this.trauma + amount);
  }

  update(dt: number): { x: number; y: number } {
    this.time += dt;
    if (this.trauma <= 0) return { x: 0, y: 0 };
    const shake = this.trauma * this.trauma;
    const t = this.time * Math.PI * 2;
    let nx = 0;
    let ny = 0;
    for (let i = 0; i < 3; i++) {
      nx += Math.sin(t * FREQS_X[i] + this.phases[i]) * WEIGHTS[i];
      ny += Math.sin(t * FREQS_Y[i] + this.phases[i + 3]) * WEIGHTS[i];
    }
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    return { x: nx * shake * 0.8, y: ny * shake * 0.5 };
  }
}
