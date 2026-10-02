import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  ARCH_HALF_SPAN,
  BILLBOARD_RADIUS,
  MapStructure,
  STRUCTURES,
} from "@bladeio/shared";
import { QualityConfig } from "../quality";
import { DecorVariant } from "../themes";

// Structures de la carte (tâche 4.7) : panneaux holographiques, arches,
// racks, pads à drone, cristaux. Positions et colliders dans
// shared/src/decor.ts (les mêmes pour tous les thèmes) ; ici, leur visuel.
// Tout ce qui ne bouge pas est fusionné en trois géométries (corps sombres,
// éléments lumineux à couleurs par sommet, écrans translucides) : trois
// appels de rendu pour les 25 structures, néons compris même en potato
// (des sommets, pas des appels de rendu ; seuls les drones y manquent). En qualité haute seulement, les
// écrans défilent, les LED clignotent (selon le réglage des flashs), les
// drones flottent et les cristaux tournent. Variante spirit : mêmes
// silhouettes en pierre (portiques à double linteau, stèles à glyphes).

export interface StructureSet {
  object: THREE.Object3D;
  update(t: number): void;
  setFlashIntensity(k: number): void;
  dispose(): void;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const SHARD_SCALE = new THREE.Vector3(0.7, 1.8, 0.7);

// Rotation autour de la verticale qui amène l'axe local voulu sur l'angle
// de la structure (cf. shared/src/decor.ts) : +z local vers l'avant d'un
// panneau ou l'axe d'un passage, +x local le long de la largeur d'un rack.
function yawOf(st: MapStructure): number {
  switch (st.kind) {
    case "billboard":
    case "arch":
      return Math.PI / 2 - st.angle;
    case "rack":
      return -st.angle;
    default:
      return 0;
  }
}

// Une pièce posée dans le monde, non indexée et colorée par sommet (les
// géométries fusionnées doivent avoir les mêmes attributs).
function bake(geo: THREE.BufferGeometry, world: THREE.Matrix4, color: THREE.Color): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.applyMatrix4(world);
  const n = g.getAttribute("position").count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return g;
}

// Écran holographique : barres qui défilent, colonnes de « glyphes »,
// cadre plus lumineux, balayage qui scintille (selon le réglage des flashs).
// Instancié : la matrice de l'instance place chaque écran.
const PANEL_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;
const PANEL_FRAG = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uFlash;
  varying vec2 vUv;
  void main() {
    float y = vUv.y * 9.0 + uTime * 0.6;
    float rows = step(0.45, fract(y));
    vec2 cell = floor(vec2(vUv.x * 14.0, y));
    float glyph = step(0.5, fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453));
    float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float border = 1.0 - smoothstep(0.0, 0.045, edge);
    float scan = 1.0 - 0.25 * uFlash * (0.5 + 0.5 * sin(vUv.y * 90.0 - uTime * 5.0));
    float a = (0.16 + 0.26 * rows * glyph + 0.5 * border) * scan;
    gl_FragColor = vec4(uColor * (0.75 + 0.5 * border), a);
    #include <colorspace_fragment>
  }
`;

// Face de rack : grille de LED, chacune à son rythme ; sans flashs, elles
// restent allumées, fixes.
const LED_FRAG = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  uniform vec3 uBase;
  uniform float uTime;
  uniform float uFlash;
  varying vec2 vUv;
  void main() {
    vec2 g = vUv * vec2(8.0, 12.0);
    vec2 cell = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
    float present = step(0.35, h);
    float blink = 0.5 + 0.5 * sin(uTime * (1.5 + h * 5.0) + h * 40.0);
    float lit = present * mix(1.0, blink, uFlash);
    float led = 1.0 - smoothstep(0.16, 0.27, length(f));
    gl_FragColor = vec4(mix(uBase, uColor, led * lit), 1.0);
    #include <colorspace_fragment>
  }
`;

export function createStructures(q: QualityConfig, v: DecorVariant): StructureSet {
  const group = new THREE.Group();
  const disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  const spirit = v.kind === "spirit";
  const rich = q.decorDetail === "rich";
  const minimal = q.decorDetail === "minimal";
  const time: THREE.IUniform = { value: 0 };
  const flash: THREE.IUniform = { value: 1 };

  const cBody = new THREE.Color(v.baseDark);
  const cNeon = new THREE.Color(v.structureNeon);
  const cScreen = new THREE.Color(v.structureScreen);
  const cLed = new THREE.Color(v.structureLed);

  const body: THREE.BufferGeometry[] = [];
  const glow: THREE.BufferGeometry[] = [];
  const screens: THREE.BufferGeometry[] = [];
  // Pièces animées (qualité haute) : à part.
  const panels: Array<{ x: number; y: number; z: number; yaw: number }> = [];
  const ledFaces: THREE.Matrix4[] = [];
  const drones: Array<{ x: number; z: number; phase: number }> = [];
  const shards: Array<{ x: number; z: number; phase: number }> = [];

  const seg = minimal ? 6 : rich ? 12 : 8;
  // Briques de base, réutilisées par toutes les pièces.
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, seg);
  const cone = new THREE.CylinderGeometry(0.7, 1, 1, seg);
  const plane = new THREE.PlaneGeometry(1, 1);
  const ring = new THREE.RingGeometry(0.8, 1, minimal ? 16 : 32);
  const disc = new THREE.CircleGeometry(0.8, minimal ? 16 : 32);
  const crystal = new THREE.OctahedronGeometry(1, 0);
  const orb = new THREE.SphereGeometry(1, minimal ? 6 : 10, minimal ? 4 : 6);
  disposables.push(box, cyl, cone, plane, ring, disc, crystal, orb);

  // Pose une pièce dans le repère d'une structure (local : x, hauteur, z).
  const place = (
    out: THREE.BufferGeometry[],
    geo: THREE.BufferGeometry,
    st: MapStructure,
    yaw: number,
    lx: number, ly: number, lz: number,
    sx: number, sy: number, sz: number,
    color: THREE.Color,
    flat = false,
  ): void => {
    const local = new THREE.Matrix4().compose(
      tmpP.set(lx, ly, lz),
      flat ? tmpQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2) : tmpQ.identity(),
      tmpS.set(sx, sy, sz),
    );
    const world = new THREE.Matrix4().compose(
      tmpP.set(st.x, 0, st.y),
      tmpQ.setFromAxisAngle(Y_AXIS, yaw),
      tmpS.set(1, 1, 1),
    ).multiply(local);
    out.push(bake(geo, world, color));
  };

  for (const st of STRUCTURES) {
    const yaw = yawOf(st);
    switch (st.kind) {
      case "billboard": {
        // Pylône, coiffe et cadre lumineux, écran en hauteur (translucide :
        // on voit ce qu'il y a derrière).
        // Socle à la taille du collider (BILLBOARD_RADIUS) : on voit où
        // l'on bute.
        place(body, cyl, st, yaw, 0, 0.3, 0, BILLBOARD_RADIUS, 0.6, BILLBOARD_RADIUS, cBody);
        place(body, cone, st, yaw, 0, 3.2, 0, spirit ? 0.7 : 0.45, 6.4, spirit ? 0.7 : 0.45, cBody);
        place(glow, orb, st, yaw, 0, 6.6, 0, 0.32, 0.32, 0.32, cNeon);
        const w = spirit ? 2.6 : 5.0;
        const h = spirit ? 3.6 : 2.4;
        const cy = spirit ? 5.6 : 6.0;
        place(glow, box, st, yaw, 0, cy - h / 2 - 0.08, 0.5, w + 0.3, 0.12, 0.12, cNeon);
        place(glow, box, st, yaw, 0, cy + h / 2 + 0.08, 0.5, w + 0.3, 0.12, 0.12, cNeon);
        if (rich) panels.push({ x: st.x, y: cy, z: st.y, yaw });
        else place(screens, plane, st, yaw, 0, cy, 0.5, w, h, 1, cScreen);
        break;
      }
      case "arch": {
        // Deux piliers (les colliders) et un linteau ; néon en U inversé
        // sur l'intérieur. Spirit : portique, linteau débordant et
        // traverse plus bas.
        const span = ARCH_HALF_SPAN;
        // Piliers de 1,1 u : leurs coins tombent sur le collider (0,7 u).
        place(body, box, st, yaw, -span, 2.2, 0, 1.1, 4.4, 1.1, cBody);
        place(body, box, st, yaw, span, 2.2, 0, 1.1, 4.4, 1.1, cBody);
        place(body, box, st, yaw, 0, 4.7, 0, spirit ? 7.6 : 6.3, 0.6, spirit ? 1.1 : 0.9, spirit ? cNeon : cBody);
        if (spirit) place(body, box, st, yaw, 0, 3.7, 0, 5.8, 0.3, 0.5, cBody);
        {
          place(glow, box, st, yaw, -(span - 0.6), 2.1, 0, 0.1, 3.8, 0.5, cNeon);
          place(glow, box, st, yaw, span - 0.6, 2.1, 0, 0.1, 3.8, 0.5, cNeon);
          if (!spirit) place(glow, box, st, yaw, 0, 4.38, 0, 4.3, 0.1, 0.5, cNeon);
          // Liserés sur le dessus du linteau : la caméra le voit d'en haut.
          const lw = spirit ? 7.6 : 6.3;
          place(glow, box, st, yaw, 0, 5.02, 0.4, lw, 0.06, 0.1, cNeon);
          place(glow, box, st, yaw, 0, 5.02, -0.4, lw, 0.06, 0.1, cNeon);
        }
        break;
      }
      case "rack": {
        // Bloc de 2,6 × 1,4 (les deux colliders), LED sur les deux faces.
        place(body, box, st, yaw, 0, 1.5, 0, 2.6, 3.0, 1.4, cBody);
        place(glow, box, st, yaw, 0, 3.04, 0, 2.6, 0.08, 1.4, cNeon);
        if (rich) {
          for (const side of [1, -1]) {
            ledFaces.push(new THREE.Matrix4().compose(
              tmpP.set(st.x, 0, st.y),
              tmpQ.setFromAxisAngle(Y_AXIS, yaw),
              tmpS.set(1, 1, 1),
            ).multiply(new THREE.Matrix4().compose(
              tmpP.set(0, 1.5, side * 0.71),
              tmpQ.setFromAxisAngle(Y_AXIS, side > 0 ? 0 : Math.PI),
              tmpS.set(2.3, 2.6, 1),
            )));
          }
        } else {
          // LED figées : trois lignes par face.
          for (const side of [1, -1]) {
            for (const ly of [0.8, 1.5, 2.2]) {
              place(glow, box, st, yaw, 0, ly, side * 0.71, 2.1, 0.07, 0.02, cLed);
            }
          }
        }
        break;
      }
      case "dronePad": {
        // Disque translucide, anneau et « H » lumineux ; drone en vol.
        place(screens, disc, st, yaw, 0, 0.045, 0, 2.1, 2.1, 1, cScreen, true);
        place(glow, ring, st, yaw, 0, 0.05, 0, 2.1, 2.1, 1, cScreen, true);
        {
          place(glow, box, st, yaw, -0.55, 0.055, 0, 0.12, 0.02, 1.4, cScreen);
          place(glow, box, st, yaw, 0.55, 0.055, 0, 0.12, 0.02, 1.4, cScreen);
          place(glow, box, st, yaw, 0, 0.055, 0, 1.1, 0.02, 0.12, cScreen);
        }
        const phase = (st.x * 0.37 + st.y * 0.11) % (Math.PI * 2);
        if (rich) drones.push({ x: st.x, z: st.y, phase });
        else if (!minimal) {
          place(body, box, st, yaw, 0, 3.2, 0, 1.0, 0.22, 1.0, cBody);
          place(body, box, st, yaw, 0, 3.2, 0, 1.9, 0.06, 0.14, cBody);
          place(body, box, st, yaw, 0, 3.2, 0, 0.14, 0.06, 1.9, cBody);
          place(glow, orb, st, yaw, 0, 3.0, 0, 0.16, 0.16, 0.16, cLed);
        }
        break;
      }
      case "shard": {
        // Cristal en lévitation au-dessus d'une lueur au sol.
        const phase = (st.x * 0.29 - st.y * 0.17) % (Math.PI * 2);
        place(screens, disc, st, yaw, 0, 0.045, 0, 1.6, 1.6, 1, cNeon, true);
        if (rich) shards.push({ x: st.x, z: st.y, phase });
        else place(glow, crystal, st, yaw, 0, 3.0, 0, SHARD_SCALE.x, SHARD_SCALE.y, SHARD_SCALE.z, cNeon);
        break;
      }
    }
  }

  const merge = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null => {
    if (parts.length === 0) return null;
    const g = mergeGeometries(parts, false);
    for (const p of parts) p.dispose();
    if (g) disposables.push(g);
    return g;
  };
  const addStatic = (geo: THREE.BufferGeometry | null, mat: THREE.Material, order = 0): void => {
    disposables.push(mat);
    if (!geo) return;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = order;
    group.add(mesh);
  };

  // Corps sombres : éclairés en haute et moyenne qualité, à plat sinon.
  const bodyMat = q.simpleMaterials
    ? new THREE.MeshBasicMaterial({ vertexColors: true })
    : new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.45, emissive: cNeon, emissiveIntensity: 0.06 });
  addStatic(merge(body), bodyMat);
  addStatic(merge(glow), new THREE.MeshBasicMaterial({ vertexColors: true }));
  addStatic(
    merge(screens),
    // Face avant : écrans tournés vers la caméra, disques au sol ; une
    // passe au lieu de deux.
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.32, depthWrite: false }),
    3,
  );

  // Écrans animés.
  if (panels.length > 0) {
    const w = spirit ? 2.6 : 5.0;
    const h = spirit ? 3.6 : 2.4;
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.ShaderMaterial({
      vertexShader: PANEL_VERT,
      fragmentShader: PANEL_FRAG,
      uniforms: { uColor: { value: cScreen }, uTime: time, uFlash: flash },
      transparent: true,
      depthWrite: false,
    });
    disposables.push(geo, mat);
    const mesh = new THREE.InstancedMesh(geo, mat, panels.length);
    panels.forEach((p, i) => {
      tmpM.compose(
        tmpP.set(p.x, p.y, p.z).add(new THREE.Vector3(Math.sin(p.yaw) * 0.5, 0, Math.cos(p.yaw) * 0.5)),
        tmpQ.setFromAxisAngle(Y_AXIS, p.yaw),
        tmpS.set(1, 1, 1),
      );
      mesh.setMatrixAt(i, tmpM);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    group.add(mesh);
  }

  // Faces de LED.
  if (ledFaces.length > 0) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: PANEL_VERT,
      fragmentShader: LED_FRAG,
      uniforms: { uColor: { value: cLed }, uBase: { value: cBody }, uTime: time, uFlash: flash },
    });
    disposables.push(mat);
    const mesh = new THREE.InstancedMesh(plane, mat, ledFaces.length);
    ledFaces.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  // Drones (corps, bras et lumière) et cristaux, animés par instance.
  let droneMesh: THREE.InstancedMesh | null = null;
  let droneLight: THREE.InstancedMesh | null = null;
  if (drones.length > 0) {
    const parts = [
      bake(box, new THREE.Matrix4().makeScale(1.0, 0.22, 1.0), cBody),
      bake(box, new THREE.Matrix4().makeScale(1.9, 0.06, 0.14), cBody),
      bake(box, new THREE.Matrix4().makeScale(0.14, 0.06, 1.9), cBody),
    ];
    for (const [x, z] of [[0.95, 0], [-0.95, 0], [0, 0.95], [0, -0.95]]) {
      parts.push(bake(cyl, new THREE.Matrix4().compose(tmpP.set(x, 0.08, z), tmpQ.identity(), tmpS.set(0.34, 0.03, 0.34)), cNeon));
    }
    const geo = merge(parts)!;
    const mat = q.simpleMaterials
      ? new THREE.MeshBasicMaterial({ vertexColors: true })
      : new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.45 });
    disposables.push(mat);
    droneMesh = new THREE.InstancedMesh(geo, mat, drones.length);
    droneMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    droneMesh.frustumCulled = false;
    group.add(droneMesh);
    const lightMat = new THREE.MeshBasicMaterial({ color: cLed });
    disposables.push(lightMat);
    droneLight = new THREE.InstancedMesh(orb, lightMat, drones.length);
    droneLight.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    droneLight.frustumCulled = false;
    group.add(droneLight);
  }
  let shardMesh: THREE.InstancedMesh | null = null;
  if (shards.length > 0) {
    const mat = new THREE.MeshBasicMaterial({ color: cNeon });
    disposables.push(mat);
    shardMesh = new THREE.InstancedMesh(crystal, mat, shards.length);
    shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    shardMesh.frustumCulled = false;
    group.add(shardMesh);
  }

  group.matrixAutoUpdate = false;

  const animate = (t: number): void => {
    if (droneMesh && droneLight) {
      drones.forEach((d, i) => {
        const y = 3.2 + Math.sin(t * 1.3 + d.phase) * 0.25;
        tmpM.compose(tmpP.set(d.x, y, d.z), tmpQ.setFromAxisAngle(Y_AXIS, t * 0.4 + d.phase), tmpS.set(1, 1, 1));
        droneMesh!.setMatrixAt(i, tmpM);
        tmpM.compose(tmpP.set(d.x, y - 0.2, d.z), tmpQ.identity(), tmpS.set(0.16, 0.16, 0.16));
        droneLight!.setMatrixAt(i, tmpM);
      });
      droneMesh.instanceMatrix.needsUpdate = true;
      droneLight.instanceMatrix.needsUpdate = true;
    }
    if (shardMesh) {
      shards.forEach((s, i) => {
        tmpM.compose(
          tmpP.set(s.x, 3.0 + Math.sin(t * 0.9 + s.phase) * 0.35, s.z),
          tmpQ.setFromAxisAngle(Y_AXIS, t * 0.6 + s.phase),
          tmpS.copy(SHARD_SCALE),
        );
        shardMesh!.setMatrixAt(i, tmpM);
      });
      shardMesh.instanceMatrix.needsUpdate = true;
    }
  };
  animate(0);

  return {
    object: group,
    update(t: number) {
      time.value = t;
      animate(t);
    },
    setFlashIntensity(k: number) {
      flash.value = Math.max(0, Math.min(1, k));
    },
    dispose() {
      group.parent?.remove(group);
      for (const d of disposables) d.dispose();
    },
  };
}
