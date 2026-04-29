// Obstacles solides de la map. Partagés client/serveur : le serveur
// applique la collision autoritairement dans le système de mouvement, le
// client fait la même chose dans sa prédiction locale. Les positions et
// rayons définis ici sont aussi utilisés par le rendu (Decor.ts côté
// client) pour garantir cohérence visuelle/physique.

export interface DecorCollider {
  x: number;
  y: number;
  radius: number;
}

function generateObelisks(count: number, ringRadius: number, phase: number): DecorCollider[] {
  const out: DecorCollider[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + phase;
    const r = ringRadius + Math.sin(i * 1.7) * 6;
    out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, radius: 1.5 });
  }
  return out;
}

// Petits clusters de pilliers (3 par cluster) éparpillés entre les anneaux
// pour casser les longues lignes de vue et créer des cachettes tactiques.
function generateClusters(): DecorCollider[] {
  const seeds: Array<[number, number]> = [
    [60, -30], [-70, 70], [-40, -110], [110, 60], [180, -110], [-180, 50],
  ];
  const out: DecorCollider[] = [];
  for (const [cx, cy] of seeds) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const r = 3.5;
      out.push({
        x: cx + Math.cos(a) * r,
        y: cy + Math.sin(a) * r,
        radius: 1.0,
      });
    }
  }
  return out;
}

// Pilier central + 3 anneaux d'obélisques + clusters intermédiaires.
// Plus dense qu'avant pour casser les lignes de vue et donner de la
// matière tactique. Le 1er anneau (40u) est proche du centre, là où la
// majorité des combats se concentrent.
export const DECOR_COLLIDERS: DecorCollider[] = [
  { x: 0, y: 0, radius: 1.1 },
  ...generateObelisks(8, 40, 0.3),
  ...generateObelisks(10, 80, 0.8),
  ...generateObelisks(10, 160, 1.6),
  ...generateClusters(),
];

// --- Buissons ---
// Zones non-collidables : les joueurs traversent mais y disparaissent
// visuellement (rendu côté client). Static, partagés par toutes les rooms.
// Pas de sync serveur nécessaire (tous les clients ont la même liste).
export interface Bush {
  x: number;
  y: number;
  radius: number;
}

function generateBushes(): Bush[] {
  const seeds: Array<[number, number, number]> = [
    [25, 65, 4.5], [-55, -40, 5.0], [85, -65, 4.0], [-95, 95, 5.5],
    [140, 30, 4.5], [-130, -110, 4.5], [50, 175, 5.0], [-180, 0, 4.5],
    [0, -180, 5.5], [180, 180, 4.0],
  ];
  return seeds.map(([x, y, r]) => ({ x, y, radius: r }));
}

export const BUSHES: Bush[] = generateBushes();

// Détecte si un point est dans un buisson. Utilisé côté client pour cacher
// les joueurs (et leurs lames) qui s'y trouvent. Côté serveur, pourrait
// servir à des règles d'AI plus tard. Pour l'instant : purement visuel.
export function isInBush(x: number, y: number): boolean {
  for (let i = 0; i < BUSHES.length; i++) {
    const b = BUSHES[i];
    const dx = x - b.x;
    const dy = y - b.y;
    if (dx * dx + dy * dy < b.radius * b.radius) return true;
  }
  return false;
}

// Les positions pour le rendu non-collidable (cubes flottants, pads).
// Définies ici pour garder toutes les constantes de map au même endroit.
export interface FloatingCube {
  x: number;
  y: number;
  baseY: number;
  phase: number;
  spin: number;
}

export const FLOATING_CUBES: FloatingCube[] = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2;
  const r = 120 + Math.sin(i * 2.1) * 30;
  return {
    x: Math.cos(a) * r,
    y: Math.sin(a) * r,
    baseY: 3 + (i % 3) * 1.5,
    phase: i * 0.8,
    spin: 0.5 + (i % 3) * 0.3,
  };
});

export const GROUND_PADS: Array<{ x: number; y: number }> = [
  { x: 30, y: 45 },
  { x: -50, y: 20 },
  { x: 60, y: -80 },
  { x: -110, y: -70 },
  { x: 120, y: 110 },
  { x: -140, y: 90 },
  { x: 30, y: -140 },
  { x: -30, y: 130 },
  { x: 200, y: -40 },
  { x: -200, y: -10 },
];

// Push-out de collision (cercle vs cercles). Retourne la nouvelle position.
// playerRadius = rayon du corps du joueur.
export function resolveDecorCollision(
  x: number,
  y: number,
  playerRadius: number,
): { x: number; y: number } {
  for (let i = 0; i < DECOR_COLLIDERS.length; i++) {
    const d = DECOR_COLLIDERS[i];
    const dx = x - d.x;
    const dy = y - d.y;
    const minDist = d.radius + playerRadius;
    const d2 = dx * dx + dy * dy;
    if (d2 >= minDist * minDist) continue;
    const dist = Math.sqrt(d2);
    if (dist < 1e-4) {
      // Au centre exact : pousse arbitrairement vers +y
      x = d.x;
      y = d.y + minDist;
    } else {
      x = d.x + (dx / dist) * minDist;
      y = d.y + (dy / dist) * minDist;
    }
  }
  return { x, y };
}
