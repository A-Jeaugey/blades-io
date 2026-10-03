// Distances entre points et segments du plan, pour les contacts testés sur
// un trajet (projectiles) ou le long d'une lame. Fonctions sur des nombres :
// pas d'objet alloué dans les boucles de collision.

// Position (0 à 1) sur le segment [a, b] du point le plus proche de p.
export function closestOnSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  if (len2 <= 1e-12) return 0;
  const t = ((px - ax) * abx + (py - ay) * aby) / len2;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

// Carré de la distance de p au segment [a, b].
export function pointSegmentDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const t = closestOnSegment(px, py, ax, ay, bx, by);
  const dx = ax + (bx - ax) * t - px;
  const dy = ay + (by - ay) * t - py;
  return dx * dx + dy * dy;
}

function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

// Carré de la distance entre les segments [a0, a1] et [b0, b1] : nulle s'ils
// se coupent, sinon la plus courte des distances d'une extrémité à l'autre
// segment (dans le plan, la plus courte distance entre deux segments qui ne
// se coupent pas part toujours d'une extrémité).
export function segmentSegmentDist2(
  a0x: number, a0y: number, a1x: number, a1y: number,
  b0x: number, b0y: number, b1x: number, b1y: number,
): number {
  const d1 = cross(b0x, b0y, b1x, b1y, a0x, a0y);
  const d2 = cross(b0x, b0y, b1x, b1y, a1x, a1y);
  const d3 = cross(a0x, a0y, a1x, a1y, b0x, b0y);
  const d4 = cross(a0x, a0y, a1x, a1y, b1x, b1y);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(
    pointSegmentDist2(a0x, a0y, b0x, b0y, b1x, b1y),
    pointSegmentDist2(a1x, a1y, b0x, b0y, b1x, b1y),
    pointSegmentDist2(b0x, b0y, a0x, a0y, a1x, a1y),
    pointSegmentDist2(b1x, b1y, a0x, a0y, a1x, a1y),
  );
}
