import * as THREE from "three";
import {
  BUSHES,
  CENTRAL_PILLAR,
  FLOATING_CUBES,
  GROUND_PADS,
  INNER_OBELISKS,
  MapStructure,
  OBELISKS,
  STRUCTURES,
} from "@bladeio/shared";
import { QualityConfig } from "../../quality";
import { DecorVariant, getActiveTheme } from "../../themes";
import type { DecorHandle } from "../Decor";
import { Kit } from "./kit";
import { REED_PUSHERS, WorldFx } from "./WorldFx";

// Décor du rendu v2 (?gfx=v2) : les mêmes obstacles aux mêmes endroits
// (shared/src/decor.ts) que Decor.ts, Structures.ts et Bushes.ts, mais avec
// les pièces du kit modélisé dans Blender, éclairées et qui portent une
// ombre. Une InstancedMesh par morceau de pièce : une trentaine d'appels de
// rendu pour toute la carte.

type Cyber = Extract<DecorVariant, { kind: "cyber" }>;

// Rayon des modèles du kit (art/kit/build_kit.py) : mis à l'échelle du
// collider, pour qu'on bute là où on voit la pièce.
const OBELISK_MODEL_RADIUS = 1.5;
const BUSH_MODEL_RADIUS = 5;
// Hauteurs de vol, comme Structures.ts.
const DRONE_HEIGHT = 3.4;
const SHARD_HEIGHT = 3.4;

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpE = new THREE.Euler();

function matrixAt(x: number, y: number, z: number, yaw = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  return new THREE.Matrix4().compose(tmpP.set(x, y, z), tmpQ.setFromAxisAngle(Y_AXIS, yaw), tmpS.set(sx, sy, sz));
}

// Même convention que Structures.ts : +z local vers l'avant d'un panneau ou
// l'axe d'un passage, +x local le long de la largeur d'un rack.
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

// --- Lueurs au sol -------------------------------------------------------
// Chaque pièce lumineuse éclaire le sol autour d'elle. Pas de vraie lumière
// (une par pièce coûterait une boucle par pixel) : une tache par source,
// peinte une fois dans une texture que le sol lit (GroundV2.ts).
export interface LightPool {
  x: number;
  z: number;
  radius: number;
  color: number;
  strength: number;
}

export function decorLightPools(): LightPool[] {
  const v = getActiveTheme().decor;
  const pools: LightPool[] = [];
  if (v.kind !== "cyber") return pools;
  pools.push({ x: CENTRAL_PILLAR.x, z: CENTRAL_PILLAR.y, radius: 15, color: v.shrineCore, strength: 0.9 });
  OBELISKS.forEach((o, i) => {
    pools.push({ x: o.x, z: o.y, radius: 6 + o.radius * 3, color: i < INNER_OBELISKS ? v.obeliskInner : v.obeliskOuter, strength: 0.75 });
  });
  for (const st of STRUCTURES) {
    switch (st.kind) {
      case "billboard": {
        // L'écran éclaire devant lui.
        const yaw = yawOf(st);
        pools.push({ x: st.x + Math.sin(yaw) * 3, z: st.y + Math.cos(yaw) * 3, radius: 11, color: v.structureScreen, strength: 0.7 });
        break;
      }
      case "arch":
        pools.push({ x: st.x, z: st.y, radius: 8, color: v.structureNeon, strength: 0.7 });
        break;
      case "rack":
        pools.push({ x: st.x, z: st.y, radius: 7, color: v.structureLed, strength: 0.6 });
        break;
      case "dronePad":
        pools.push({ x: st.x, z: st.y, radius: 8, color: v.structureScreen, strength: 0.8 });
        break;
      case "shard":
        pools.push({ x: st.x, z: st.y, radius: 7, color: v.structureNeon, strength: 0.6 });
        break;
    }
  }
  for (const b of BUSHES) pools.push({ x: b.x, z: b.y, radius: b.radius + 4, color: v.bushAccent, strength: 0.35 });
  for (const p of GROUND_PADS) pools.push({ x: p.x, z: p.y, radius: 5, color: v.groundPad, strength: 0.45 });
  for (const c of FLOATING_CUBES) pools.push({ x: c.x, z: c.y, radius: 5, color: v.cubeColor, strength: 0.35 });
  return pools;
}

// --- Matériaux : un par rôle du kit, aux couleurs du thème ---------------
function roleMaterials(v: Cyber): Record<string, THREE.Material> {
  const dark = new THREE.Color(v.baseDark);
  const white = new THREE.Color(1, 1, 1);
  // Sans carte d'environnement, un métal pur ne reflète rien et reste noir :
  // métal partiel, la lumière de la scène suffit à lui donner du volume.
  const solid = (lighten: number, roughness: number, metalness: number) =>
    new THREE.MeshStandardMaterial({ color: dark.clone().lerp(white, lighten), roughness, metalness });
  const glow = (color: number, intensity: number) =>
    new THREE.MeshStandardMaterial({ color: dark, emissive: color, emissiveIntensity: intensity, roughness: 0.4, metalness: 0.2 });
  return {
    body: solid(0.1, 0.42, 0.45),
    body_mid: solid(0.24, 0.5, 0.4),
    paint: solid(0.5, 0.9, 0),
    soil: solid(0.02, 1, 0),
    // Au-dessus de 1 : la cible de la scène est en HDR, c'est ce qui fait
    // mordre le bloom sur les filets lumineux.
    e_obelisk: glow(v.obeliskInner, 2.6),
    e_obelisk_outer: glow(v.obeliskOuter, 2.6),
    e_core: glow(v.shrineCore, 2.8),
    e_halo: glow(v.shrineHalo, 2.0),
    e_neon: glow(v.structureNeon, 2.8),
    e_screen: glow(v.structureScreen, 2.2),
    e_led: glow(v.structureLed, 2.6),
    e_cube: glow(v.cubeColor, 2.2),
    e_pad: glow(v.groundPad, 1.5),
    // Écran holographique : translucide, on voit ce qu'il y a derrière.
    screen: new THREE.MeshBasicMaterial({
      color: v.structureScreen,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  };
}

// Roseaux : COLOR_0 du kit = hauteur le long de la lame (0 au pied, 1 à la
// pointe). Pied sombre (la couleur est multipliée par cette hauteur),
// pointe lumineuse, un balancement lent qui grandit avec la hauteur, et les
// lames qui se couchent autour des joueurs qui les traversent (`push` :
// positions des joueurs visibles, WorldFx.ts). Tout ça en coordonnées
// monde : chaque buisson a sa rotation et son échelle.
// `fade` (1 : plein, vers 0 : clairsemé) efface des pixels en trame au lieu
// de rendre le matériau transparent : passer un matériau en transparent
// change son programme, donc une compilation en pleine partie à la
// première entrée dans un buisson.
function reedsMaterial(v: Cyber, time: THREE.IUniform, fade: THREE.IUniform, push: THREE.IUniform): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: v.bushAccent,
    emissive: v.bushAccent,
    emissiveIntensity: 0.55,
    roughness: 0.7,
    metalness: 0,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uReedTime = time;
    shader.uniforms.uReedFade = fade;
    shader.uniforms.uReedPush = push;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nuniform float uReedTime;\nuniform vec3 uReedPush[${REED_PUSHERS}];`)
      .replace(
        "#include <project_vertex>",
        // Remplace la projection de three.js (maillage sans instance).
        `float reedH = color.r * color.r;
        vec4 reedWorld = modelMatrix * vec4(transformed, 1.0);
        reedWorld.x += sin(uReedTime * 1.4 + reedWorld.x * 0.9 + reedWorld.z * 0.7) * 0.14 * reedH;
        reedWorld.z += cos(uReedTime * 1.1 + reedWorld.x * 0.6 - reedWorld.z * 0.8) * 0.1 * reedH;
        for (int i = 0; i < ${REED_PUSHERS}; i++) {
          vec2 away = reedWorld.xz - uReedPush[i].xy;
          float dist = length(away);
          float bend = max(0.0, 1.0 - dist / 2.4) * uReedPush[i].z;
          bend *= bend * reedH;
          // Division bornée : un joueur pile sur le pied d'une lame.
          reedWorld.xz += away / max(dist, 0.05) * (bend * 1.5);
          reedWorld.y -= bend * 0.7;
        }
        vec4 mvPosition = viewMatrix * reedWorld;
        gl_Position = projectionMatrix * mvPosition;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uReedFade;")
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
        if (fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) > uReedFade) discard;`,
      )
      .replace(
      "#include <emissivemap_fragment>",
      // Carré de carré, pas pow() : la base ne peut pas être négative, mais
      // autant ne pas dépendre de l'interpolation.
      `#include <emissivemap_fragment>
      float reedTip = vColor.r * vColor.r;
      totalEmissiveRadiance *= reedTip * reedTip;`,
    );
  };
  mat.customProgramCacheKey = () => "v2-reeds";
  return mat;
}

export function createDecorV2(q: QualityConfig, kit: Kit, world: WorldFx): DecorHandle {
  const v = getActiveTheme().decor as Cyber;
  const group = new THREE.Group();
  const mats = roleMaterials(v);
  const time: THREE.IUniform = { value: 0 };
  const animate = q.decorDetail === "rich";

  // Une InstancedMesh par morceau de la pièce. `swap` remplace un rôle par
  // un autre (obélisques extérieurs). Les pièces animées gardent leurs
  // maillages pour réécrire leurs matrices.
  const instance = (
    piece: string,
    matrices: THREE.Matrix4[],
    opts: { swap?: Record<string, string>; dynamic?: boolean; shadow?: boolean } = {},
  ): THREE.InstancedMesh[] => {
    const out: THREE.InstancedMesh[] = [];
    if (matrices.length === 0) return out;
    for (const part of kit.parts(piece)) {
      let mat = mats[opts.swap?.[part.role] ?? part.role];
      if (!mat) throw new Error(`kit : rôle « ${part.role} » sans matériau`);
      if (part.emissiveMap && mat instanceof THREE.MeshStandardMaterial) {
        mat = mat.clone();
        (mat as THREE.MeshStandardMaterial).emissiveMap = part.emissiveMap;
      }
      const lit = mat instanceof THREE.MeshStandardMaterial;
      // Pièce unique (le pilier central) : un maillage simple. Il est sous
      // la caméra du lobby, donc dans la carte d'ombres dès le menu : le
      // programme d'ombre des maillages sans instance (joueurs, roseaux) se
      // compile là, et non à l'arrivée du premier joueur en partie.
      if (matrices.length === 1 && !opts.dynamic) {
        const single = new THREE.Mesh(part.geometry, mat);
        single.applyMatrix4(matrices[0]);
        single.castShadow = lit && opts.shadow !== false;
        single.receiveShadow = lit;
        single.matrixAutoUpdate = false;
        single.updateMatrix();
        group.add(single);
        continue;
      }
      const mesh = new THREE.InstancedMesh(part.geometry, mat, matrices.length);
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      if (opts.dynamic) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = lit && opts.shadow !== false;
      mesh.receiveShadow = lit;
      // Les instances couvrent toute la carte : le test de visibilité de
      // l'ensemble passerait toujours.
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      out.push(mesh);
    }
    return out;
  };

  // Pilier central et obélisques.
  instance("CentralPillar", [matrixAt(CENTRAL_PILLAR.x, 0, CENTRAL_PILLAR.y)]);
  const inner: THREE.Matrix4[] = [];
  const outer: THREE.Matrix4[] = [];
  OBELISKS.forEach((o, i) => {
    const s = o.radius / OBELISK_MODEL_RADIUS;
    (i < INNER_OBELISKS ? inner : outer).push(matrixAt(o.x, 0, o.y, (i * 0.7) % (Math.PI * 2), s, s, s));
  });
  instance("Obelisk", inner);
  instance("Obelisk", outer, { swap: { e_obelisk: "e_obelisk_outer" } });

  // Structures.
  const byKind = (kind: MapStructure["kind"]) => STRUCTURES.filter((st) => st.kind === kind);
  const placed = (kind: MapStructure["kind"]) => byKind(kind).map((st) => matrixAt(st.x, 0, st.y, yawOf(st)));
  instance("Rack", placed("rack"));
  instance("Arch", placed("arch"));
  instance("Billboard", placed("billboard"));
  instance("BillboardScreen", placed("billboard"));
  instance("DronePad", placed("dronePad"), { shadow: false });
  instance("GroundPad", GROUND_PADS.map((p, i) => matrixAt(p.x, 0, p.y, i * 1.3)), { shadow: false });

  // Pièces en vol : drones, cristaux, cubes.
  const drones = byKind("dronePad").map((st) => ({ x: st.x, z: st.y, phase: (st.x * 0.37 + st.y * 0.11) % (Math.PI * 2) }));
  const shards = byKind("shard").map((st) => ({ x: st.x, z: st.y, phase: (st.x * 0.29 - st.y * 0.17) % (Math.PI * 2) }));
  const droneMeshes = instance("Drone", drones.map((d) => matrixAt(d.x, DRONE_HEIGHT, d.z)), { dynamic: animate });
  const shardMeshes = instance("Shard", shards.map((s) => matrixAt(s.x, SHARD_HEIGHT, s.z)), { dynamic: animate });
  const cubeMeshes = instance("Cube", FLOATING_CUBES.map((c) => matrixAt(c.x, c.baseY, c.y)), { dynamic: animate });

  // Buissons : socle instancié, roseaux en maillages séparés (celui du
  // joueur local devient translucide, et chacun n'est dessiné que s'il est
  // dans le champ : c'est la pièce la plus lourde du kit).
  instance("BushBase", BUSHES.map((b) => {
    const s = b.radius / BUSH_MODEL_RADIUS;
    return matrixAt(b.x, 0, b.y, 0, s, 1, s);
  }), { shadow: false });
  const reedsGeo = kit.geometry("BushReeds");
  const reeds = BUSHES.map((b, i) => {
    // Un matériau par buisson (même programme) : le fondu est le sien.
    const fade: THREE.IUniform = { value: 1 };
    const mesh = new THREE.Mesh(reedsGeo, reedsMaterial(v, time, fade, world.uniforms.uReedPush));
    const s = b.radius / BUSH_MODEL_RADIUS;
    mesh.position.set(b.x, 0, b.y);
    mesh.rotation.y = i * 2.1;
    mesh.scale.set(s, 1, s);
    mesh.castShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
    return { mesh, fade };
  });
  let insideBush = -1;
  let lastT = 0;

  const write = (meshes: THREE.InstancedMesh[], i: number, m: THREE.Matrix4) => {
    for (const mesh of meshes) mesh.setMatrixAt(i, m);
  };
  const flush = (meshes: THREE.InstancedMesh[]) => {
    for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
  };

  group.matrixAutoUpdate = false;
  return {
    group,
    update(t: number) {
      const dt = Math.min(0.1, Math.max(0, t - lastT));
      lastT = t;
      time.value = t;
      // Roseaux du joueur local : fondu vers la transparence, pour qu'il
      // se voie dedans.
      reeds.forEach((r, i) => {
        const target = i === insideBush ? 0.3 : 1;
        const cur = r.fade.value as number;
        if (cur === target) return;
        const next = cur + Math.sign(target - cur) * dt * 4;
        r.fade.value = target > cur ? Math.min(target, next) : Math.max(target, next);
      });
      if (!animate) return;
      drones.forEach((d, i) => {
        tmpM.compose(
          tmpP.set(d.x, DRONE_HEIGHT + Math.sin(t * 1.3 + d.phase) * 0.25, d.z),
          tmpQ.setFromAxisAngle(Y_AXIS, t * 0.4 + d.phase),
          tmpS.set(1, 1, 1),
        );
        write(droneMeshes, i, tmpM);
      });
      shards.forEach((s, i) => {
        tmpM.compose(
          tmpP.set(s.x, SHARD_HEIGHT + Math.sin(t * 0.9 + s.phase) * 0.3, s.z),
          tmpQ.setFromAxisAngle(Y_AXIS, t * 0.5 + s.phase),
          tmpS.set(1, 1, 1),
        );
        write(shardMeshes, i, tmpM);
      });
      FLOATING_CUBES.forEach((c, i) => {
        tmpM.compose(
          tmpP.set(c.x, c.baseY + Math.sin(t + c.phase) * 0.4, c.y),
          tmpQ.setFromEuler(tmpE.set(t * c.spin * 0.7, t * c.spin, 0)),
          tmpS.set(1, 1, 1),
        );
        write(cubeMeshes, i, tmpM);
      });
      flush(droneMeshes);
      flush(shardMeshes);
      flush(cubeMeshes);
    },
    setInsideBush(index: number) {
      insideBush = index;
    },
    // Rien ne clignote dans ce décor : le réglage des flashs n'a rien à y
    // atténuer.
    setFlashIntensity() {},
    bushBurstColor: v.bushAccent,
  };
}
