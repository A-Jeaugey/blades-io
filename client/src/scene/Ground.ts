import * as THREE from "three";
import { MAP_RADIUS, WALL_KILL_THICKNESS } from "@bladeio/shared";
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

// Rideau du mur (qualités high/medium) : bandes diagonales qui défilent le
// long de la bordure, façon ruban de chantier, avec une pulsation lente et
// un fondu vers le haut. 160 bandes sur le tour, soit une tous les ~10 u.
const WALL_CURTAIN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const WALL_CURTAIN_FRAG = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    float stripes = step(0.5, fract(vUv.x * 160.0 + vUv.y * 1.5 - uTime * 0.6));
    float pulse = 0.75 + 0.25 * sin(uTime * 3.0);
    float fade = 1.0 - vUv.y; // uv.y = 0 en bas du rideau, 1 en haut
    gl_FragColor = vec4(uColor, (0.05 + 0.22 * stripes) * pulse * fade);
  }
`;

// Bande de danger au sol (qualités high/medium), sur les derniers mètres
// avant la zone mortelle : c'est ce que la caméra plongeante voit le mieux,
// bien plus que le rideau vertical. Rayures diagonales qui tournent (~390
// sur le tour), rampe d'opacité vers la zone mortelle, zone mortelle
// elle-même quasi pleine. highp : atan() et des coordonnées monde de ~250 u
// crénèlent en mediump.
const DANGER_BAND_VERT = /* glsl */ `
  varying vec2 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const DANGER_BAND_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uInner;
  uniform float uKill;
  varying vec2 vWorld;
  void main() {
    float r = length(vWorld);
    float a = atan(vWorld.y, vWorld.x);
    float stripes = step(0.5, fract(a * 62.0 + r * 0.25 - uTime * 0.8));
    float ramp = smoothstep(uInner, uKill, r);
    float lethal = step(uKill, r);
    float pulse = 0.8 + 0.2 * sin(uTime * 4.0);
    float alpha = mix((0.08 + 0.32 * stripes) * ramp, 0.55 + 0.25 * stripes, lethal) * pulse;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

// Mur de la zone mortelle. Toutes qualités : anneau lumineux qui pulse et
// bande de danger au sol. high/medium : rideau vertical animé en plus. Le
// mur doit paraître dangereux : c'est la seule chose qui tue sans adversaire.
export function createBoundaryWall(q: QualityConfig): { object: THREE.Object3D; update: (t: number) => void } {
  const theme = getActiveTheme();
  const group = new THREE.Group();
  const segments = q.wallSegments;
  const tubeSeg = q.wallSegments >= 64 ? 8 : 4;
  const geo = new THREE.TorusGeometry(MAP_RADIUS, 0.6, tubeSeg, segments);
  const ringMat = new THREE.MeshBasicMaterial({
    color: theme.palette.boundary,
    transparent: true,
    opacity: 0.85,
  });
  const torus = new THREE.Mesh(geo, ringMat);
  torus.rotation.x = Math.PI / 2;
  torus.position.y = 1.0;
  torus.matrixAutoUpdate = false;
  torus.updateMatrix();
  group.add(torus);

  // Bande de danger au sol : shader rayé en high/medium, bande unie qui
  // pulse en low/ultra. 64 segments minimum : avec les 24 du preset ultra,
  // le polygone s'écarterait de 2 u du vrai cercle, là où la précision compte.
  const killRadius = MAP_RADIUS - WALL_KILL_THICKNESS;
  const bandInner = killRadius - 6;
  const bandGeo = new THREE.RingGeometry(bandInner, MAP_RADIUS + 0.5, Math.max(64, segments), 1);
  let bandUniforms: { uColor: THREE.IUniform; uTime: THREE.IUniform; uInner: THREE.IUniform; uKill: THREE.IUniform } | null = null;
  let bandBasic: THREE.MeshBasicMaterial | null = null;
  let bandMat: THREE.Material;
  if (q.wallSegments >= 64) {
    bandUniforms = {
      uColor: { value: new THREE.Color(theme.palette.boundary) },
      uTime: { value: 0 },
      uInner: { value: bandInner },
      uKill: { value: killRadius },
    };
    bandMat = new THREE.ShaderMaterial({
      vertexShader: DANGER_BAND_VERT,
      fragmentShader: DANGER_BAND_FRAG,
      uniforms: bandUniforms,
      transparent: true,
      depthWrite: false,
    });
  } else {
    bandBasic = new THREE.MeshBasicMaterial({
      color: theme.palette.boundary,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    });
    bandMat = bandBasic;
  }
  const band = new THREE.Mesh(bandGeo, bandMat);
  band.rotation.x = -Math.PI / 2;
  band.position.y = 0.04;
  band.frustumCulled = false;
  band.matrixAutoUpdate = false;
  band.updateMatrix();
  group.add(band);

  let curtainUniforms: { uColor: THREE.IUniform; uTime: THREE.IUniform } | null = null;
  if (q.wallSegments >= 64) {
    curtainUniforms = {
      uColor: { value: new THREE.Color(theme.palette.boundary) },
      uTime: { value: 0 },
    };
    const wallGeo = new THREE.CylinderGeometry(MAP_RADIUS, MAP_RADIUS, 4, segments, 1, true);
    const wallMat = new THREE.ShaderMaterial({
      vertexShader: WALL_CURTAIN_VERT,
      fragmentShader: WALL_CURTAIN_FRAG,
      uniforms: curtainUniforms,
      transparent: true,
      depthWrite: false,
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
  return {
    object: group,
    update(t: number) {
      ringMat.opacity = 0.65 + 0.3 * (0.5 + 0.5 * Math.sin(t * 3));
      if (curtainUniforms) curtainUniforms.uTime.value = t;
      if (bandUniforms) bandUniforms.uTime.value = t;
      if (bandBasic) bandBasic.opacity = 0.18 + 0.12 * Math.sin(t * 4);
    },
  };
}
