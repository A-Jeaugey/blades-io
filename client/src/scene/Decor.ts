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

  // Bosquets de brume éthérée : zones de cachette. Plus de tronc cylindrique
  // (qui faisait Lego) — à la place une grappe désordonnée de petites sphères
  // translucides mauves + 2-3 points lumineux mint/rose pour suggérer la vie
  // intérieure du bosquet. Positions générées de manière déterministe (seed
  // basé sur l'index du bush) pour que tous les clients voient la même forme.
  //
  // Single InstancedMesh par couche (foliage + glow accents) → 2 draw calls
  // au total quel que soit le nombre de bushes.
  const bushFolMat = new THREE.MeshBasicMaterial({
    color: PALETTE.groveFoliage,
    transparent: true,
    opacity: 0.72,
    depthWrite: false, // évite le z-fighting entre sphères qui se chevauchent
  });
  disposables.push(bushFolMat);

  if (BUSHES.length > 0) {
    // Hash déterministe (Mulberry32-like) — donne un float [0,1) reproductible
    // depuis un seed entier. Utilisé pour placer les sphères de manière
    // pseudo-aléatoire mais identique entre clients.
    const hash01 = (seed: number): number => {
      let h = (seed | 0) + 0x6D2B79F5;
      h = Math.imul(h ^ (h >>> 15), h | 1);
      h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
      return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
    };

    // Densité du bosquet selon le preset : rich = 14 sphères, simple = 8,
    // minimal = 5. Sous 5, on perd la lecture "bosquet" et ça devient juste
    // 3 sphères visibles.
    const spheresPerBush =
      q.decorDetail === "rich" ? 14 :
      q.decorDetail === "simple" ? 8 : 5;

    const sphSeg = q.simpleMaterials ? 6 : 8;
    const sphGeo = new THREE.SphereGeometry(1, sphSeg, Math.max(4, sphSeg - 2));
    disposables.push(sphGeo);

    const totalSph = BUSHES.length * spheresPerBush;
    const sphMesh = new THREE.InstancedMesh(sphGeo, bushFolMat, totalSph);

    let si = 0;
    for (let bi = 0; bi < BUSHES.length; bi++) {
      const b = BUSHES[bi];
      for (let i = 0; i < spheresPerBush; i++) {
        const seed = bi * 1009 + i * 31;
        // Position dans le disque d'influence du bush. sqrt(rand) pour
        // distribution uniforme dans le cercle (sinon trop concentré au
        // centre). Limite à 0.85 du rayon collision pour que les sphères
        // débordent un peu sans cacher visuellement la limite.
        const angle = hash01(seed) * Math.PI * 2;
        const radial = Math.sqrt(hash01(seed + 1)) * b.radius * 0.85;
        const sx = b.x + Math.cos(angle) * radial;
        const sz = b.y + Math.sin(angle) * radial;
        // Distribution verticale : plus dense au milieu (1.2-2.0), quelques
        // sphères en bas (0.6) et en haut (2.6) pour casser la silhouette
        // dôme uniforme.
        const heightT = hash01(seed + 2);
        const sy = 0.6 + heightT * heightT * 2.0; // bias vers le bas
        // Taille variée : petites sphères qui se chevauchent (0.35 à 0.65 ×
        // bush radius) — créent une masse organique au lieu de boules
        // distinctes.
        const sphR = b.radius * (0.35 + hash01(seed + 3) * 0.30);

        tmpPos.set(sx, sy, sz);
        tmpEuler.set(
          hash01(seed + 4) * Math.PI,
          hash01(seed + 5) * Math.PI,
          hash01(seed + 6) * Math.PI,
        );
        tmpQuat.setFromEuler(tmpEuler);
        tmpScale.set(sphR, sphR * (0.85 + hash01(seed + 7) * 0.3), sphR);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        sphMesh.setMatrixAt(si++, tmpMat);
      }
    }
    sphMesh.instanceMatrix.needsUpdate = true;
    sphMesh.matrixAutoUpdate = false;
    sphMesh.renderOrder = 0; // foliage drawn first
    group.add(sphMesh);

    // Points lumineux à l'intérieur du bosquet : 2 par bush en rich, 1 en
    // simple, 0 en minimal. Suggère "il y a de la vie là-dedans" (luciole,
    // esprit qui s'y cache) sans révéler les joueurs.
    const glowsPerBush =
      q.decorDetail === "rich" ? 2 :
      q.decorDetail === "simple" ? 1 : 0;
    if (glowsPerBush > 0) {
      const glowMat = new THREE.MeshBasicMaterial({
        color: PALETTE.groveAccent,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      disposables.push(glowMat);
      const glowGeo = new THREE.SphereGeometry(0.18, 6, 5);
      disposables.push(glowGeo);
      const totalGlow = BUSHES.length * glowsPerBush;
      const glowMesh = new THREE.InstancedMesh(glowGeo, glowMat, totalGlow);
      let gi = 0;
      for (let bi = 0; bi < BUSHES.length; bi++) {
        const b = BUSHES[bi];
        for (let i = 0; i < glowsPerBush; i++) {
          const seed = bi * 7919 + i * 113;
          const angle = hash01(seed) * Math.PI * 2;
          const radial = hash01(seed + 1) * b.radius * 0.5;
          const sx = b.x + Math.cos(angle) * radial;
          const sz = b.y + Math.sin(angle) * radial;
          const sy = 1.0 + hash01(seed + 2) * 1.2;
          tmpPos.set(sx, sy, sz);
          tmpEuler.set(0, 0, 0);
          tmpQuat.setFromEuler(tmpEuler);
          const s = 0.7 + hash01(seed + 3) * 0.6;
          tmpScale.set(s, s, s);
          tmpMat.compose(tmpPos, tmpQuat, tmpScale);
          glowMesh.setMatrixAt(gi++, tmpMat);
        }
      }
      glowMesh.instanceMatrix.needsUpdate = true;
      glowMesh.matrixAutoUpdate = false;
      glowMesh.renderOrder = 1; // glow drawn after foliage
      group.add(glowMesh);
    }
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
