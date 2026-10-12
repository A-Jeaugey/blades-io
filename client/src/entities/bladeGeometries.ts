import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Une forme de lame par palier (tâche 4.1) : dague, épée, faux, scie, lame
// runique, lame à aura. Avant, les trois paliers partageaient l'épée et ne
// se distinguaient que par la taille. Retours du 2026-10-12 : quatre paliers
// de plus (éclair, croissant, lame ailée, lame céleste), un bon joueur
// dépassant couramment 200 lames, et la lame à aura retouchée (un anneau au
// bout d'une tige se lisait comme une clé).
//
// Conventions communes, celles de l'épée d'origine : pointe vers +x (vers
// l'extérieur de l'orbite), largeur selon z, épaisseur selon y, longueur
// d'environ 1,5 (de -0,55 à 0,95). La taille par palier vient de
// TIER_VISUAL_SCALE ; les formes ne changent que la silhouette, pour qu'on
// reconnaisse le palier d'un joueur d'un coup d'œil.

// Épée ou dague : lame en bipyramide losange (arête centrale qui accroche la
// lumière), garde, poignée et pommeau. Construite à la main, quelques
// dizaines de sommets, instanciée par centaines.
interface SwordParams {
  tipX: number;
  midX: number;
  baseX: number;
  bladeHalfW: number;
  guardHalfZ: number;
  handleX: number;
  pommelX: number;
}

function swordGeometry(p: SwordParams): THREE.BufferGeometry {
  const bladeHalfT = 0.03;
  const guardX = p.baseX - 0.05;
  const guardHalfX = 0.06;
  const guardHalfY = 0.06;
  const handleHalfX = 0.08;
  const handleHalfZ = 0.05;
  const handleHalfY = 0.05;

  const positions: number[] = [];
  const indices: number[] = [];
  const pushV = (x: number, y: number, z: number): number => {
    const i = positions.length / 3;
    positions.push(x, y, z);
    return i;
  };

  const tip = pushV(p.tipX, 0, 0);
  const midT = pushV(p.midX, bladeHalfT, 0);
  const midB = pushV(p.midX, -bladeHalfT, 0);
  const midF = pushV(p.midX, 0, p.bladeHalfW);
  const midK = pushV(p.midX, 0, -p.bladeHalfW);
  indices.push(tip, midT, midF, tip, midF, midB, tip, midB, midK, tip, midK, midT);
  const bHalfW = p.bladeHalfW * 0.6;
  const bHalfT = bladeHalfT * 0.8;
  const baseT = pushV(p.baseX, bHalfT, 0);
  const baseB = pushV(p.baseX, -bHalfT, 0);
  const baseF = pushV(p.baseX, 0, bHalfW);
  const baseK = pushV(p.baseX, 0, -bHalfW);
  indices.push(
    midT, baseT, baseF, midT, baseF, midF,
    midF, baseF, baseB, midF, baseB, midB,
    midB, baseB, baseK, midB, baseK, midK,
    midK, baseK, baseT, midK, baseT, midT,
  );
  indices.push(baseT, baseF, baseB, baseT, baseB, baseK);

  const pushBox = (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number) => {
    const v000 = pushV(cx - hx, cy - hy, cz - hz);
    const v100 = pushV(cx + hx, cy - hy, cz - hz);
    const v010 = pushV(cx - hx, cy + hy, cz - hz);
    const v110 = pushV(cx + hx, cy + hy, cz - hz);
    const v001 = pushV(cx - hx, cy - hy, cz + hz);
    const v101 = pushV(cx + hx, cy - hy, cz + hz);
    const v011 = pushV(cx - hx, cy + hy, cz + hz);
    const v111 = pushV(cx + hx, cy + hy, cz + hz);
    indices.push(v000, v100, v101, v000, v101, v001);
    indices.push(v010, v011, v111, v010, v111, v110);
    indices.push(v000, v010, v110, v000, v110, v100);
    indices.push(v001, v101, v111, v001, v111, v011);
    indices.push(v000, v001, v011, v000, v011, v010);
    indices.push(v100, v110, v111, v100, v111, v101);
  };
  pushBox(guardX, 0, 0, guardHalfX, guardHalfY, p.guardHalfZ);
  pushBox(p.handleX, 0, 0, handleHalfX, handleHalfY, handleHalfZ);

  const pr = 0.065;
  const pmT = pushV(p.pommelX, pr, 0);
  const pmB = pushV(p.pommelX, -pr, 0);
  const pmF = pushV(p.pommelX + pr, 0, 0);
  const pmK = pushV(p.pommelX - pr, 0, 0);
  const pmP = pushV(p.pommelX, 0, pr);
  const pmN = pushV(p.pommelX, 0, -pr);
  indices.push(
    pmT, pmF, pmP, pmT, pmP, pmK,
    pmT, pmK, pmN, pmT, pmN, pmF,
    pmB, pmP, pmF, pmB, pmK, pmP,
    pmB, pmN, pmK, pmB, pmF, pmN,
  );

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint16Array(indices), 1));
  geo.computeVertexNormals();
  return geo;
}

// Silhouette plate extrudée sur `depth` (épaisseur, axe y). Le contour est
// dessiné dans le plan (x, z) : x vers la pointe, second axe = largeur.
function flatGeometry(shapes: THREE.Shape[], depth: number, curveSegments: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false, curveSegments });
  // Plan (x, y) du contour → (x, z) ; l'extrusion (z) devient l'épaisseur.
  geo.rotateX(Math.PI / 2);
  geo.translate(0, depth / 2, 0);
  return geo;
}

// Assemble des morceaux (lame plate, garde, poignée) en une géométrie
// indexée, avec les seuls attributs utiles à l'instanciation.
function assemble(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const cleaned = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(n.attributes)) {
      if (name !== "position" && name !== "normal") n.deleteAttribute(name);
    }
    return n;
  });
  const merged = mergeGeometries(cleaned, false)!;
  merged.computeVertexNormals();
  return merged;
}

function hiltBoxes(guardX: number, guardHalfZ: number, handleLen: number): THREE.BufferGeometry[] {
  const guard = new THREE.BoxGeometry(0.12, 0.12, guardHalfZ * 2);
  guard.translate(guardX, 0, 0);
  const handle = new THREE.BoxGeometry(handleLen, 0.1, 0.1);
  handle.translate(guardX - 0.06 - handleLen / 2, 0, 0);
  return [guard, handle];
}

// Faux : lame à dos droit dont la pointe se recourbe sur le côté, au bout
// d'un manche court.
function scytheGeometry(seg: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.3, -0.07);
  s.lineTo(-0.3, 0.1);
  s.quadraticCurveTo(0.5, 0.2, 1.0, -0.38);
  s.quadraticCurveTo(0.62, -0.12, 0.25, -0.12);
  s.lineTo(-0.3, -0.07);
  const blade = flatGeometry([s], 0.06, seg);
  const shaft = new THREE.BoxGeometry(0.34, 0.09, 0.09);
  shaft.translate(-0.47, 0, 0);
  return assemble([blade, shaft]);
}

// Hauts paliers : orbites pleines (une lame tous les ~0,65 u sur chaque
// anneau), si bien que seule la bordure de l'amas se lit. Le corps reste
// donc fin (sinon les lames voisines se fondent en une masse) et la
// signature est dans la pointe, là où l'espacement est le plus large.

// Scie : lame à dents penchées. Sur la bordure de l'amas, les dents
// dessinent le bord d'une scie circulaire.
function sawGeometry(seg: number): THREE.BufferGeometry {
  const s = new THREE.Shape([
    new THREE.Vector2(-0.3, -0.08), new THREE.Vector2(0.98, -0.08),
    new THREE.Vector2(1.04, 0.02), new THREE.Vector2(0.94, 0.25),
    new THREE.Vector2(0.8, 0.08), new THREE.Vector2(0.72, 0.25),
    new THREE.Vector2(0.58, 0.08), new THREE.Vector2(0.5, 0.25),
    new THREE.Vector2(0.36, 0.08), new THREE.Vector2(-0.3, 0.08),
  ]);
  const blade = flatGeometry([s], 0.06, seg);
  return assemble([blade, ...hiltBoxes(-0.36, 0.18, 0.14)]);
}

// Lame runique : fer de lance en losange, rune évidée au centre.
function runicGeometry(seg: number): THREE.BufferGeometry {
  const s = new THREE.Shape([
    new THREE.Vector2(-0.3, -0.07), new THREE.Vector2(0.42, -0.07),
    new THREE.Vector2(0.72, -0.27), new THREE.Vector2(1.08, 0),
    new THREE.Vector2(0.72, 0.27), new THREE.Vector2(0.42, 0.07),
    new THREE.Vector2(-0.3, 0.07),
  ]);
  const rune = new THREE.Path([
    new THREE.Vector2(0.6, 0), new THREE.Vector2(0.72, -0.11),
    new THREE.Vector2(0.84, 0), new THREE.Vector2(0.72, 0.11),
  ]);
  s.holes.push(rune);
  const blade = flatGeometry([s], 0.06, seg);
  return assemble([blade, ...hiltBoxes(-0.36, 0.24, 0.14)]);
}

// Lame à aura : la pointe enveloppée d'une flamme d'aura, un contour en
// amande fermé et pointu. Les flammes voisines forment une couronne autour
// de l'amas. Avant, un anneau au bout d'une tige fine : vue de près, une clé
// (retour du 2026-10-12). Pointe inchangée (1,16) : même portée qu'avant.
function auraGeometry(seg: number): THREE.BufferGeometry {
  const s = new THREE.Shape([
    new THREE.Vector2(-0.3, -0.075), new THREE.Vector2(0.58, -0.06),
    new THREE.Vector2(1.04, 0), new THREE.Vector2(0.58, 0.06),
    new THREE.Vector2(-0.3, 0.075),
  ]);
  // Plus épaisse que la flamme : la lame passe par-dessus, sans faces
  // confondues.
  const blade = flatGeometry([s], 0.07, seg);
  const flame = new THREE.Shape();
  flame.moveTo(1.16, 0);
  flame.quadraticCurveTo(0.9, 0.28, 0.58, 0.19);
  flame.quadraticCurveTo(0.44, 0.13, 0.48, 0);
  flame.quadraticCurveTo(0.44, -0.13, 0.58, -0.19);
  flame.quadraticCurveTo(0.9, -0.28, 1.16, 0);
  const inner = new THREE.Path();
  inner.moveTo(1.05, 0);
  inner.quadraticCurveTo(0.87, -0.19, 0.63, -0.125);
  inner.quadraticCurveTo(0.555, -0.095, 0.575, 0);
  inner.quadraticCurveTo(0.555, 0.095, 0.63, 0.125);
  inner.quadraticCurveTo(0.87, 0.19, 1.05, 0);
  flame.holes.push(inner);
  const aura = flatGeometry([flame], 0.05, seg);
  return assemble([blade, aura, ...hiltBoxes(-0.36, 0.2, 0.14)]);
}

// Paliers 6 à 9 : même règle (corps fin, signature dans la pointe), pointe
// à 1,2. Chaque silhouette se lit au bord de l'amas : zigzag, croissant,
// ailes, étoile.

// Lame fine, épaule à shoulderX puis pointe à tipX : base des paliers 7 à 9.
function slimBlade(seg: number, shoulderX: number, tipX: number): THREE.BufferGeometry {
  const s = new THREE.Shape([
    new THREE.Vector2(-0.3, -0.075), new THREE.Vector2(shoulderX, -0.065),
    new THREE.Vector2(tipX, 0), new THREE.Vector2(shoulderX, 0.065),
    new THREE.Vector2(-0.3, 0.075),
  ]);
  return flatGeometry([s], 0.06, seg);
}

// Ruban le long d'une ligne brisée (points du contour, x vers la pointe),
// demi-largeur donnée à chaque point : contour décalé de part et d'autre,
// raccords en onglet (angles vifs). Une demi-largeur nulle au dernier point
// fait la pointe.
function ribbonShape(points: ReadonlyArray<readonly [number, number]>, half: readonly number[]): THREE.Shape {
  const n = points.length;
  const left: THREE.Vector2[] = [];
  const right: THREE.Vector2[] = [];
  const normal = (a: readonly [number, number], b: readonly [number, number]): [number, number] => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    return [-dy / len, dx / len];
  };
  for (let i = 0; i < n; i++) {
    const [x, y] = points[i];
    let nx: number;
    let ny: number;
    let miter = 1;
    if (i === 0) [nx, ny] = normal(points[0], points[1]);
    else if (i === n - 1) [nx, ny] = normal(points[n - 2], points[n - 1]);
    else {
      // Bissectrice des deux normales, allongée pour garder la largeur des
      // deux segments (plafonnée : un virage serré pointerait à l'infini).
      const a = normal(points[i - 1], points[i]);
      const b = normal(points[i], points[i + 1]);
      nx = a[0] + b[0];
      ny = a[1] + b[1];
      const len = Math.hypot(nx, ny);
      nx /= len;
      ny /= len;
      miter = 1 / Math.max(0.5, nx * a[0] + ny * a[1]);
    }
    const h = half[i] * miter;
    if (h === 0) {
      left.push(new THREE.Vector2(x, y));
      continue;
    }
    left.push(new THREE.Vector2(x + nx * h, y + ny * h));
    right.push(new THREE.Vector2(x - nx * h, y - ny * h));
  }
  return new THREE.Shape([...left, ...right.reverse()]);
}

// Éclair : la lame part droite puis se brise en zigzag jusqu'à la pointe.
// Au bord de l'amas, une rangée d'éclairs.
function lightningGeometry(seg: number): THREE.BufferGeometry {
  const s = ribbonShape(
    [[-0.3, 0], [0.25, 0], [0.5, 0.2], [0.68, -0.14], [0.92, 0.16], [1.2, -0.06]],
    [0.075, 0.065, 0.08, 0.08, 0.07, 0],
  );
  const blade = flatGeometry([s], 0.06, seg);
  return assemble([blade, ...hiltBoxes(-0.36, 0.22, 0.14)]);
}

// Croissant entre deux cercles (centres sur l'axe, le second en avant) :
// cornes tournées vers la pointe, à l'intersection des deux cercles.
function crescentShape(cx1: number, r1: number, cx2: number, r2: number): THREE.Shape {
  const hornX = (r1 * r1 - r2 * r2 - cx1 * cx1 + cx2 * cx2) / (2 * (cx2 - cx1));
  const hornY = Math.sqrt(r1 * r1 - (hornX - cx1) * (hornX - cx1));
  const a1 = Math.atan2(hornY, hornX - cx1);
  const a2 = Math.atan2(hornY, hornX - cx2);
  const s = new THREE.Shape();
  // Dos du croissant (premier cercle, par l'arrière), puis creux (second
  // cercle, en sens inverse).
  s.absarc(cx1, 0, r1, a1, Math.PI * 2 - a1, false);
  s.absarc(cx2, 0, r2, Math.PI * 2 - a2, a2, true);
  return s;
}

// Croissant de lune : la lame traverse un croissant aux cornes tournées vers
// la pointe, qui les dépasse à peine. Au bord de l'amas, une rangée de lunes
// (plus en retrait, le croissant disparaissait sous les lames voisines).
function crescentGeometry(seg: number): THREE.BufferGeometry {
  const blade = slimBlade(seg, 0.6, 1.2);
  const moon = flatGeometry([crescentShape(0.9, 0.27, 1.05, 0.245)], 0.05, Math.max(seg * 2, 12));
  return assemble([blade, moon, ...hiltBoxes(-0.36, 0.22, 0.14)]);
}

// Lame ailée : deux ailes repliées vers la garde, bord d'attaque bombé et
// trois plumes chacune. Au bord de l'amas, des pointes empennées.
function wingedGeometry(seg: number): THREE.BufferGeometry {
  const blade = slimBlade(seg, 0.6, 1.2);
  const wing = (side: number): THREE.Shape => {
    const w = new THREE.Shape();
    w.moveTo(0.92, 0.02 * side);
    w.quadraticCurveTo(0.78, 0.28 * side, 0.42, 0.31 * side);
    w.lineTo(0.55, 0.23 * side);
    w.lineTo(0.39, 0.22 * side);
    w.lineTo(0.54, 0.15 * side);
    w.lineTo(0.42, 0.12 * side);
    w.lineTo(0.6, 0.02 * side);
    w.lineTo(0.92, 0.02 * side);
    return w;
  };
  const wings = flatGeometry([wing(1), wing(-1)], 0.05, seg);
  return assemble([blade, wings, ...hiltBoxes(-0.36, 0.22, 0.14)]);
}

// Étoile à branches de longueurs `rays` (dans l'ordre, réparties sur le
// tour, la première vers la pointe), creux entre deux branches à `inner`.
function starShape(cx: number, rays: readonly number[], inner: number): THREE.Shape {
  const pts: THREE.Vector2[] = [];
  const step = (Math.PI * 2) / rays.length;
  for (let i = 0; i < rays.length; i++) {
    const a = i * step;
    pts.push(new THREE.Vector2(cx + Math.cos(a) * rays[i], Math.sin(a) * rays[i]));
    const m = a + step / 2;
    pts.push(new THREE.Vector2(cx + Math.cos(m) * inner, Math.sin(m) * inner));
  }
  return new THREE.Shape(pts);
}

// Lame céleste : lame fine couronnée d'une étoile à huit branches, dont la
// plus longue fait la pointe. Au bord de l'amas, une couronne d'étoiles.
function celestialGeometry(seg: number): THREE.BufferGeometry {
  const blade = slimBlade(seg, 0.6, 0.92);
  // Plus épaisse que la lame : l'étoile passe par-dessus.
  const star = flatGeometry([starShape(0.9, [0.3, 0.15, 0.3, 0.15, 0.3, 0.15, 0.3, 0.15], 0.07)], 0.07, seg);
  return assemble([blade, star, ...hiltBoxes(-0.36, 0.24, 0.14)]);
}

// Formes dans l'ordre des paliers (TIER_THRESHOLDS) : une par palier, test
// « une forme par palier » de server/test/bladeShapes.test.ts. Leur pointe
// (x le plus grand) est BLADE_TIP_REACH, vérifié par le même test.
const TIER_SHAPES: ReadonlyArray<(seg: number) => THREE.BufferGeometry> = [
  () => swordGeometry({ tipX: 0.55, midX: -0.02, baseX: -0.2, bladeHalfW: 0.085, guardHalfZ: 0.16, handleX: -0.33, pommelX: -0.45 }),
  () => swordGeometry({ tipX: 0.95, midX: 0.05, baseX: -0.2, bladeHalfW: 0.07, guardHalfZ: 0.26, handleX: -0.35, pommelX: -0.48 }),
  scytheGeometry,
  sawGeometry,
  runicGeometry,
  auraGeometry,
  lightningGeometry,
  crescentGeometry,
  wingedGeometry,
  celestialGeometry,
];
export const TIER_SHAPE_COUNT = TIER_SHAPES.length;

// Géométrie d'un palier (0 à TIER_SHAPE_COUNT - 1). `simple` : courbes
// moins découpées, pour les presets légers.
export function createTierGeometry(tier: number, simple: boolean): THREE.BufferGeometry {
  const seg = simple ? 5 : 10;
  return TIER_SHAPES[Math.max(0, Math.min(TIER_SHAPES.length - 1, tier))](seg);
}
