import * as THREE from "three";
import { BUSHES, DECOR_COLLIDERS, FLOATING_CUBES, GROUND_PADS } from "@bladeio/shared";
import { QualityConfig } from "../quality";

// Décors cyberpunk. Les obstacles (pilier central + obélisques) sont
// collidables serveur-side : positions définies dans @bladeio/shared et
// utilisées ici pour garantir que le visuel matche la collision.
//
// Optimisation perfo : les multiples obstacles partagent une seule
// InstancedMesh par "type" (cônes obélisques, cubes flottants), ce qui
// transforme N draw calls en 1 seul. Sur les GPU intégrés c'est le gain
// le plus notable (les draw calls coûtent cher en CPU/driver).
export function createDecor(q: QualityConfig): {
  group: THREE.Object3D;
  update: (t: number) => void;
} {
  const group = new THREE.Group();
  const disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  // Animation tracking : sur "minimal" on n'anime pas les cubes (économise
  // CPU + matrix uploads).
  const animateCubes = q.decorDetail !== "minimal";

  const mkBasic = (color: number) => new THREE.MeshBasicMaterial({ color });
  const mkEmissive = (color: number, intensity: number) =>
    q.simpleMaterials
      ? mkBasic(color)
      : new THREE.MeshStandardMaterial({
          color: 0x111122,
          emissive: color,
          emissiveIntensity: intensity,
          metalness: 0.4,
          roughness: 0.3,
        });

  const centralCol = DECOR_COLLIDERS[0];
  const obeliskCols = DECOR_COLLIDERS.slice(1);

  // Pilier central — segments réduits en low/ultra.
  const pillarSeg = q.simpleMaterials ? 8 : 12;
  const coreGeo = new THREE.CylinderGeometry(0.6, centralCol.radius, 6, pillarSeg);
  const coreMat = mkEmissive(0xff2ea8, 1.4);
  const corePillar = new THREE.Mesh(coreGeo, coreMat);
  corePillar.position.set(centralCol.x, 3, centralCol.y);
  corePillar.matrixAutoUpdate = false;
  corePillar.updateMatrix();
  group.add(corePillar);
  disposables.push(coreGeo, coreMat);

  // Halo torus : seulement si on a un peu de marge (rich/simple). Coupé en
  // minimal (ultra) — c'est purement décoratif.
  let halo: THREE.Mesh | null = null;
  if (q.decorDetail !== "minimal") {
    const haloSeg = q.decorDetail === "rich" ? 48 : 24;
    const haloGeo = new THREE.TorusGeometry(2.5, 0.12, 6, haloSeg);
    const haloMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
    halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.set(centralCol.x, 0.08, centralCol.y);
    halo.rotation.x = Math.PI / 2;
    group.add(halo);
    disposables.push(haloGeo, haloMat);
  }

  // Obélisques : InstancedMesh avec une seule géométrie partagée. On utilise
  // une géométrie "moyenne" (radius=1) puis on scale par instance pour
  // matcher le vrai radius du collider. Évite N géométries différentes (ce
  // qui empêcherait l'instancing).
  const obSeg = q.simpleMaterials ? 5 : 6;
  const obeliskGeo = new THREE.ConeGeometry(1, 5, obSeg);
  disposables.push(obeliskGeo);
  // Deux raretés visuelles : inner (cyan) et outer (purple). On crée 2
  // InstancedMesh — un par couleur — au lieu de 28 mesh individuels.
  const obMatInner = mkEmissive(0x00e5ff, 0.9);
  const obMatOuter = mkEmissive(0xb14bff, 0.9);
  disposables.push(obMatInner, obMatOuter);
  const innerCount = Math.min(10, obeliskCols.length);
  const outerCount = obeliskCols.length - innerCount;
  const innerMesh = new THREE.InstancedMesh(obeliskGeo, obMatInner, Math.max(1, innerCount));
  const outerMesh = new THREE.InstancedMesh(obeliskGeo, obMatOuter, Math.max(1, outerCount));
  innerMesh.count = innerCount;
  outerMesh.count = outerCount;
  // Décor statique : pas besoin de DynamicDrawUsage.
  const tmpMat = new THREE.Matrix4();
  const tmpQuat = new THREE.Quaternion();
  const tmpScale = new THREE.Vector3();
  const tmpPos = new THREE.Vector3();
  const tmpEuler = new THREE.Euler();
  let iIn = 0;
  let iOut = 0;
  for (let i = 0; i < obeliskCols.length; i++) {
    const col = obeliskCols[i];
    const isInner = i < innerCount;
    tmpPos.set(col.x, 2.5 + (isInner ? 0 : 0.5), col.y);
    tmpEuler.set(0, (i * 0.7) % (Math.PI * 2), 0);
    tmpQuat.setFromEuler(tmpEuler);
    // Scale x/z = collider radius pour matcher la collision visuelle.
    tmpScale.set(col.radius, 1, col.radius);
    tmpMat.compose(tmpPos, tmpQuat, tmpScale);
    if (isInner) innerMesh.setMatrixAt(iIn++, tmpMat);
    else outerMesh.setMatrixAt(iOut++, tmpMat);
  }
  innerMesh.instanceMatrix.needsUpdate = true;
  outerMesh.instanceMatrix.needsUpdate = true;
  innerMesh.matrixAutoUpdate = false;
  outerMesh.matrixAutoUpdate = false;
  group.add(innerMesh);
  group.add(outerMesh);

  // Pads glowing au sol (non-collidables). Coupés en minimal et low pour
  // gagner 10 draw calls.
  if (q.decorDetail === "rich") {
    const padGeo = new THREE.CircleGeometry(2.2, 16);
    const padMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
    });
    disposables.push(padGeo, padMat);
    // Un seul InstancedMesh pour les 10 pads.
    const padMesh = new THREE.InstancedMesh(padGeo, padMat, GROUND_PADS.length);
    for (let i = 0; i < GROUND_PADS.length; i++) {
      const pad = GROUND_PADS[i];
      tmpPos.set(pad.x, 0.04, pad.y);
      tmpEuler.set(-Math.PI / 2, 0, 0);
      tmpQuat.setFromEuler(tmpEuler);
      tmpScale.set(1, 1, 1);
      tmpMat.compose(tmpPos, tmpQuat, tmpScale);
      padMesh.setMatrixAt(i, tmpMat);
    }
    padMesh.instanceMatrix.needsUpdate = true;
    padMesh.matrixAutoUpdate = false;
    group.add(padMesh);
  }

  // Anneaux concentriques : repères visuels. Coupés en minimal/simple ;
  // gardés en rich avec moins de segments.
  if (q.decorDetail === "rich") {
    const ringSeg = 64;
    for (const r of [50, 100, 180]) {
      const rg = new THREE.RingGeometry(r - 0.2, r + 0.2, ringSeg);
      const rm = new THREE.MeshBasicMaterial({
        color: 0xff2ea8,
        transparent: true,
        opacity: 0.1,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(rg, rm);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      ring.matrixAutoUpdate = false;
      ring.updateMatrix();
      group.add(ring);
      disposables.push(rg, rm);
    }
  }

  // Buissons : zones de cachette. En "rich", on a tronc + 5 sphères par
  // bush. En "simple"/"minimal", juste le tronc (la zone reste lisible et
  // le gameplay identique). Géométries partagées entre tous les bushes.
  const bushFolMat = new THREE.MeshBasicMaterial({
    color: 0x1a4d2e,
    transparent: true,
    opacity: 0.85,
  });
  disposables.push(bushFolMat);

  if (BUSHES.length > 0) {
    const trunkSeg = q.simpleMaterials ? 8 : 12;
    // Géométrie tronc partagée — radius=1, scale par instance pour matcher
    // le vrai radius du buisson.
    const trunkGeo = new THREE.CylinderGeometry(0.95, 1, 2.4, trunkSeg);
    disposables.push(trunkGeo);
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, bushFolMat, BUSHES.length);
    for (let i = 0; i < BUSHES.length; i++) {
      const b = BUSHES[i];
      tmpPos.set(b.x, 1.2, b.y);
      tmpEuler.set(0, 0, 0);
      tmpQuat.setFromEuler(tmpEuler);
      tmpScale.set(b.radius, 1, b.radius);
      tmpMat.compose(tmpPos, tmpQuat, tmpScale);
      trunkMesh.setMatrixAt(i, tmpMat);
    }
    trunkMesh.instanceMatrix.needsUpdate = true;
    trunkMesh.matrixAutoUpdate = false;
    group.add(trunkMesh);

    // Sphères accent : seulement en rich. Sinon le tronc seul fait le
    // travail (zone de cachette toujours lisible).
    if (q.decorDetail === "rich") {
      const bushAccentMat = new THREE.MeshBasicMaterial({
        color: 0x4ad277,
        transparent: true,
        opacity: 0.55,
      });
      disposables.push(bushAccentMat);
      const sphGeo = new THREE.SphereGeometry(1, 8, 6);
      disposables.push(sphGeo);
      const totalSph = BUSHES.length * 5;
      const sphMesh = new THREE.InstancedMesh(sphGeo, bushAccentMat, totalSph);
      let si = 0;
      for (const b of BUSHES) {
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          const r = b.radius * 0.6;
          const sx = b.x + Math.cos(a) * r;
          const sy = b.y + Math.sin(a) * r;
          tmpPos.set(sx, 1.6 + (i % 2) * 0.4, sy);
          tmpEuler.set(0, 0, 0);
          tmpQuat.setFromEuler(tmpEuler);
          const rad = b.radius * 0.65;
          tmpScale.set(rad, rad * 0.7, rad);
          tmpMat.compose(tmpPos, tmpQuat, tmpScale);
          sphMesh.setMatrixAt(si++, tmpMat);
        }
      }
      sphMesh.instanceMatrix.needsUpdate = true;
      sphMesh.matrixAutoUpdate = false;
      group.add(sphMesh);
    }
  }

  // Cubes flottants (purement déco). Animés en rich/simple, statiques en
  // minimal. Toujours InstancedMesh.
  let cubeMesh: THREE.InstancedMesh | null = null;
  let cubesData: Array<{ baseY: number; phase: number; spin: number; x: number; y: number }> = [];
  if (q.decorDetail !== "minimal") {
    const cubeGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const cubeMat = mkEmissive(0xff2ea8, 1.2);
    disposables.push(cubeGeo, cubeMat);
    cubeMesh = new THREE.InstancedMesh(cubeGeo, cubeMat, FLOATING_CUBES.length);
    for (let i = 0; i < FLOATING_CUBES.length; i++) {
      const c = FLOATING_CUBES[i];
      cubesData.push({ baseY: c.baseY, phase: c.phase, spin: c.spin, x: c.x, y: c.y });
      tmpPos.set(c.x, c.baseY, c.y);
      tmpEuler.set(0, 0, 0);
      tmpQuat.setFromEuler(tmpEuler);
      tmpScale.set(1, 1, 1);
      tmpMat.compose(tmpPos, tmpQuat, tmpScale);
      cubeMesh.setMatrixAt(i, tmpMat);
    }
    cubeMesh.instanceMatrix.needsUpdate = true;
    if (animateCubes) {
      cubeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    group.add(cubeMesh);
  }

  // Pré-allocations pour update() — pas d'allocation par frame.
  const updPos = new THREE.Vector3();
  const updEuler = new THREE.Euler();
  const updQuat = new THREE.Quaternion();
  const updScale = new THREE.Vector3(1, 1, 1);
  const updMat = new THREE.Matrix4();

  return {
    group,
    update(t: number) {
      if (halo) halo.rotation.z = t * 0.2;
      if (cubeMesh && animateCubes) {
        for (let i = 0; i < cubesData.length; i++) {
          const c = cubesData[i];
          const ry = t * c.spin;
          const rx = t * c.spin * 0.7;
          updPos.set(c.x, c.baseY + Math.sin(t + c.phase) * 0.4, c.y);
          updEuler.set(rx, ry, 0);
          updQuat.setFromEuler(updEuler);
          updMat.compose(updPos, updQuat, updScale);
          cubeMesh.setMatrixAt(i, updMat);
        }
        cubeMesh.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
