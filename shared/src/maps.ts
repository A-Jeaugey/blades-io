import { CENTRAL_PILLAR } from "./decor";

// Cartes à murs (mode « district », 2026-11-19). L'arène d'origine est un
// disque semé d'obstacles ronds (decor.ts) ; une carte, elle, est faite de
// bâtiments et de mobilier rectangulaires, alignés sur les axes. Ce fichier
// est le contrat d'une carte : ce qui bloque (boxes, circles), lu par le pas
// de mouvement partagé (stepMovement), et ce qui se dessine (buildings,
// props, dressing), lu par le client. Une carte ne dépend d'aucun thème.
//
// Un mode sans carte (GameModeInfo.map absent) garde l'arène et tout son
// code d'origine, inchangé.

export type MapId = "district";

// Obstacle rectangulaire : centre, demi-côtés, hauteur (u). La hauteur ne
// compte que pour ce qui passe au-dessus : la caméra, pas les corps ni les
// lancers (une lame vole à hauteur de taille).
export interface MapBox {
  x: number;
  y: number;
  hw: number;
  hh: number;
  h: number;
}

export interface MapCircle {
  x: number;
  y: number;
  radius: number;
}

// Hauteur d'un étage et largeur d'un panneau de façade : les côtés d'un
// bâtiment sont des multiples de FACADE_MODULE, pour que les panneaux du kit
// tombent juste.
export const FLOOR_HEIGHT = 4;
export const FACADE_MODULE = 4;

export type BuildingStyle = 0 | 1 | 2; // habitation, bureaux, industriel

export interface MapBuilding {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  floors: number;
  style: BuildingStyle;
  // Bâtiment d'enceinte : il ferme la carte, ses faces extérieures ne se
  // voient jamais.
  edge: boolean;
}

// Mobilier urbain. Avec collider : il bloque les corps et les lancers.
export type PropKind =
  | "container"
  | "car"
  | "barrier"
  | "dumpster"
  | "vending"
  | "bench"
  | "planter"
  | "pallets"
  | "terminal"
  | "lamp"
  | "bollard"
  | "pillar";

// Habillage sans collider : on passe dessous ou à travers.
export type DressingKind = "hangSign" | "skyBridge" | "containerTop" | "trash" | "cone";

interface BoxShape { hw: number; hh: number; h: number }
interface RoundShape { radius: number; h: number }

// Encombrement de chaque meuble, quart de tour 0 (grand côté le long de x).
// Les pièces du kit sont modelées à ces dimensions (art/kit/build_kit.py).
export const PROP_SHAPES: Record<PropKind, BoxShape | RoundShape> = {
  container: { hw: 3.0, hh: 1.2, h: 2.6 },
  car: { hw: 2.3, hh: 1.0, h: 1.4 },
  barrier: { hw: 1.5, hh: 0.35, h: 1.0 },
  dumpster: { hw: 1.1, hh: 0.7, h: 1.4 },
  vending: { hw: 0.6, hh: 0.45, h: 2.1 },
  bench: { hw: 1.1, hh: 0.35, h: 0.9 },
  planter: { hw: 1.2, hh: 1.2, h: 0.8 },
  pallets: { hw: 0.7, hh: 0.7, h: 1.2 },
  terminal: { hw: 0.5, hh: 0.5, h: 1.8 },
  lamp: { radius: 0.3, h: 9.1 },
  bollard: { radius: 0.3, h: 1.0 },
  pillar: { radius: CENTRAL_PILLAR.radius, h: 9 },
};

export interface MapProp {
  kind: PropKind;
  x: number;
  y: number;
  // Quarts de tour autour de la verticale (0 à 3). La face d'un meuble
  // (écran d'un distributeur, assise d'un banc) regarde +y à 0, +x à 1,
  // -y à 2, -x à 3 ; son grand côté est le long de x à 0 et à 2.
  rot: number;
}

export interface MapDressing {
  kind: DressingKind;
  x: number;
  y: number;
  rot: number;
}

export interface GameMap {
  id: MapId;
  // Rayon du mur tueur, au-delà de l'enceinte : personne ne l'atteint.
  radius: number;
  // Demi-côté de la zone jouable (intérieur de l'enceinte).
  half: number;
  boxes: readonly MapBox[];
  circles: readonly MapCircle[];
  buildings: readonly MapBuilding[];
  props: readonly MapProp[];
  dressing: readonly MapDressing[];
  // Surface qu'on peut parcourir (u²) : la zone jouable moins ses
  // obstacles. Les plafonds du butin en suivent (areaShare, serveur).
  walkArea: number;
}

// --- Le quartier ---
// Un quartier fermé de 208 u de côté : deux avenues en croix (16 u) qui se
// coupent sur une place, une rue en anneau (12 u), une rue de ceinture le
// long de l'enceinte, et entre elles des îlots découpés en immeubles, ruelles
// (8 u, 4 u pour les passages) et cours. Symétrique de part et d'autre de
// x = 0 ; le nord (y > 0) et le sud diffèrent : cour en U et dépôt de
// conteneurs au nord, marché et parking au sud.
//
// Tout se décrit sur la moitié x ≥ 0, puis se reflète. Bâtiments :
// [x0, x1, y0, y1, étages, style], côtés multiples de FACADE_MODULE.
type B = [number, number, number, number, number, BuildingStyle];

const HALF_BUILDINGS: B[] = [
  // Îlot intérieur nord (bord de place)
  [28, 48, 8, 20, 6, 1],
  [32, 48, 28, 48, 4, 0],
  [8, 24, 32, 48, 5, 0],
  // Îlot est, côté nord : entrepôt, tour, immeuble en U autour d'une cour
  [60, 72, 8, 24, 3, 2],
  [80, 92, 8, 28, 8, 1],
  [60, 92, 40, 48, 5, 0],
  [60, 68, 32, 40, 5, 0],
  [84, 92, 32, 40, 5, 0],
  // Îlot nord
  [8, 28, 60, 76, 7, 1],
  [36, 48, 60, 80, 4, 0],
  [8, 32, 84, 92, 2, 2],
  [36, 48, 84, 92, 3, 2],
  // Dépôt de conteneurs (nord-est) : un seul hangar
  [80, 92, 80, 92, 3, 2],
  // Îlot intérieur sud
  [28, 48, -24, -8, 5, 0],
  [8, 28, -48, -32, 6, 1],
  [36, 48, -48, -32, 3, 2],
  // Marché (est, côté sud)
  [60, 92, -20, -8, 5, 1],
  [60, 72, -48, -28, 4, 0],
  [80, 92, -48, -28, 6, 0],
  // Parking (sud) : station de recharge et atelier
  [8, 24, -76, -60, 2, 2],
  [32, 48, -92, -80, 3, 2],
  // Îlot sud-est
  [60, 76, -76, -60, 7, 0],
  [80, 92, -72, -60, 4, 1],
  [60, 92, -92, -84, 3, 2],
];

const HALF_EDGE: B[] = [
  // Enceinte nord
  [0, 20, 104, 116, 9, 1],
  [20, 44, 104, 116, 6, 0],
  [44, 72, 104, 116, 8, 1],
  [72, 96, 104, 116, 5, 0],
  [96, 116, 104, 116, 7, 1],
  // Enceinte est
  [104, 116, -104, -76, 6, 0],
  [104, 116, -76, -48, 9, 1],
  [104, 116, -48, -20, 5, 2],
  [104, 116, -20, 8, 7, 0],
  [104, 116, 8, 36, 6, 1],
  [104, 116, 36, 64, 9, 0],
  [104, 116, 64, 88, 5, 2],
  [104, 116, 88, 104, 8, 1],
  // Enceinte sud
  [0, 24, -116, -104, 6, 0],
  [24, 52, -116, -104, 8, 1],
  [52, 80, -116, -104, 5, 2],
  [80, 96, -116, -104, 7, 0],
  [96, 116, -116, -104, 6, 1],
];

// Mobilier : [genre, x, y, quarts de tour]. x = 0 : pièce d'axe, non
// reflétée.
type P = [PropKind, number, number, number?];

const HALF_PROPS: P[] = [
  // Place centrale
  ["pillar", 0, 0],
  ["planter", 12, 12], ["planter", 12, -12],
  ["bench", 12, 5, 3], ["bench", 12, -5, 3], ["bench", 5, 12, 2], ["bench", 5, -12],
  ["terminal", 19, 19], ["terminal", 19, -19],
  ["lamp", 22, 22], ["lamp", 22, -22],
  ["vending", 27.5, 11.2, 3], ["vending", 27.5, 12.6, 3],
  ["vending", 27.5, -14, 3],
  // Avenue nord-sud
  ["lamp", 7, 40], ["lamp", 7, 68], ["lamp", 7, 96],
  ["lamp", 7, -40], ["lamp", 7, -68], ["lamp", 7, -96],
  ["car", 5.4, 38, 1], ["car", 5.4, 82, 1], ["car", 5.4, -36, 1], ["car", 5.4, -86, 1],
  ["barrier", 3, 28], ["barrier", 3, -28],
  ["planter", 0, 44], ["planter", 0, -44],
  ["container", 0, -70, 1], ["pallets", 2.4, -64.5],
  ["barrier", 4, 90, 1],
  // Avenue est-ouest
  ["lamp", 40, 7], ["lamp", 68, 7], ["lamp", 98, 7],
  ["lamp", 40, -7], ["lamp", 68, -7], ["lamp", 98, -7],
  ["car", 36, 5.4], ["car", 76, 5.4], ["car", 66, -5.4], ["car", 86, -5.4],
  ["barrier", 50, 2.5, 1], ["barrier", 58, -2.5, 1],
  ["planter", 44, 0],
  // Rue de l'anneau, branche nord-sud (x 48 à 60)
  ["lamp", 49, 24], ["lamp", 59, 36], ["lamp", 49, 70], ["lamp", 59, 84],
  ["lamp", 49, -26], ["lamp", 59, -40], ["lamp", 49, -70], ["lamp", 59, -88],
  ["car", 50.4, 34, 1], ["car", 57.6, 66, 1], ["car", 57.6, 18, 1],
  ["car", 50.4, -40, 1], ["car", 57.6, -22, 1], ["car", 57.6, -80, 1],
  ["dumpster", 48.8, 44, 1],
  ["container", 54, 76, 1], ["pallets", 51.6, 80.5],
  ["barrier", 54, -52],
  ["dumpster", 59.2, -66, 1],
  // Rue de l'anneau, branches est-ouest (y 48 à 60 et -60 à -48)
  ["lamp", 20, 49], ["lamp", 34, 59], ["lamp", 72, 49], ["lamp", 86, 59],
  ["lamp", 20, -49], ["lamp", 34, -59], ["lamp", 72, -49], ["lamp", 86, -59],
  ["car", 22, 57.6], ["car", 40, 50.4], ["car", 70, 57.6],
  ["car", 16, -50.4], ["car", 44, -57.6], ["car", 84, -50.4],
  ["container", 82, 54], ["pallets", 77.6, 52.4],
  ["dumpster", 66, -48.8],
  ["barrier", 28, 54, 1], ["barrier", 28, -54, 1],
  // Rue de ceinture est (x 92 à 104)
  ["lamp", 93, 20], ["lamp", 103, 52], ["lamp", 103, 80],
  ["lamp", 93, -30], ["lamp", 103, -66], ["lamp", 93, -98],
  ["car", 102.4, 30, 1], ["car", 93.6, 66, 1], ["car", 102.4, -40, 1], ["car", 93.6, -80, 1],
  ["container", 98, 0, 1], ["container", 98, -56, 1],
  ["barrier", 98, 44], ["barrier", 98, -20],
  ["pallets", 102.8, 96], ["dumpster", 103.2, 12, 1],
  // Rue de ceinture nord et sud
  ["lamp", 16, 93], ["lamp", 44, 103], ["lamp", 72, 93],
  ["lamp", 16, -93], ["lamp", 44, -103], ["lamp", 72, -93],
  ["car", 24, 102.4], ["car", 60, 93.6], ["car", 86, 102.4],
  ["car", 20, -102.4], ["car", 66, -102.4],
  ["container", 40, 98], ["barrier", 10, 98, 1],
  ["container", 52, -98], ["dumpster", 34, -92.8], ["barrier", 84, -98, 1],
  // Dépôt de conteneurs (x 60 à 92, y 60 à 92)
  ["container", 64, 64], ["container", 70.2, 64],
  ["container", 86, 67, 1],
  ["container", 66, 72], ["container", 76, 72],
  ["container", 62, 82, 1],
  ["container", 70, 82], ["container", 70, 84.6],
  ["container", 74, 90],
  ["pallets", 79, 66], ["pallets", 84, 75], ["pallets", 85.5, 75],
  ["dumpster", 79.2, 86, 1],
  ["lamp", 77, 78], ["lamp", 91, 61],
  // Cour de l'immeuble en U et ruelles de l'îlot est
  ["dumpster", 70, 39.2], ["vending", 82, 39.5, 2], ["bench", 76, 33], ["planter", 76, 37],
  ["dumpster", 66, 24.8], ["pallets", 74, 30.5], ["terminal", 79, 25],
  // Ruelles de l'îlot intérieur nord
  ["dumpster", 36, 20.8], ["pallets", 44, 26.6], ["vending", 35, 27.5, 2],
  ["dumpster", 31.2, 40, 1], ["pallets", 24.8, 44], ["bench", 16, 31.5, 2],
  // Ruelles de l'îlot nord
  ["dumpster", 28.8, 66, 1], ["pallets", 35.2, 74], ["vending", 35.5, 62.6, 3],
  ["dumpster", 14, 76.8], ["pallets", 22, 82.6], ["pallets", 23.6, 82.6], ["terminal", 30, 80],
  // Ruelles de l'îlot intérieur sud
  ["dumpster", 16, -31.2], ["pallets", 40, -25], ["vending", 31, -24.5, 2], ["bench", 22, -31.5],
  ["dumpster", 28.8, -40, 1], ["pallets", 35.2, -44.5],
  // Marché : cour et ruelle
  ["vending", 72.5, -34, 1], ["vending", 72.5, -35.4, 1], ["terminal", 79, -40],
  ["bench", 76, -44.5], ["planter", 76, -31],
  ["dumpster", 64, -20.8], ["pallets", 88, -27], ["pallets", 86.5, -27],
  // Parking
  ["car", 30, -66, 1], ["car", 34, -66, 1], ["car", 42, -66, 1], ["car", 46, -66, 1],
  ["car", 30, -75, 1], ["car", 38, -75, 1], ["car", 46, -75, 1],
  ["car", 12, -84], ["car", 20, -88.5],
  ["lamp", 25.5, -70.5], ["lamp", 26, -86],
  ["barrier", 13, -79.5], ["barrier", 17, -79.5],
  ["terminal", 25, -62], ["terminal", 25, -74],
  // Cours de l'îlot sud-est
  ["container", 68, -80], ["pallets", 82, -78], ["dumpster", 86, -72.8], ["bench", 74, -83.5],
];

type D = [DressingKind, number, number, number?];

const HALF_DRESSING: D[] = [
  // Enseignes suspendues en travers des rues (rot 0 : en travers d'une rue
  // nord-sud) et passerelles entre deux immeubles.
  // Chaque bout tient à un immeuble : pas de câble dans le vide.
  ["hangSign", 0, 36], ["hangSign", 0, -36], ["hangSign", 0, 88], ["hangSign", 0, -64],
  ["hangSign", 30, 0, 1], ["hangSign", 84, 0, 1],
  ["hangSign", 54, 36], ["hangSign", 54, -38],
  ["hangSign", 20, 54, 1], ["hangSign", 20, -54, 1], ["hangSign", 66, -54, 1], ["hangSign", 86, -54, 1],
  ["skyBridge", 0, 68], ["skyBridge", 0, -40],
  ["skyBridge", 54, 44], ["skyBridge", 54, -44],
  ["skyBridge", 76, -38],
  // Conteneurs empilés du dépôt
  ["containerTop", 64, 64], ["containerTop", 70, 83.3], ["containerTop", 86, 67, 1], ["containerTop", 76, 72],
  ["containerTop", 98, -56, 1],
  // Détritus et cônes
  ["trash", 37.6, 21.2], ["trash", 30.6, 37], ["trash", 67.6, 25.2], ["trash", 15.6, 77.2], ["trash", 29.4, 63],
  ["trash", 17.6, -30.6], ["trash", 29.4, -37], ["trash", 65.6, -21.2], ["trash", 87.6, -73.2], ["trash", 71.6, 39],
  ["trash", 81, 87.6], ["trash", 35.6, -93.2],
  ["cone", 6.2, 30], ["cone", 6.2, -30], ["cone", 52, 6], ["cone", 56, -6], ["cone", 96, 46], ["cone", 96, -22],
  ["cone", 30, 56.5], ["cone", 12, -78], ["cone", 19, -78], ["cone", 61, 78], ["cone", 2.2, -75],
];

const BOLLARD_RING = 7;
const BOLLARDS = 8;

function mirrorRot(rot: number): number {
  // Reflet par x → -x : la face d'un meuble regarde +y (0), +x (1), -y (2)
  // ou -x (3) ; seuls l'est et l'ouest s'échangent.
  return rot % 2 === 1 ? (rot + 2) % 4 : rot;
}

function isRound(s: BoxShape | RoundShape): s is RoundShape {
  return (s as RoundShape).radius !== undefined;
}

function buildDistrict(): GameMap {
  const buildings: MapBuilding[] = [];
  const add = (b: B, edge: boolean) => {
    const [x0, x1, y0, y1, floors, style] = b;
    buildings.push({ x0, x1, y0, y1, floors, style, edge });
    buildings.push({ x0: -x1, x1: -x0, y0, y1, floors, style, edge });
  };
  for (const b of HALF_BUILDINGS) add(b, false);
  for (const b of HALF_EDGE) add(b, true);

  const props: MapProp[] = [];
  for (const [kind, x, y, rot = 0] of HALF_PROPS) {
    props.push({ kind, x, y, rot });
    if (x !== 0) props.push({ kind, x: -x, y, rot: mirrorRot(rot) });
  }
  // Bornes lumineuses autour du monument de la place.
  for (let i = 0; i < BOLLARDS; i++) {
    const a = ((i + 0.5) / BOLLARDS) * Math.PI * 2;
    props.push({ kind: "bollard", x: Math.cos(a) * BOLLARD_RING, y: Math.sin(a) * BOLLARD_RING, rot: 0 });
  }

  const dressing: MapDressing[] = [];
  for (const [kind, x, y, rot = 0] of HALF_DRESSING) {
    dressing.push({ kind, x, y, rot });
    if (x !== 0) dressing.push({ kind, x: -x, y, rot: mirrorRot(rot) });
  }

  const boxes: MapBox[] = [];
  const circles: MapCircle[] = [];
  for (const b of buildings) {
    boxes.push({
      x: (b.x0 + b.x1) / 2,
      y: (b.y0 + b.y1) / 2,
      hw: (b.x1 - b.x0) / 2,
      hh: (b.y1 - b.y0) / 2,
      h: b.floors * FLOOR_HEIGHT,
    });
  }
  for (const p of props) {
    const s = PROP_SHAPES[p.kind];
    if (isRound(s)) circles.push({ x: p.x, y: p.y, radius: s.radius });
    else if (p.rot % 2 === 1) boxes.push({ x: p.x, y: p.y, hw: s.hh, hh: s.hw, h: s.h });
    else boxes.push({ x: p.x, y: p.y, hw: s.hw, hh: s.hh, h: s.h });
  }
  const half = 104;
  let walkArea = half * half * 4;
  for (const b of boxes) {
    if (Math.abs(b.x) < half && Math.abs(b.y) < half) walkArea -= b.hw * b.hh * 4;
  }
  // Rayon du mur tueur : il passe juste derrière les coins de la zone
  // jouable (147 u), dans les immeubles d'enceinte.
  return { id: "district", radius: 150, half, boxes, circles, buildings, props, dressing, walkArea };
}

export const DISTRICT_MAP: GameMap = buildDistrict();

export const GAME_MAPS: Record<MapId, GameMap> = { district: DISTRICT_MAP };

// Hauteur à partir de laquelle un obstacle cache la vue (caméra à la
// troisième personne) : les immeubles, pas le mobilier.
export const VIEW_BLOCK_HEIGHT = 6;

const out = { x: 0, y: 0 };

// Corps de rayon r repoussé hors des obstacles de la carte. Même rôle que
// resolveDecorCollision pour l'arène : le serveur et la prédiction du client
// l'appellent aux mêmes endroits de stepMovement, dans le même ordre.
// L'objet rendu est réutilisé d'un appel à l'autre : le lire tout de suite.
export function resolveMapCollision(map: GameMap, x: number, y: number, r: number): { x: number; y: number } {
  const boxes = map.boxes;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const dx = x - b.x;
    const dy = y - b.y;
    const ox = b.hw + r - Math.abs(dx);
    if (ox <= 0) continue;
    const oy = b.hh + r - Math.abs(dy);
    if (oy <= 0) continue;
    const inX = Math.abs(dx) <= b.hw;
    const inY = Math.abs(dy) <= b.hh;
    if (inX || inY) {
      // Face au mur (ou dedans) : sortie par le chemin le plus court. Le
      // long d'un mur, on glisse.
      if (inX && inY ? ox < oy : inY) x = b.x + (dx >= 0 ? b.hw + r : -(b.hw + r));
      else y = b.y + (dy >= 0 ? b.hh + r : -(b.hh + r));
      continue;
    }
    // Face à un coin : repoussé le long de la droite coin → corps.
    const cx = b.x + (dx > 0 ? b.hw : -b.hw);
    const cy = b.y + (dy > 0 ? b.hh : -b.hh);
    const ex = x - cx;
    const ey = y - cy;
    const d2 = ex * ex + ey * ey;
    if (d2 >= r * r || d2 < 1e-8) continue;
    const k = r / Math.sqrt(d2);
    x = cx + ex * k;
    y = cy + ey * k;
  }
  const circles = map.circles;
  for (let i = 0; i < circles.length; i++) {
    const c = circles[i];
    const dx = x - c.x;
    const dy = y - c.y;
    const min = c.radius + r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) continue;
    const dist = Math.sqrt(d2);
    if (dist < 1e-4) {
      y = c.y + min;
    } else {
      x = c.x + (dx / dist) * min;
      y = c.y + (dy / dist) * min;
    }
  }
  out.x = x;
  out.y = y;
  return out;
}

// Ce point est-il pris par un obstacle (à `margin` près) ou hors de la zone
// jouable ? Pour tout ce qui apparaît : joueurs, butin, caisses, power-ups.
export function mapBlocked(map: GameMap, x: number, y: number, margin: number): boolean {
  const lim = map.half - margin;
  if (Math.abs(x) > lim || Math.abs(y) > lim) return true;
  const boxes = map.boxes;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (Math.abs(x - b.x) < b.hw + margin && Math.abs(y - b.y) < b.hh + margin) return true;
  }
  const circles = map.circles;
  for (let i = 0; i < circles.length; i++) {
    const c = circles[i];
    const dx = x - c.x;
    const dy = y - c.y;
    const min = c.radius + margin;
    if (dx * dx + dy * dy < min * min) return true;
  }
  return false;
}

// Part du segment (x0, y0) → (x1, y1) parcourue avant le premier obstacle
// rectangulaire d'au moins `minHeight` de haut, grossi de `pad` : 1 si la
// voie est libre. Lancers arrêtés par un mur (minHeight 0), caméra tirée
// devant un immeuble (VIEW_BLOCK_HEIGHT), ligne de vue des bots.
export function mapSegmentHit(
  map: GameMap,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  minHeight: number,
  pad: number,
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let best = 1;
  const boxes = map.boxes;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.h < minHeight) continue;
    const hw = b.hw + pad;
    const hh = b.hh + pad;
    // Tranches (slabs) : intervalle de t où le segment est dans la boîte.
    let t0 = 0;
    let t1 = best;
    if (Math.abs(dx) < 1e-9) {
      if (Math.abs(x0 - b.x) >= hw) continue;
    } else {
      let a = (b.x - hw - x0) / dx;
      let c = (b.x + hw - x0) / dx;
      if (a > c) { const s = a; a = c; c = s; }
      if (a > t0) t0 = a;
      if (c < t1) t1 = c;
      if (t0 > t1) continue;
    }
    if (Math.abs(dy) < 1e-9) {
      if (Math.abs(y0 - b.y) >= hh) continue;
    } else {
      let a = (b.y - hh - y0) / dy;
      let c = (b.y + hh - y0) / dy;
      if (a > c) { const s = a; a = c; c = s; }
      if (a > t0) t0 = a;
      if (c < t1) t1 = c;
      if (t0 > t1) continue;
    }
    if (t0 < best) best = t0;
  }
  return best;
}
