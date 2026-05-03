import * as THREE from "three";
import { BUSHES, DECOR_COLLIDERS, FLOATING_CUBES, GROUND_PADS } from "@bladeio/shared";
import { QualityConfig } from "../quality";
import { PALETTE } from "./palette";

// Décors "Sanctuaire des Esprits". Les obstacles (sanctuaire central + pierres
// dressées) sont collidables serveur-side : positions définies dans
// @bladeio/shared et utilisées ici pour garantir que le visuel matche la
// collision.
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
          // Pierre sombre violette : émerge du brouillard sans dominer.
          color: 0x1a0f2e,
          emissive: color,
          emissiveIntensity: intensity,
          metalness: 0.2,
          roughness: 0.6,
        });

  const centralCol = DECOR_COLLIDERS[0];
  const obeliskCols = DECOR_COLLIDERS.slice(1);

  // Sanctuaire central — pilier de pierre violet aux veines d'or sacré.
  const pillarSeg = q.simpleMaterials ? 8 : 12;
  const coreGeo = new THREE.CylinderGeometry(0.6, centralCol.radius, 6, pillarSeg);
  const coreMat = mkEmissive(PALETTE.sacredGold, 1.2);
  const corePillar = new THREE.Mesh(coreGeo, coreMat);
  corePillar.position.set(centralCol.x, 3, centralCol.y);
  corePillar.matrixAutoUpdate = false;
  corePillar.updateMatrix();
  group.add(corePillar);
  disposables.push(coreGeo, coreMat);

  // Cercle rituel au sol autour du sanctuaire — rose poudré, suggère un site
  // sacré. Coupé en minimal (ultra), purement décoratif.
  let halo: THREE.Mesh | null = null;
  if (q.decorDetail !== "minimal") {
    const haloSeg = q.decorDetail === "rich" ? 48 : 24;
    const haloGeo = new THREE.TorusGeometry(2.5, 0.12, 6, haloSeg);
    const haloMat = new THREE.MeshBasicMaterial({ color: PALETTE.shrineAccent });
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
  // Deux types de pierres dressées : inner (mauve / champignon mint pour
  // marquer les pierres proches du centre) et outer (violet profond pour
  // l'extérieur). 2 InstancedMesh — 1 par couleur — au lieu de 28 mesh.
  const obMatInner = mkEmissive(PALETTE.mushroomGlow, 0.85);
  const obMatOuter = mkEmissive(PALETTE.shrinePrimary, 0.95);
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

  // Sceaux lumineux au sol (non-collidables). Coupés en minimal et low.
  if (q.decorDetail === "rich") {
    const padGeo = new THREE.CircleGeometry(2.2, 16);
    const padMat = new THREE.MeshBasicMaterial({
      color: PALETTE.mushroomGlow,
      transparent: true,
      opacity: 0.13,
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

  // Anneaux concentriques : repères visuels (cercles d'évocation). Rose
  // poudré, presque imperceptibles, pour marquer la distance sans surcharger.
  if (q.decorDetail === "rich") {
    const ringSeg = 64;
    for (const r of [50, 100, 180]) {
      const rg = new THREE.RingGeometry(r - 0.2, r + 0.2, ringSeg);
      const rm = new THREE.MeshBasicMaterial({
        color: PALETTE.shrineAccent,
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

  // Bosquets de champignons spirit-world : zones de cachette. Chaque bosquet
  // = grappe de champignons (pied + chapeau + glow sous-chapeau) plantés sur
  // un tapis de mousse au sol. Les champignons donnent la silhouette
  // verticale claire qui manquait à la grappe de sphères ; la mousse au sol
  // assure la lecture "zone de cachette dense". Positions générées de
  // manière déterministe (seed = index bush) pour que tous les clients
  // voient la même forme.
  //
  // 4 InstancedMesh : mousse + pieds + chapeaux + glows sous-chapeau.

  if (BUSHES.length > 0) {
    // Hash déterministe (Mulberry32-like) — float [0,1) reproductible.
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

    // ─── COUCHE 1 : Mousse au sol (sphères translucides aplaties) ───
    // Couvre les "trous" entre les pieds des champignons et donne la
    // lecture "tapis dense" pour la cachette. Hauteur < 1.0.
    const mossMat = new THREE.MeshBasicMaterial({
      color: PALETTE.groveFoliage,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    disposables.push(mossMat);
    const mossSeg = q.simpleMaterials ? 6 : 8;
    const mossGeo = new THREE.SphereGeometry(1, mossSeg, Math.max(4, mossSeg - 2));
    disposables.push(mossGeo);
    const totalMoss = BUSHES.length * mossPerBush;
    const mossMesh = new THREE.InstancedMesh(mossGeo, mossMat, totalMoss);
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

    // ─── COUCHE 2 : Pieds des champignons (cylindre conique opaque) ───
    const stemSeg = q.simpleMaterials ? 6 : 8;
    const stemGeo = new THREE.CylinderGeometry(0.13, 0.18, 1.0, stemSeg);
    disposables.push(stemGeo);
    const stemMat = q.simpleMaterials
      ? new THREE.MeshBasicMaterial({ color: 0xe8d4f0 })
      : new THREE.MeshStandardMaterial({
          color: 0xe8d4f0,        // crème rosée pâle
          emissive: 0x4a2f6e,     // ombre mauve dans les creux du shading
          emissiveIntensity: 0.15,
          roughness: 0.85,
          metalness: 0.0,
        });
    disposables.push(stemMat);
    const totalStems = BUSHES.length * mushroomsPerBush;
    const stemMesh = new THREE.InstancedMesh(stemGeo, stemMat, totalStems);

    // ─── COUCHE 3 : Chapeaux (hémisphère aplatie, translucide rose-violet) ───
    const capSeg = q.simpleMaterials ? 8 : 12;
    const capGeo = new THREE.SphereGeometry(1, capSeg, Math.max(4, capSeg / 2));
    disposables.push(capGeo);
    const capMat = q.simpleMaterials
      ? new THREE.MeshBasicMaterial({
          color: PALETTE.groveAccent,
          transparent: true,
          opacity: 0.85,
        })
      : new THREE.MeshStandardMaterial({
          color: PALETTE.groveAccent,
          emissive: PALETTE.shrineAccent,
          emissiveIntensity: 0.3,
          roughness: 0.6,
          metalness: 0.0,
          transparent: true,
          opacity: 0.92,
        });
    disposables.push(capMat);
    const capMesh = new THREE.InstancedMesh(capGeo, capMat, totalStems);

    // ─── COUCHE 4 : Glow sous-chapeau (signature champignon féérique) ───
    // Disque additif rose vif sous chaque chapeau — détail qui transforme
    // "champignon" en "champignon enchanté".
    const underglowMat = new THREE.MeshBasicMaterial({
      color: 0xffb4e0,
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
        // Position dans le bush — concentré vers le centre (0..0.65 × radius)
        // pour laisser la mousse déborder à la périphérie.
        const angle = hash01(seed) * Math.PI * 2;
        const radial = hash01(seed + 1) * b.radius * 0.65;
        const sx = b.x + Math.cos(angle) * radial;
        const sz = b.y + Math.sin(angle) * radial;
        // Hauteur du pied : 1.2 à 2.4 pour variation. Position Y du
        // cylindre = sa moitié-hauteur (centre).
        const stemH = 1.2 + hash01(seed + 2) * 1.2;
        const stemThick = 0.9 + hash01(seed + 3) * 0.5;
        tmpPos.set(sx, stemH / 2, sz);
        tmpEuler.set(0, hash01(seed + 4) * Math.PI, 0);
        tmpQuat.setFromEuler(tmpEuler);
        tmpScale.set(stemThick, stemH, stemThick);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        stemMesh.setMatrixAt(ms, tmpMat);

        // Chapeau : posé sur le pied (à stemH), aplati. Tailles variées.
        const capR = 0.5 + hash01(seed + 5) * 0.45;
        const capH = capR * 0.55; // chapeau aplati
        tmpPos.set(sx, stemH + capH * 0.5, sz);
        tmpEuler.set(0, hash01(seed + 6) * Math.PI, 0);
        tmpQuat.setFromEuler(tmpEuler);
        tmpScale.set(capR, capH, capR);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        capMesh.setMatrixAt(ms, tmpMat);

        // Glow sous le chapeau : disque face vers le bas, juste sous
        // l'underside du chapeau.
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

  // Lanternes d'âmes flottantes — 3 couches superposées pour qu'elles lisent
  // comme un "objet" et pas comme un blob de bloom :
  //   1. Cœur : octaèdre opaque doré → silhouette angulaire reconnaissable
  //      (les arêtes restent visibles malgré le bloom, contrairement à une
  //      sphère qui se dissout en boule de lumière).
  //   2. Cage : torus équatorial doré → souligne la structure "objet
  //      manufacturé" plutôt qu'orbe magique amorphe.
  //   3. Halo : sphère translucide enveloppante → soft falloff ambiant.
  // Les 3 utilisent InstancedMesh distincts (3 draw calls), driven par les
  // mêmes données dans cubesData → une seule update().
  let lanternCoreMesh: THREE.InstancedMesh | null = null;
  let lanternCageMesh: THREE.InstancedMesh | null = null;
  let lanternHaloMesh: THREE.InstancedMesh | null = null;
  let cubesData: Array<{ baseY: number; phase: number; spin: number; x: number; y: number }> = [];

  if (q.decorDetail !== "minimal") {
    const lanternCount = FLOATING_CUBES.length;

    // -- COUCHE 1 : cœur octaédrique opaque émissif --
    const coreGeo = new THREE.OctahedronGeometry(0.4, 0);
    const coreMat = q.simpleMaterials
      ? new THREE.MeshBasicMaterial({ color: PALETTE.sacredGold })
      : new THREE.MeshStandardMaterial({
          color: 0xfff2c4,        // crème quasi-blanche pour suggérer la flamme
          emissive: PALETTE.sacredGold,
          emissiveIntensity: 1.6,
          metalness: 0.0,
          roughness: 0.4,
        });
    disposables.push(coreGeo, coreMat);
    lanternCoreMesh = new THREE.InstancedMesh(coreGeo, coreMat, lanternCount);

    // -- COUCHE 2 : cage équatoriale (torus fin doré, opaque) --
    // Lit comme une "ceinture" de lanterne. Tube radial low (4) suffit
    // car le bloom comble les facettes.
    const cageGeo = new THREE.TorusGeometry(0.55, 0.05, 4, 12);
    const cageMat = q.simpleMaterials
      ? new THREE.MeshBasicMaterial({ color: PALETTE.sacredGold })
      : new THREE.MeshStandardMaterial({
          color: PALETTE.sacredGold,
          emissive: PALETTE.sacredGold,
          emissiveIntensity: 1.2,
          metalness: 0.3,
          roughness: 0.5,
        });
    disposables.push(cageGeo, cageMat);
    lanternCageMesh = new THREE.InstancedMesh(cageGeo, cageMat, lanternCount);

    // -- COUCHE 3 : halo enveloppant translucide --
    const haloGeo = new THREE.SphereGeometry(0.95, 10, 8);
    const haloMat = new THREE.MeshBasicMaterial({
      color: PALETTE.sacredGold,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide, // intérieur vu de l'extérieur → falloff naturel
    });
    disposables.push(haloGeo, haloMat);
    lanternHaloMesh = new THREE.InstancedMesh(haloGeo, haloMat, lanternCount);

    // Position initiale : on écrit les 3 meshes en parallèle.
    for (let i = 0; i < lanternCount; i++) {
      const c = FLOATING_CUBES[i];
      // Lanternes plus hautes que les cubes (au-dessus de la portée des
      // lames) : visuellement détachées de la zone de combat.
      cubesData.push({ baseY: c.baseY + 1.0, phase: c.phase, spin: c.spin, x: c.x, y: c.y });
      tmpPos.set(c.x, c.baseY + 1.0, c.y);
      tmpEuler.set(0, 0, 0);
      tmpQuat.setFromEuler(tmpEuler);
      // Cage : tournée pour que l'anneau soit ~horizontal (vue plongée
      // de la caméra → ça lit "ceinture").
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
    // Rendre le halo APRÈS le core/cage pour que la transparence overlay
    // correctement (renderOrder est suffisant ici, on n'a pas besoin de
    // sorter par instance).
    lanternHaloMesh.renderOrder = 1;
    group.add(lanternCoreMesh);
    group.add(lanternCageMesh);
    group.add(lanternHaloMesh);
  }

  // Pré-allocations pour update() — pas d'allocation par frame.
  const updPos = new THREE.Vector3();
  const updEuler = new THREE.Euler();
  const updQuat = new THREE.Quaternion();
  const updScale = new THREE.Vector3(1, 1, 1);
  const updMat = new THREE.Matrix4();
  // Scratchpads pour les lanternes (cage orientation + halo scale pulsé).
  const cageEulerScratch = new THREE.Euler();
  const cageQuatScratch = new THREE.Quaternion();
  const haloScaleScratch = new THREE.Vector3(1, 1, 1);

  return {
    group,
    update(t: number) {
      if (halo) halo.rotation.z = t * 0.2;
      if (lanternCoreMesh && lanternCageMesh && lanternHaloMesh && animateCubes) {
        // Lanternes : bob vertical + sway horizontal (courant aérien) + une
        // rotation lente du cœur octaédrique sur Y (les facettes scintillent
        // sous la lumière mauve ambient). Cage + halo restent fixes en
        // rotation : c'est juste le cœur qui tourne.
        // Pré-alloués hors boucle pour 0 GC pressure.
        cageEulerScratch.set(Math.PI / 2, 0, 0);
        cageQuatScratch.setFromEuler(cageEulerScratch);
        for (let i = 0; i < cubesData.length; i++) {
          const c = cubesData[i];
          const bob = Math.sin(t * 0.7 + c.phase) * 0.4;
          const swayX = Math.cos(t * 0.4 + c.phase * 1.3) * 0.25;
          const swayZ = Math.sin(t * 0.45 + c.phase * 0.7) * 0.25;
          updPos.set(c.x + swayX, c.baseY + bob, c.y + swayZ);

          // Cœur : rotation lente sur Y pour faire scintiller les facettes.
          updEuler.set(0, t * 0.3 + c.phase, 0);
          updQuat.setFromEuler(updEuler);
          updMat.compose(updPos, updQuat, updScale);
          lanternCoreMesh.setMatrixAt(i, updMat);

          // Cage : orientation fixe (équatoriale horizontale).
          updMat.compose(updPos, cageQuatScratch, updScale);
          lanternCageMesh.setMatrixAt(i, updMat);

          // Halo : pas de rotation, pulsation lente du scale pour suggérer
          // la "respiration" lumineuse.
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
