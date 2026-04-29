export class ScreenShake {
  private trauma = 0;

  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt: number): { x: number; y: number } {
    if (this.trauma <= 0) return { x: 0, y: 0 };
    const shake = this.trauma * this.trauma;
    const x = (Math.random() * 2 - 1) * shake * 0.8;
    const y = (Math.random() * 2 - 1) * shake * 0.5;
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    return { x, y };
  }
}
