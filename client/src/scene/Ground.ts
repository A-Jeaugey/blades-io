import * as THREE from "three";
import { MAP_RADIUS } from "@bladeio/shared";
import { QualityConfig } from "../quality";

const GROUND_VERT = /* glsl */ `
  varying vec2 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const GROUND_FRAG_RICH = /* glsl */ `
  precision highp float;
  varying vec2 vWorld;
  uniform float uTime;
  uniform float uRadius;

  float grid(vec2 p, float scale, float width) {
    vec2 g = abs(fract(p / scale - 0.5) - 0.5) / fwidth(p / scale);
    float line = min(g.x, g.y);
    return 1.0 - smoothstep(0.0, width, line);
  }

  void main() {
    float r = length(vWorld);
    float edgeFade = smoothstep(uRadius, uRadius - 60.0, r);
    float g1 = grid(vWorld, 4.0, 1.2);
    float g2 = grid(vWorld, 20.0, 1.4);
    float pulse = 0.85 + 0.15 * sin(uTime * 1.5 + r * 0.05);
    vec3 base = vec3(0.02, 0.024, 0.05);
    vec3 minor = vec3(0.0, 0.8, 1.0) * 0.22;
    vec3 major = vec3(0.4, 0.1, 0.9) * 0.4;
    vec3 col = base + g1 * minor * pulse + g2 * major;
    col *= edgeFade;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Version "low" : une seule grille, pas de pulsation, pas de fwidth.
const GROUND_FRAG_SIMPLE = /* glsl */ `
  precision mediump float;
  varying vec2 vWorld;
  uniform float uRadius;

  float grid(vec2 p, float scale, float width) {
    vec2 f = abs(fract(p / scale - 0.5) - 0.5);
    float d = min(f.x, f.y);
    return 1.0 - smoothstep(0.0, width, d);
  }

  void main() {
    float r = length(vWorld);
    float edgeFade = smoothstep(uRadius, uRadius - 40.0, r);
    float g = grid(vWorld, 20.0, 0.04);
    vec3 base = vec3(0.02, 0.024, 0.05);
    vec3 line = vec3(0.0, 0.65, 0.9) * 0.25;
    vec3 col = base + g * line;
    col *= edgeFade;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Version "flat" (ultra) : juste une couleur unie + edge fade. Pas de grille
// du tout : zéro fragment shader cost. C'est le plus léger qu'on puisse faire
// tout en gardant la délimitation de l'arène.
const GROUND_FRAG_FLAT = /* glsl */ `
  precision lowp float;
  varying vec2 vWorld;
  uniform float uRadius;

  void main() {
    float r = length(vWorld);
    float edgeFade = smoothstep(uRadius, uRadius - 30.0, r);
    vec3 base = vec3(0.04, 0.05, 0.10);
    gl_FragColor = vec4(base * edgeFade, 1.0);
  }
`;

export function createGround(q: QualityConfig): { mesh: THREE.Mesh; update: (t: number) => void } {
  const geo = new THREE.PlaneGeometry(MAP_RADIUS * 2.2, MAP_RADIUS * 2.2, 1, 1);
  let frag: string;
  switch (q.groundDetail) {
    case "rich": frag = GROUND_FRAG_RICH; break;
    case "simple": frag = GROUND_FRAG_SIMPLE; break;
    case "flat": frag = GROUND_FRAG_FLAT; break;
  }
  const uniforms: Record<string, THREE.IUniform> = {
    uRadius: { value: MAP_RADIUS },
  };
  if (q.groundDetail === "rich") uniforms.uTime = { value: 0 };

  const mat = new THREE.ShaderMaterial({
    vertexShader: GROUND_VERT,
    fragmentShader: frag,
    uniforms,
    transparent: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0;
  // Le sol est statique : on désactive le frustum culling pour économiser le
  // test (il sera de toute façon presque toujours visible — caméra plongée).
  // En contrepartie il sera toujours dessiné, ce qui est OK.
  mesh.frustumCulled = false;
  // Static : matrix world calculé une fois.
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();

  const hasTime = q.groundDetail === "rich";
  return {
    mesh,
    update(t: number) {
      if (hasTime) (mat.uniforms.uTime as THREE.IUniform).value = t;
    },
  };
}

export function createBoundaryWall(q: QualityConfig): THREE.Object3D {
  const group = new THREE.Group();
  const segments = q.wallSegments;
  // Tube radial segments réduit aussi (8 → 4 pour low/ultra).
  const tubeSeg = q.wallSegments >= 64 ? 8 : 4;
  const geo = new THREE.TorusGeometry(MAP_RADIUS, 0.6, tubeSeg, segments);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xff2ea8,
    transparent: true,
    opacity: 0.85,
  });
  const torus = new THREE.Mesh(geo, mat);
  torus.rotation.x = Math.PI / 2;
  torus.position.y = 1.0;
  torus.matrixAutoUpdate = false;
  torus.updateMatrix();
  group.add(torus);

  // Mur vertical : on peut sauter cet élément en ultra/low (c'est purement
  // décoratif — le torus suffit à voir la limite).
  if (q.wallSegments >= 64) {
    const wallGeo = new THREE.CylinderGeometry(MAP_RADIUS, MAP_RADIUS, 4, segments, 1, true);
    const wallMat = new THREE.MeshBasicMaterial({
      color: 0xff2ea8,
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
