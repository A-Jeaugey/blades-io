import * as THREE from "three";
import { PowerUpType } from "@bladeio/shared";

// Formes des power-ups, à part de PowerUpView : le kit du rendu v2 les relit
// hors du navigateur (art/kit/dump_shapes.mjs) pour les retravailler dans
// Blender sans en changer la silhouette.

// Une forme par type (tâche 4.3) : la couleur seule, qui change en plus
// avec le thème, ne suffisait pas à les reconnaître. Formes plates posées à
// l'horizontale, lisibles depuis la caméra plongeante, qui tournent dans
// leur plan (jamais vues par la tranche). Elles tiennent dans un rayon ~1,
// comme l'octaèdre d'avant.
export function powerUpShapes(type: PowerUpType): THREE.Shape[] {
  switch (type) {
    case PowerUpType.Speed: {
      // Double chevron « >> ».
      const chevron = (dx: number) => new THREE.Shape([
        new THREE.Vector2(-0.35 + dx, 0.65), new THREE.Vector2(0.05 + dx, 0.65),
        new THREE.Vector2(0.55 + dx, 0), new THREE.Vector2(0.05 + dx, -0.65),
        new THREE.Vector2(-0.35 + dx, -0.65), new THREE.Vector2(0.15 + dx, 0),
      ]);
      return [chevron(0.15), chevron(-0.45)];
    }
    case PowerUpType.Spin: {
      // Flèche circulaire.
      const a0 = 0.5, a1 = Math.PI * 1.75, ro = 0.85, ri = 0.55;
      const s = new THREE.Shape();
      s.moveTo(Math.cos(a0) * ro, Math.sin(a0) * ro);
      s.absarc(0, 0, ro, a0, a1, false);
      s.lineTo(Math.cos(a1) * ri, Math.sin(a1) * ri);
      s.absarc(0, 0, ri, a1, a0, true);
      const head = new THREE.Shape([
        new THREE.Vector2(Math.cos(a0) * 0.35, Math.sin(a0) * 0.35),
        new THREE.Vector2(Math.cos(a0) * 1.05, Math.sin(a0) * 1.05),
        new THREE.Vector2(Math.cos(a0 - 0.55) * 0.7, Math.sin(a0 - 0.55) * 0.7),
      ]);
      return [s, head];
    }
    case PowerUpType.Magnet: {
      // Fer à cheval.
      const s = new THREE.Shape();
      s.moveTo(-0.8, 0.65);
      s.lineTo(-0.8, 0);
      s.absarc(0, 0, 0.8, Math.PI, Math.PI * 2, false);
      s.lineTo(0.8, 0.65);
      s.lineTo(0.42, 0.65);
      s.lineTo(0.42, 0);
      s.absarc(0, 0, 0.42, 0, Math.PI, true);
      s.lineTo(-0.42, 0.65);
      return [s];
    }
    case PowerUpType.Shield: {
      // Écu.
      const s = new THREE.Shape();
      s.moveTo(-0.7, 0.75);
      s.lineTo(0.7, 0.75);
      s.quadraticCurveTo(0.78, -0.2, 0, -0.95);
      s.quadraticCurveTo(-0.78, -0.2, -0.7, 0.75);
      return [s];
    }
    case PowerUpType.Blades: {
      // Shuriken à quatre pointes.
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r = i % 2 === 0 ? 1.0 : 0.3;
        pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
      }
      const s = new THREE.Shape(pts);
      const hole = new THREE.Path();
      hole.absarc(0, 0, 0.14, 0, Math.PI * 2, true);
      s.holes.push(hole);
      return [s];
    }
  }
}

// Forme extrudée et centrée d'un type : celle du rendu d'origine, et le
// point de départ de celle du kit.
export function powerUpGeometry(type: PowerUpType, curveSegments: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(powerUpShapes(type), { depth: 0.24, bevelEnabled: false, curveSegments });
  geo.center();
  return geo;
}
