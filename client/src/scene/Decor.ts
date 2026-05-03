import * as THREE from "three";
import { BUSHES, DECOR_COLLIDERS, FLOATING_CUBES, GROUND_PADS } from "@bladeio/shared";
import { QualityConfig } from "../quality";
import { getActiveTheme, DecorVariant } from "../themes";

// ─────────────────────────────────────────────────────────────────────────────
// Decor — dispatcher entre les variantes cyber et spirit.
//
// Les positions des obstacles (centralCol, obélisques, BUSHES, FLOATING_CUBES)
// sont définies dans @bladeio/shared et identiques entre tous les thèmes —
// seul leur visuel change. Garantit l'équité gameplay (un joueur qui possède
// le thème spirit ne voit pas une map différente d'un joueur en thème neon).
// ─────────────────────────────────────────────────────────────────────────────

export function createDecor(q: QualityConfig): {
  group: THREE.Object3D;
  update: (t: number) => void;
} {
  const theme = getActiveTheme();
  if (theme.decor.kind === "cyber") {
    return createCyberDecor(q, theme.decor);
  }
  return createSpiritDecor(q, theme.decor);
}

// ─────────────────────────────────────────────────────────────────────────────
// CYBER VARIANT — décor néon original (cubes flottants pink, obélisques
// cyan/purple, bushes verts).
// ─────────────────────────────────────────────────────────────────────────────
function createCyberDecor(
  q: QualityConfig,
  v: Extract<DecorVariant, { kind: "cyber" }>,
): { group: THREE.Object3D; update: (t: number) => void } {
  const group = new THREE.Group();
  const disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
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
  const coreMat = mkEmissive(v.shrineCore, 1.4);
  const corePillar = new THREE.Mesh(coreGeo, coreMat);
  corePillar.position.set(centralCol.x, 3, centralCol.y);
  corePillar.matrixAutoUpdate = false;
  corePillar.updateMatrix();
  group.add(corePillar);
  disposables.push(coreGeo, coreMat);

  let halo: THREE.Mesh | null = null;
  if (q.decorDetail !== "minimal") {
    const haloSeg = q.decorDetail === "rich" ? 48 : 24;
    const haloGeo = new THREE.TorusGeometry(2.5, 0.12, 6, haloSeg);
    const haloMat = new THREE.MeshBasicMaterial({ color: v.shrineHalo });
    halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.set(centralCol.x, 0.08, centralCol.y);
    halo.rotation.x = Math.PI / 2;
    group.add(halo);
    disposables.push(haloGeo, haloMat);
  }

  // Obélisques : 2 InstancedMesh (inner cyan + outer purple).
  const obSeg = q.simpleMaterials ? 5 : 6;
  const obeliskGeo = new THREE.ConeGeometry(1, 5, obSeg);
  disposables.push(obeliskGeo);
  const obMatInner = mkEmissive(v.obeliskInner, 0.9);
  const obMatOuter = mkEmissive(v.obeliskOuter, 0.9);
  disposables.push(obMatInner, obMatOuter);
  const innerCount = Math.min(10, obeliskCols.length);
  const outerCount = obeliskCols.length - innerCount;
  const innerMesh = new THREE.InstancedMesh(obeliskGeo, obMatInner, Math.max(1, innerCount));
  const outerMesh = new THREE.InstancedMesh(obeliskGeo, obMatOuter, Math.max(1, outerCount));
  innerMesh.count = innerCount;
  outerMesh.count = outerCount;
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

  // Pads glowing au sol (rich seulement).
  if (q.decorDetail === "rich") {
    const padGeo = new THREE.CircleGeometry(2.2, 16);
    const padMat = new THREE.MeshBasicMaterial({
      color: v.groundPad,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
    });
    disposables.push(padGeo, padMat);
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

  // Anneaux concentriques (rich seulement).
  if (q.decorDetail === "rich") {
    const ringSeg = 64;
    for (const r of [50, 100, 180]) {
      const rg = new THREE.RingGeometry(r - 0.2, r + 0.2, ringSeg);
      const rm = new THREE.MeshBasicMaterial({
        color: v.ringHint,
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

  // Bushes : tronc + 5 sphères accent (rich).
  const bushFolMat = new THREE.MeshBasicMaterial({
    color: v.bushFoliage,
    transparent: true,
    opacity: 0.85,
  });
  disposables.push(bushFolMat);
  if (BUSHES.length > 0) {
    const trunkSeg = q.simpleMaterials ? 8 : 12;
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

    if (q.decorDetail === "rich") {
      const bushAccentMat = new THREE.MeshBasicMaterial({
        color: v.bushAccent,
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

  // Cubes flottants néon — animation rotation + bob.
  let cubeMesh: THREE.InstancedMesh | null = null;
  let cubesData: Array<{ baseY: number; phase: number; spin: number; x: number; y: number }> = [];
  if (q.decorDetail !== "minimal") {
    const cubeGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const cubeMat = mkEmissive(v.cubeColor, 1.2);
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
    if (animateCubes) cubeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(cubeMesh);
  }

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

// ─────────────────────────────────────────────────────────────────────────────
// SPIRIT VARIANT — sanctuaire doré, lanternes 3 couches, bosquets de
// champignons + mousse.
// ─────────────────────────────────────────────────────────────────────────────
function createSpiritDecor(
  q: QualityConfig,
  v: Extract<DecorVariant, { kind: "spirit" }>,
): { group: THREE.Object3D; update: (t: number) => void } {
  const group = new THREE.Group();
  const disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  const animateCubes = q.decorDetail !== "minimal";

  const mkBasic = (color: number) => new THREE.MeshBasicMaterial({ color });
  const mkEmissive = (color: number, intensity: number) =>
    q.simpleMaterials
      ? mkBasic(color)
      : new THREE.MeshStandardMaterial({
          color: 0x1a0f2e,
          emissive: color,
          emissiveIntensity: intensity,
          metalness: 0.2,
          roughness: 0.6,
        });

  const centralCol = DECOR_COLLIDERS[0];
  const obeliskCols = DECOR_COLLIDERS.slice(1);

  const pillarSeg = q.simpleMaterials ? 8 : 12;
  const coreGeo = new THREE.CylinderGeometry(0.6, centralCol.radius, 6, pillarSeg);
  const coreMat = mkEmissive(v.shrineCore, 1.2);
  const corePillar = new THREE.Mesh(coreGeo, coreMat);
  corePillar.position.set(centralCol.x, 3, centralCol.y);
  corePillar.matrixAutoUpdate = false;
  corePillar.updateMatrix();
  group.add(corePillar);
  disposables.push(coreGeo, coreMat);

  let halo: THREE.Mesh | null = null;
  if (q.decorDetail !== "minimal") {
    const haloSeg = q.decorDetail === "rich" ? 48 : 24;
    const haloGeo = new THREE.TorusGeometry(2.5, 0.12, 6, haloSeg);
    const haloMat = new THREE.MeshBasicMaterial({ color: v.shrineHalo });
    halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.set(centralCol.x, 0.08, centralCol.y);
    halo.rotation.x = Math.PI / 2;
    group.add(halo);
    disposables.push(haloGeo, haloMat);
  }

  // Pierres dressées (obélisques mauves dans la variante spirit).
  const obSeg = q.simpleMaterials ? 5 : 6;
  const obeliskGeo = new THREE.ConeGeometry(1, 5, obSeg);
  disposables.push(obeliskGeo);
  const obMatInner = mkEmissive(v.obeliskInner, 0.85);
  const obMatOuter = mkEmissive(v.obeliskOuter, 0.95);
  disposables.push(obMatInner, obMatOuter);
  const innerCount = Math.min(10, obeliskCols.length);
  const outerCount = obeliskCols.length - innerCount;
  const innerMesh = new THREE.InstancedMesh(obeliskGeo, obMatInner, Math.max(1, innerCount));
  const outerMesh = new THREE.InstancedMesh(obeliskGeo, obMatOuter, Math.max(1, outerCount));
  innerMesh.count = innerCount;
  outerMesh.count = outerCount;
  const tmpMat = new THREE.Matrix4();
  const tmpQuat = new THREE.Quaternion();
  const tmpScale = new THREE.Vector3();
  const tmpPos = new THREE.Vector3();
  const tmpEuler = new THREE.Euler();
  let iIn = 0, iOut = 0;
  for (let i = 0; i < obeliskCols.length; i++) {
    const col = obeliskCols[i];
    const isInner = i < innerCount;
    tmpPos.set(col.x, 2.5 + (isInner ? 0 : 0.5), col.y);
    tmpEuler.set(0, (i * 0.7) % (Math.PI * 2), 0);
    tmpQuat.setFromEuler(tmpEuler);
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

  // Sceaux lumineux au sol (rich).
  if (q.decorDetail === "rich") {
    const padGeo = new THREE.CircleGeometry(2.2, 16);
    const padMat = new THREE.MeshBasicMaterial({
      color: v.groundPad,
      transparent: true,
      opacity: 0.13,
      side: THREE.DoubleSide,
    });
    disposables.push(padGeo, padMat);
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

  // Anneaux d'évocation rose poudré (rich).
  if (q.decorDetail === "rich") {
    const ringSeg = 64;
    for (const r of [50, 100, 180]) {
      const rg = new THREE.RingGeometry(r - 0.2, r + 0.2, ringSeg);
      const rm = new THREE.MeshBasicMaterial({
        color: v.ringHint,
        transparent: true,
        opacity: 0.09,
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

  // Bosquets de champignons : mousse + pieds + chapeaux + glow sous-chapeau.
  if (BUSHES.length > 0) {
    const hash01 = (seed: number): number => {
      let h = (seed | 0) + 0x6D2B79F5;
      h = Math.imul(h ^ (h >>> 15), h | 1);
      h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
      return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
    };
    const mushroomsPerBush =
      q.decorDetail === "rich" ? 5 :
      q.decorDetail === "simple" ? 3 : 2;
    const mossPerBush =
      q.decorDetail === "rich" ? 6 :
      q.decorDetail === "simple" ? 4 : 3;

    // Mousse au sol.
    const mossMat = new THREE.MeshBasicMaterial({
      color: v.mossColor,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    disposables.push(mossMat);
    const mossSeg = q.simpleMaterials ? 6 : 8;
    const mossGeo = new THREE.SphereGeometry(1, mossSeg, Math.max(4, mossSeg - 2));
    disposables.push(mossGeo);
    const mossMesh = new THREE.InstancedMesh(mossGeo, mossMat, BUSHES.length * mossPerBush);
    let mossIdx = 0;
    for (let bi = 0; bi < BUSHES.length; bi++) {
      const b = BUSHES[bi];
      for (let i = 0; i < mossPerBush; i++) {
        const seed = bi * 1009 + i * 31;
        const angle = hash01(seed) * Math.PI * 2;
        const radial = Math.sqrt(hash01(seed + 1)) * b.radius * 0.85;
        const sx = b.x + Math.cos(angle) * radial;
        const sz = b.y + Math.sin(angle) * radial;
        const sy = 0.3 + hash01(seed + 2) * 0.6;
        const horizR = b.radius * (0.4 + hash01(seed + 3) * 0.35);
        const vertR = horizR * (0.5 + hash01(seed + 4) * 0.2);
        tmpPos.set(sx, sy, sz);
        tmpEuler.set(0, hash01(seed + 5) * Math.PI, 0);
        tmpQuat.setFromEuler(tmpEuler);
        tmpScale.set(horizR, vertR, horizR);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        mossMesh.setMatrixAt(mossIdx++, tmpMat);
      }
    }
    mossMesh.instanceMatrix.needsUpdate = true;
    mossMesh.matrixAutoUpdate = false;
    mossMesh.renderOrder = 0;
    group.add(mossMesh);

    // Pieds + chapeaux + glows sous-chapeau.
    const stemSeg = q.simpleMaterials ? 6 : 8;
    const stemGeo = new THREE.CylinderGeometry(0.13, 0.18, 1.0, stemSeg);
    disposables.push(stemGeo);
    const stemMat = q.simpleMaterials
      ? new THREE.MeshBasicMaterial({ color: v.mushroomStem })
      : new THREE.MeshStandardMaterial({
          color: v.mushroomStem,
          emissive: 0x4a2f6e,
          emissiveIntensity: 0.15,
          roughness: 0.85,
          metalness: 0.0,
        });
    disposables.push(stemMat);
    const totalStems = BUSHES.length * mushroomsPerBush;
    const stemMesh = new THREE.InstancedMesh(stemGeo, stemMat, totalStems);

    const capSeg = q.simpleMaterials ? 8 : 12;
    const capGeo = new THREE.SphereGeometry(1, capSeg, Math.max(4, capSeg / 2));
    disposables.push(capGeo);
    const capMat = q.simpleMaterials
      ? new THREE.MeshBasicMaterial({ color: v.mushroomCap, transparent: true, opacity: 0.85 })
      : new THREE.MeshStandardMaterial({
          color: v.mushroomCap,
          emissive: v.shrineHalo,
          emissiveIntensity: 0.3,
          roughness: 0.6,
          metalness: 0.0,
          transparent: true,
          opacity: 0.92,
        });
    disposables.push(capMat);
    const capMesh = new THREE.InstancedMesh(capGeo, capMat, totalStems);

    const underglowMat = new THREE.MeshBasicMaterial({
      color: v.mushroomUnderglow,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    disposables.push(underglowMat);
    const underglowGeo = new THREE.CircleGeometry(0.55, 12);
    disposables.push(underglowGeo);
    const underglowMesh = new THREE.InstancedMesh(underglowGeo, underglowMat, totalStems);

    let ms = 0;
    for (let bi = 0; bi < BUSHES.length; bi++) {
      const b = BUSHES[bi];
      for (let i = 0; i < mushroomsPerBush; i++) {
        const seed = bi * 4099 + i * 71;
        const angle = hash01(seed) * Math.PI * 2;
        const radial = hash01(seed + 1) * b.radius * 0.65;
        const sx = b.x + Math.cos(angle) * radial;
        const sz = b.y + Math.sin(angle) * radial;
        const stemH = 1.2 + hash01(seed + 2) * 1.2;
        const stemThick = 0.9 + hash01(seed + 3) * 0.5;
        tmpPos.set(sx, stemH / 2, sz);
        tmpEuler.set(0, hash01(seed + 4) * Math.PI, 0);
        tmpQuat.setFromEuler(tmpEuler);
        tmpScale.set(stemThick, stemH, stemThick);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        stemMesh.setMatrixAt(ms, tmpMat);

        const capR = 0.5 + hash01(seed + 5) * 0.45;
        const capH = capR * 0.55;
        tmpPos.set(sx, stemH + capH * 0.5, sz);
        tmpEuler.set(0, hash01(seed + 6) * Math.PI, 0);
        tmpQuat.setFromEuler(tmpEuler);
        tmpScale.set(capR, capH, capR);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        capMesh.setMatrixAt(ms, tmpMat);

        tmpPos.set(sx, stemH - 0.02, sz);
        tmpEuler.set(Math.PI / 2, 0, 0);
        tmpQuat.setFromEuler(tmpEuler);
        const glowR = capR * 0.95;
        tmpScale.set(glowR, glowR, 1);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        underglowMesh.setMatrixAt(ms, tmpMat);

        ms++;
      }
    }
    stemMesh.instanceMatrix.needsUpdate = true;
    stemMesh.matrixAutoUpdate = false;
    capMesh.instanceMatrix.needsUpdate = true;
    capMesh.matrixAutoUpdate = false;
    underglowMesh.instanceMatrix.needsUpdate = true;
    underglowMesh.matrixAutoUpdate = false;
    underglowMesh.renderOrder = 1;
    group.add(stemMesh);
    group.add(capMesh);
    group.add(underglowMesh);
  }

  // Lanternes flottantes 3 couches.
  let lanternCoreMesh: THREE.InstancedMesh | null = null;
  let lanternCageMesh: THREE.InstancedMesh | null = null;
  let lanternHaloMesh: THREE.InstancedMesh | null = null;
  let cubesData: Array<{ baseY: number; phase: number; spin: number; x: number; y: number }> = [];

  if (q.decorDetail !== "minimal") {
    const lanternCount = FLOATING_CUBES.length;

    const coreGeo = new THREE.OctahedronGeometry(0.4, 0);
    const coreMat = q.simpleMaterials
      ? new THREE.MeshBasicMaterial({ color: v.lanternEmissive })
      : new THREE.MeshStandardMaterial({
          color: v.lanternCoreColor,
          emissive: v.lanternEmissive,
          emissiveIntensity: 1.6,
          metalness: 0.0,
          roughness: 0.4,
        });
    disposables.push(coreGeo, coreMat);
    lanternCoreMesh = new THREE.InstancedMesh(coreGeo, coreMat, lanternCount);

    const cageGeo = new THREE.TorusGeometry(0.55, 0.05, 4, 12);
    const cageMat = q.simpleMaterials
      ? new THREE.MeshBasicMaterial({ color: v.lanternCage })
      : new THREE.MeshStandardMaterial({
          color: v.lanternCage,
          emissive: v.lanternCage,
          emissiveIntensity: 1.2,
          metalness: 0.3,
          roughness: 0.5,
        });
    disposables.push(cageGeo, cageMat);
    lanternCageMesh = new THREE.InstancedMesh(cageGeo, cageMat, lanternCount);

    const haloGeo = new THREE.SphereGeometry(0.95, 10, 8);
    const haloMat = new THREE.MeshBasicMaterial({
      color: v.lanternHalo,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    });
    disposables.push(haloGeo, haloMat);
    lanternHaloMesh = new THREE.InstancedMesh(haloGeo, haloMat, lanternCount);

    for (let i = 0; i < lanternCount; i++) {
      const c = FLOATING_CUBES[i];
      cubesData.push({ baseY: c.baseY + 1.0, phase: c.phase, spin: c.spin, x: c.x, y: c.y });
      tmpPos.set(c.x, c.baseY + 1.0, c.y);
      tmpEuler.set(0, 0, 0);
      tmpQuat.setFromEuler(tmpEuler);
      const cageEuler = new THREE.Euler(Math.PI / 2, 0, 0);
      const cageQuat = new THREE.Quaternion().setFromEuler(cageEuler);
      tmpScale.set(1, 1, 1);
      tmpMat.compose(tmpPos, tmpQuat, tmpScale);
      lanternCoreMesh.setMatrixAt(i, tmpMat);
      lanternHaloMesh.setMatrixAt(i, tmpMat);
      tmpMat.compose(tmpPos, cageQuat, tmpScale);
      lanternCageMesh.setMatrixAt(i, tmpMat);
    }
    lanternCoreMesh.instanceMatrix.needsUpdate = true;
    lanternCageMesh.instanceMatrix.needsUpdate = true;
    lanternHaloMesh.instanceMatrix.needsUpdate = true;
    if (animateCubes) {
      lanternCoreMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      lanternCageMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      lanternHaloMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    lanternHaloMesh.renderOrder = 1;
    group.add(lanternCoreMesh);
    group.add(lanternCageMesh);
    group.add(lanternHaloMesh);
  }

  const updPos = new THREE.Vector3();
  const updEuler = new THREE.Euler();
  const updQuat = new THREE.Quaternion();
  const updScale = new THREE.Vector3(1, 1, 1);
  const updMat = new THREE.Matrix4();
  const cageEulerScratch = new THREE.Euler();
  const cageQuatScratch = new THREE.Quaternion();
  const haloScaleScratch = new THREE.Vector3(1, 1, 1);

  return {
    group,
    update(t: number) {
      if (halo) halo.rotation.z = t * 0.2;
      if (lanternCoreMesh && lanternCageMesh && lanternHaloMesh && animateCubes) {
        cageEulerScratch.set(Math.PI / 2, 0, 0);
        cageQuatScratch.setFromEuler(cageEulerScratch);
        for (let i = 0; i < cubesData.length; i++) {
          const c = cubesData[i];
          const bob = Math.sin(t * 0.7 + c.phase) * 0.4;
          const swayX = Math.cos(t * 0.4 + c.phase * 1.3) * 0.25;
          const swayZ = Math.sin(t * 0.45 + c.phase * 0.7) * 0.25;
          updPos.set(c.x + swayX, c.baseY + bob, c.y + swayZ);

          updEuler.set(0, t * 0.3 + c.phase, 0);
          updQuat.setFromEuler(updEuler);
          updMat.compose(updPos, updQuat, updScale);
          lanternCoreMesh.setMatrixAt(i, updMat);

          updMat.compose(updPos, cageQuatScratch, updScale);
          lanternCageMesh.setMatrixAt(i, updMat);

          const pulse = 1.0 + Math.sin(t * 1.2 + c.phase) * 0.08;
          haloScaleScratch.set(pulse, pulse, pulse);
          updEuler.set(0, 0, 0);
          updQuat.setFromEuler(updEuler);
          updMat.compose(updPos, updQuat, haloScaleScratch);
          lanternHaloMesh.setMatrixAt(i, updMat);
        }
        lanternCoreMesh.instanceMatrix.needsUpdate = true;
        lanternCageMesh.instanceMatrix.needsUpdate = true;
        lanternHaloMesh.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
