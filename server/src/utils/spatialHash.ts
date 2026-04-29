// Grille de hachage spatiale basique pour accélérer les requêtes de proximité.

export interface HashItem {
  id: string;
  x: number;
  y: number;
}

export class SpatialHash<T extends HashItem> {
  private cells = new Map<string, T[]>();
  constructor(private cellSize: number) {}

  private key(cx: number, cy: number): string {
    return `${cx}|${cy}`;
  }

  clear(): void {
    this.cells.clear();
  }

  insert(item: T): void {
    const cx = Math.floor(item.x / this.cellSize);
    const cy = Math.floor(item.y / this.cellSize);
    const k = this.key(cx, cy);
    let arr = this.cells.get(k);
    if (!arr) {
      arr = [];
      this.cells.set(k, arr);
    }
    arr.push(item);
  }

  // Retourne tous les items dans les cellules touchées par le cercle (x,y,r).
  query(x: number, y: number, r: number): T[] {
    const minCx = Math.floor((x - r) / this.cellSize);
    const maxCx = Math.floor((x + r) / this.cellSize);
    const minCy = Math.floor((y - r) / this.cellSize);
    const maxCy = Math.floor((y + r) / this.cellSize);
    const out: T[] = [];
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const arr = this.cells.get(this.key(cx, cy));
        if (arr) out.push(...arr);
      }
    }
    return out;
  }
}
