import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Une forme de lame par palier (tâche 4.1) : dague, épée, faux, scie, lame
// runique, lame à aura. Avant, les trois paliers partageaient l'épée et ne
// se distinguaient que par la taille.
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

// Lame à aura : lame fine couronnée d'un halo à la pointe. Les halos voisins
// forment un anneau lumineux autour de l'amas.
function auraGeometry(seg: number): THREE.BufferGeometry {
  const s = new THREE.Shape([
    new THREE.Vector2(-0.3, -0.08), new THREE.Vector2(0.7, -0.06),
    new THREE.Vector2(0.78, 0), new THREE.Vector2(0.7, 0.06),
    new THREE.Vector2(-0.3, 0.08),
  ]);
  const blade = flatGeometry([s], 0.06, seg);
  const halo = new THREE.Shape();
  halo.absarc(0.92, 0, 0.24, 0, Math.PI * 2, false);
  const inner = new THREE.Path();
  inner.absarc(0.92, 0, 0.15, 0, Math.PI * 2, true);
  halo.holes.push(inner);
  const ring = flatGeometry([halo], 0.05, Math.max(seg * 2, 12));
  return assemble([blade, ring, ...hiltBoxes(-0.36, 0.2, 0.14)]);
}

// Géométrie d'un palier (0 à 5). `simple` : courbes moins découpées, pour
// les presets légers.
export function createTierGeometry(tier: number, simple: boolean): THREE.BufferGeometry {
  const seg = simple ? 5 : 10;
  switch (Math.max(0, Math.min(5, tier))) {
    case 0:
      return swordGeometry({ tipX: 0.55, midX: -0.02, baseX: -0.2, bladeHalfW: 0.085, guardHalfZ: 0.16, handleX: -0.33, pommelX: -0.45 });
    case 1:
      return swordGeometry({ tipX: 0.95, midX: 0.05, baseX: -0.2, bladeHalfW: 0.07, guardHalfZ: 0.26, handleX: -0.35, pommelX: -0.48 });
    case 2:
      return scytheGeometry(seg);
    case 3:
      return sawGeometry(seg);
    case 4:
      return runicGeometry(seg);
    default:
      return auraGeometry(seg);
  }
}
