import * as THREE from "three";
import { MAP_RADIUS } from "@bladeio/shared";
import { QualityConfig } from "../quality";
import { getActiveTheme } from "../themes";

// Vertex shader commun à tous les thèmes : projette la position monde dans
// vWorld pour que le fragment shader puisse calculer ses effets en
// coordonnées world-space (insensibles à la rotation/translation du mesh).
const GROUND_VERT = /* glsl */ `
  varying vec2 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

// Sources GLSL du fragment shader fournies par le thème actif
// (theme.ground.fragRich/fragSimple/fragFlat). Chaque thème a sa propre
// vision du sol — grille néon, brume mauve organique, etc.

export function createGround(q: QualityConfig): { mesh: THREE.Mesh; update: (t: number) => void } {
  const theme = getActiveTheme();
  const geo = new THREE.PlaneGeometry(MAP_RADIUS * 2.2, MAP_RADIUS * 2.2, 1, 1);
  let frag: string;
  switch (q.groundDetail) {
    case "rich": frag = theme.ground.fragRich; break;
    case "simple": frag = theme.ground.fragSimple; break;
    case "flat": frag = theme.ground.fragFlat; break;
  }

  // Uniforms communs à tous les thèmes : uRadius (toujours), uTime (en rich
  // seulement quand le shader anime quelque chose). Les uniforms theme-
  // spécifiques (couleurs personnalisées par exemple) sont fournis par le
  // hook theme.ground.buildExtraUniforms().
  const uniforms: Record<string, THREE.IUniform> = {
    uRadius: { value: MAP_RADIUS },
    ...theme.ground.buildExtraUniforms(q.groundDetail),
  };
  const hasTime = q.groundDetail === "rich";
  if (hasTime) uniforms.uTime = { value: 0 };

  const mat = new THREE.ShaderMaterial({
    vertexShader: GROUND_VERT,
    fragmentShader: frag,
    uniforms,
    transparent: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();

  return {
    mesh,
    update(t: number) {
      if (hasTime) (mat.uniforms.uTime as THREE.IUniform).value = t;
    },
  };
}

export function createBoundaryWall(q: QualityConfig): THREE.Object3D {
  const theme = getActiveTheme();
  const group = new THREE.Group();
  const segments = q.wallSegments;
  const tubeSeg = q.wallSegments >= 64 ? 8 : 4;
  const geo = new THREE.TorusGeometry(MAP_RADIUS, 0.6, tubeSeg, segments);
  const mat = new THREE.MeshBasicMaterial({
    color: theme.palette.boundary,
    transparent: true,
    opacity: 0.85,
  });
  const torus = new THREE.Mesh(geo, mat);
  torus.rotation.x = Math.PI / 2;
  torus.position.y = 1.0;
  torus.matrixAutoUpdate = false;
  torus.updateMatrix();
  group.add(torus);

  if (q.wallSegments >= 64) {
    const wallGeo = new THREE.CylinderGeometry(MAP_RADIUS, MAP_RADIUS, 4, segments, 1, true);
    const wallMat = new THREE.MeshBasicMaterial({
      color: theme.palette.boundary,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide,
    });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.y = 2;
    wall.matrixAutoUpdate = false;
    wall.updateMatrix();
    group.add(wall);
  }

  group.matrixAutoUpdate = false;
  group.updateMatrix();
  return group;
}
