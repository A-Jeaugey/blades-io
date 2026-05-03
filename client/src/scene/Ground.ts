import * as THREE from "three";
import { MAP_RADIUS } from "@bladeio/shared";
import { QualityConfig } from "../quality";
import { PALETTE } from "./palette";

const GROUND_VERT = /* glsl */ `
  varying vec2 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Ground shader "Sanctuaire des Esprits"
//
// Trois variantes (rich/simple/flat) dérivées de la même intention visuelle :
// un sol de brume mauve organique avec des nappes sombres + des wisps
// lumineux + des cercles rituels concentriques diffus. Pas de grille
// cyberpunk : tout est rond, doux, mouvant.
//
// Truc d'optimisation : tout est issu de bruit value-noise tilable, donc
// pas de textures. Le coût reste équivalent à l'ancien shader grille.
// ─────────────────────────────────────────────────────────────────────────────

const GROUND_FRAG_RICH = /* glsl */ `
  precision highp float;
  varying vec2 vWorld;
  uniform float uTime;
  uniform float uRadius;
  uniform vec3 uBase;
  uniform vec3 uMid;
  uniform vec3 uHighlight;
  uniform vec3 uSacred;

  // Hash léger (cheap, suffisant pour du value noise organique).
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  // FBM 3 octaves : nappes de brume à différentes fréquences.
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
      v += a * vnoise(p);
      p *= 2.07;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    float r = length(vWorld);
    float edgeFade = smoothstep(uRadius, uRadius - 60.0, r);

    // Brume qui dérive lentement (drift directionnel léger).
    vec2 drift = vec2(uTime * 0.025, uTime * 0.018);
    float mist = fbm(vWorld * 0.025 + drift);
    float mistDeep = fbm(vWorld * 0.012 - drift * 0.6);

    // Wisps : taches lumineuses éparses (FBM seuillé). Pulsation lente.
    float wispField = fbm(vWorld * 0.08 + vec2(uTime * 0.04, -uTime * 0.03));
    float wisps = smoothstep(0.62, 0.85, wispField) * (0.7 + 0.3 * sin(uTime * 0.6 + r * 0.04));

    // Cercles rituels concentriques très diffus — repères de distance subtils.
    float rings = 0.5 + 0.5 * sin(r * 0.18 - uTime * 0.4);
    rings = pow(rings, 8.0) * 0.12;

    // Composition : base sombre + nappes mauves + wisps lumineux + cercles.
    vec3 col = uBase;
    col = mix(col, uMid, mistDeep * 0.85);
    col = mix(col, uMid * 1.4, mist * 0.55);
    col += uHighlight * wisps * 0.7;
    col += uSacred * rings;

    col *= edgeFade;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Version "simple" (medium GPUs) : 2 octaves de FBM au lieu de 3, pas de
// wisps animés (juste les nappes + cercles diffus). Reste atmosphérique.
const GROUND_FRAG_SIMPLE = /* glsl */ `
  precision mediump float;
  varying vec2 vWorld;
  uniform float uRadius;
  uniform vec3 uBase;
  uniform vec3 uMid;
  uniform vec3 uSacred;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  void main() {
    float r = length(vWorld);
    float edgeFade = smoothstep(uRadius, uRadius - 40.0, r);
    float mist = vnoise(vWorld * 0.025) * 0.6 + vnoise(vWorld * 0.05) * 0.4;
    float rings = 0.5 + 0.5 * sin(r * 0.18);
    rings = pow(rings, 8.0) * 0.1;
    vec3 col = mix(uBase, uMid, mist);
    col += uSacred * rings;
    col *= edgeFade;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Version "flat" (ultra) : couleur unie + edge fade. Zéro coût shader.
// On garde la teinte mauve profonde pour rester cohérent visuellement avec
// les deux autres niveaux.
const GROUND_FRAG_FLAT = /* glsl */ `
  precision lowp float;
  varying vec2 vWorld;
  uniform float uRadius;
  uniform vec3 uBase;

  void main() {
    float r = length(vWorld);
    float edgeFade = smoothstep(uRadius, uRadius - 30.0, r);
    gl_FragColor = vec4(uBase * edgeFade, 1.0);
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
  // Couleurs du sol passées en uniforms (vec3 0..1) plutôt qu'en littéraux
  // GLSL : permet de retoucher la palette sans recompiler le shader.
  const baseCol = new THREE.Color(PALETTE.groundBase);
  const midCol = new THREE.Color(PALETTE.groundMid);
  const highlightCol = new THREE.Color(PALETTE.groundHighlight);
  const sacredCol = new THREE.Color(PALETTE.sacredGold);
  const uniforms: Record<string, THREE.IUniform> = {
    uRadius: { value: MAP_RADIUS },
    uBase: { value: new THREE.Vector3(baseCol.r, baseCol.g, baseCol.b) },
  };
  if (q.groundDetail !== "flat") {
    uniforms.uMid = { value: new THREE.Vector3(midCol.r, midCol.g, midCol.b) };
    uniforms.uSacred = { value: new THREE.Vector3(sacredCol.r, sacredCol.g, sacredCol.b) };
  }
  if (q.groundDetail === "rich") {
    uniforms.uTime = { value: 0 };
    uniforms.uHighlight = { value: new THREE.Vector3(highlightCol.r, highlightCol.g, highlightCol.b) };
  }

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
    color: PALETTE.boundary,
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
      color: PALETTE.boundary,
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
