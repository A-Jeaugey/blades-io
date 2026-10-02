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

export const CENTRAL_PILLAR: DecorCollider = { x: 0, y: 0, radius: 1.1 };

// 3 anneaux d'obélisques + clusters intermédiaires. Le 1er anneau (40u)
// est proche du centre, là où la majorité des combats se concentrent. Les
// INNER_OBELISKS premiers prennent la couleur intérieure du thème.
export const OBELISKS: DecorCollider[] = [
  ...generateObelisks(8, 40, 0.3),
  ...generateObelisks(10, 80, 0.8),
  ...generateObelisks(10, 160, 1.6),
  ...generateClusters(),
];
export const INNER_OBELISKS = 10;

// --- Structures (tâche 4.7) ---
// Repères de la carte, symétriques de part et d'autre de l'axe x = 0
// (équité des deux camps en modes équipe), tous à moins de 145 u du
// centre : dans l'arène d'un humain et de ses bots (171 u, tâche 4.5),
// hors de la bande que les bots évitent au ras du mur. Ni dans la zone
// dorée du centre, ni à moins de 25 u d'une base de drapeau, et toujours
// un passage d'au moins 2 u entre deux obstacles (server/test/decor.test.ts).
//   billboard : pylône (collider) et panneau holographique translucide en
//               hauteur ; angle = direction vers laquelle le panneau fait face.
//   arch      : deux piliers (colliders) et un linteau ; angle = axe du
//               passage, qui se franchit.
//   rack      : bloc (deux colliders le long de sa largeur) ; angle = axe
//               de sa largeur.
//   dronePad  : disque au sol et drone en vol, sans collider.
//   shard     : cristal en lévitation, sans collider.
export type StructureKind = "billboard" | "arch" | "rack" | "dronePad" | "shard";

export interface MapStructure {
  kind: StructureKind;
  x: number;
  y: number;
  angle: number;
}

export const BILLBOARD_RADIUS = 0.9;
export const ARCH_HALF_SPAN = 2.6;
export const ARCH_PILLAR_RADIUS = 0.7;
export const RACK_HALF_WIDTH = 0.6;
export const RACK_RADIUS = 0.75;

// La structure et son reflet (x → -x ; un angle a devient π - a).
function mirrored(kind: StructureKind, x: number, y: number, angle: number): MapStructure[] {
  return [
    { kind, x, y, angle },
    { kind, x: -x, y, angle: Math.PI - angle },
  ];
}

// Trois arches à la suite, passage dans l'axe de la caméra (y) : vues de
// face, en arc, et non de profil comme des dalles.
function archRow(x: number, y: number): MapStructure[] {
  return [-1, 0, 1].map((k) => ({ kind: "arch" as const, x, y: y + k * 4.5, angle: Math.PI / 2 }));
}

export const STRUCTURES: MapStructure[] = [
  // Panneaux holographiques : face à la caméra (vers +y), pour se lire.
  { kind: "billboard", x: 0, y: -88, angle: Math.PI / 2 },
  ...mirrored("billboard", 132, 10, Math.PI / 2),
  ...archRow(85, 30),
  ...archRow(-85, 30),
  // Racks par deux, un passage entre eux.
  ...mirrored("rack", 42.5, -100, 0),
  ...mirrored("rack", 47.5, -100, 0),
  { kind: "rack", x: -2.5, y: 62, angle: 0 },
  { kind: "rack", x: 2.5, y: 62, angle: 0 },
  ...mirrored("dronePad", 115, 48, 0),
  ...mirrored("dronePad", 48, 128, 0),
  ...mirrored("shard", 25, -50, 0),
  ...mirrored("shard", 135, -25, 0),
  ...mirrored("shard", 70, 105, 0),
];

// Colliders d'une structure (aucun pour les pads et les cristaux).
export function structureColliders(st: MapStructure): DecorCollider[] {
  const c = Math.cos(st.angle);
  const s = Math.sin(st.angle);
  switch (st.kind) {
    case "billboard":
      return [{ x: st.x, y: st.y, radius: BILLBOARD_RADIUS }];
    case "arch":
      // Piliers de part et d'autre de l'axe du passage.
      return [
        { x: st.x - s * ARCH_HALF_SPAN, y: st.y + c * ARCH_HALF_SPAN, radius: ARCH_PILLAR_RADIUS },
        { x: st.x + s * ARCH_HALF_SPAN, y: st.y - c * ARCH_HALF_SPAN, radius: ARCH_PILLAR_RADIUS },
      ];
    case "rack":
      return [
        { x: st.x - c * RACK_HALF_WIDTH, y: st.y - s * RACK_HALF_WIDTH, radius: RACK_RADIUS },
        { x: st.x + c * RACK_HALF_WIDTH, y: st.y + s * RACK_HALF_WIDTH, radius: RACK_RADIUS },
      ];
    default:
      return [];
  }
}

// Pilier central, obélisques, puis structures : tout ce qui arrête un
// corps (resolveDecorCollision, même calcul côté serveur et prédiction).
export const DECOR_COLLIDERS: DecorCollider[] = [
  CENTRAL_PILLAR,
  ...OBELISKS,
  ...STRUCTURES.flatMap(structureColliders),
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

// Symétriques de part et d'autre de x = 0 et à moins de 145 u du centre
// (tâche 4.7) : à 171 u de rayon, l'arène d'un humain et de ses bots,
// quatre des dix buissons d'avant étaient hors de l'arène.
function generateBushes(): Bush[] {
  const seeds: Array<[number, number, number]> = [
    [28, 62, 4.5], [-28, 62, 4.5],
    [62, -44, 5.0], [-62, -44, 5.0],
    [104, 96, 5.5], [-104, 96, 5.5],
    [122, -78, 4.5], [-122, -78, 4.5],
    [0, -132, 5.5], [0, 108, 5.0],
  ];
  return seeds.map(([x, y, r]) => ({ x, y, radius: r }));
}

export const BUSHES: Bush[] = generateBushes();

// Indice du buisson qui contient ce point, -1 sinon.
export function bushAt(x: number, y: number): number {
  for (let i = 0; i < BUSHES.length; i++) {
    const b = BUSHES[i];
    const dx = x - b.x;
    const dy = y - b.y;
    if (dx * dx + dy * dy < b.radius * b.radius) return i;
  }
  return -1;
}

// Détecte si un point est dans un buisson.
export function isInBush(x: number, y: number): boolean {
  return bushAt(x, y) >= 0;
}

// Marge au-delà du contact des orbites en deçà de laquelle un joueur caché
// est vu quand même : on ne se bat pas contre des lames invisibles.
export const BUSH_REVEAL_MARGIN = 3;

// Un joueur dans un buisson est caché à un observateur (joueur ou bot)
// tant que leurs orbites ne peuvent pas se toucher (portées = rayon de
// l'orbite extérieure + hitbox d'une lame). Appliqué par le serveur (tâche
// 2.4) : ni les clients ni les bots ne reçoivent ou n'utilisent la
// position d'un joueur caché.
export function isHiddenFrom(
  observerX: number,
  observerY: number,
  observerReach: number,
  targetX: number,
  targetY: number,
  targetReach: number,
): boolean {
  if (!isInBush(targetX, targetY)) return false;
  const reveal = observerReach + targetReach + BUSH_REVEAL_MARGIN;
  const dx = targetX - observerX;
  const dy = targetY - observerY;
  return dx * dx + dy * dy > reveal * reveal;
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
