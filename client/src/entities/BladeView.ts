import * as THREE from "three";
import {
  BladeRarity,
  RARITY_SCALE,
  slotAngle,
  ringRadius,
  tierRotationMult,
  tierVisualScale,
  bladeCountRotationMult,
} from "@bladeio/shared";
import { RARITY_COLOR, RARITY_GLOW_COMP } from "../scene/palette";

// Géométrie d'épée : lame longue et fine en bipyramide losange (pointe
// en +x, section losange au milieu pour un reflet en arête), garde
// perpendiculaire (cross-guard) visible en +/-z, petit pommeau à la base.
// Un seul BufferGeometry instancié -> quasi gratuit même à 800 instances.
function createBladeGeometry(): THREE.BufferGeometry {
  const tipX = 0.95; // pointe de lame
  const midX = 0.05; // section la plus large de la lame
  const baseX = -0.2; // base de la lame (accolée au crossguard)
  const bladeHalfW = 0.07; // demi-largeur (axe z)
  const bladeHalfT = 0.03; // demi-épaisseur (axe y), lame plate

  const guardX = -0.25; // centre du crossguard
  const guardHalfX = 0.06;
  const guardHalfZ = 0.26;
  const guardHalfY = 0.06;

  const handleX = -0.35;
  const handleHalfX = 0.08;
  const handleHalfZ = 0.05;
  const handleHalfY = 0.05;

  const pommelX = -0.48;

  const positions: number[] = [];
  const indices: number[] = [];
  const pushV = (x: number, y: number, z: number): number => {
    const i = positions.length / 3;
    positions.push(x, y, z);
    return i;
  };

  const tip = pushV(tipX, 0, 0);
  const midT = pushV(midX, bladeHalfT, 0);
  const midB = pushV(midX, -bladeHalfT, 0);
  const midF = pushV(midX, 0, bladeHalfW);
  const midK = pushV(midX, 0, -bladeHalfW);
  indices.push(tip, midT, midF, tip, midF, midB, tip, midB, midK, tip, midK, midT);
  const bHalfW = bladeHalfW * 0.6;
  const bHalfT = bladeHalfT * 0.8;
  const baseT = pushV(baseX, bHalfT, 0);
  const baseB = pushV(baseX, -bHalfT, 0);
  const baseF = pushV(baseX, 0, bHalfW);
  const baseK = pushV(baseX, 0, -bHalfW);
  indices.push(
    midT, baseT, baseF, midT, baseF, midF,
    midF, baseF, baseB, midF, baseB, midB,
    midB, baseB, baseK, midB, baseK, midK,
    midK, baseK, baseT, midK, baseT, midT,
  );
  indices.push(baseT, baseF, baseB, baseT, baseB, baseK);

  const pushBox = (
    cx: number, cy: number, cz: number,
    hx: number, hy: number, hz: number,
  ) => {
    const v000 = pushV(cx - hx, cy - hy, cz - hz);
    const v100 = pushV(cx + hx, cy - hy, cz - hz);
    const v010 = pushV(cx - hx, cy + hy, cz - hz);
    const v110 = pushV(cx + hx, cy + hy, cz - hz);
    const v001 = pushV(cx - hx, cy - hy, cz + hz);
    const v101 = pushV(cx + hx, cy - hy, cz + hz);
    const v011 = pushV(cx - hx, cy + hy, cz + hz);
    const v111 = pushV(cx + hx, cy + hy, cz + hz);
    indices.push(v000, v100, v101, v000, v101, v001);
    indices.push(v010, v011, v111, v010, v111, v110);
    indices.push(v000, v010, v110, v000, v110, v100);
    indices.push(v001, v101, v111, v001, v111, v011);
    indices.push(v000, v001, v011, v000, v011, v010);
    indices.push(v100, v110, v111, v100, v111, v101);
  };

  pushBox(guardX, 0, 0, guardHalfX, guardHalfY, guardHalfZ);
  pushBox(handleX, 0, 0, handleHalfX, handleHalfY, handleHalfZ);

  const pr = 0.065;
  const pmT = pushV(pommelX, pr, 0);
  const pmB = pushV(pommelX, -pr, 0);
  const pmF = pushV(pommelX + pr, 0, 0);
  const pmK = pushV(pommelX - pr, 0, 0);
  const pmP = pushV(pommelX, 0, pr);
  const pmN = pushV(pommelX, 0, -pr);
  indices.push(
    pmT, pmF, pmP,  pmT, pmP, pmK,
    pmT, pmK, pmN,  pmT, pmN, pmF,
    pmB, pmP, pmF,  pmB, pmK, pmP,
    pmB, pmN, pmK,  pmB, pmF, pmN,
  );

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint16Array(indices), 1));
  geo.computeVertexNormals();
  return geo;
}

export interface PlayerPositionProvider {
  getRenderPosition(
    playerId: string,
  ): {
    x: number;
    y: number;
    spinPhase: number;
    spinScale: number;
    // Tier 0..2 du joueur, pilote l'échelle/glow visuels et le rotMult.
    tier: number;
    // Décalage de temps imposé par le serveur (hitlag) : on soustrait à
    // elapsedSec pour figer la rotation pendant le freeze.
    orbitTimeOffset: number;
    // Vrai si le joueur est dans un buisson ET n'est pas le joueur local
    // (ce qui veut dire : invisible pour nous). On skip alors le rendu
    // de ses lames pour ne pas trahir sa présence.
    hidden: boolean;
    // Nombre total de lames du joueur, utilisé pour le rotMult dynamique.
    bladeCount: number;
  } | undefined;
}

interface BladeEntry {
  id: string;
  rarity: BladeRarity;
  ownerId: string;
  ringIndex: number;
  slotIndex: number;
  prevX: number;
  prevY: number;
  prevTime: number;
  targetX: number;
  targetY: number;
  targetTime: number;
  // Lame en projectile (lancée). Quand vrai, on l'oriente selon sa
  // velocity et on émet une traînée néon plutôt que la rotation idle.
  isProjectile: boolean;
  vx: number;
  vy: number;
}

const MAX_INSTANCES_PER_BUCKET = 800;
const TIER_BUCKETS = 3;
// Émissif par tier. Avec un matériau par bucket, on peut pousser franchement
// sans craindre le washout du matériau partagé d'avant. T1/T2 doivent rester
// brillants pour bien lire le tier-up en cours, juste un cran sous T0 pour
// que la sommation visuelle reste contrôlée.
const TIER_EMISSIVE: readonly number[] = [0.90, 0.75, 0.60];
// Couleur "body" légèrement atténuée à haut tier pour limiter la sommation
// sous bloom additif, mais sans assombrir (T2 garde ~85 % de la teinte).
const TIER_COLOR_MULT: readonly number[] = [1.0, 0.92, 0.85];
// Compensation de luminance par rareté : voir palette.ts (calculée
// dynamiquement à partir des couleurs courantes). Permet à toutes les raretés
// de franchir le threshold UnrealBloom de manière équilibrée — sinon les
// teintes claires (Common, Legendary or) écrasent les violets profonds.
const bucketKey = (rarity: BladeRarity, tier: number): number => rarity * TIER_BUCKETS + tier;

export class BladeRenderer {
  // 4 raretés × 3 tiers = 12 InstancedMesh, indexés à plat par bucketKey().
  // Chaque bucket a son propre matériau avec emissiveIntensity tier-aware,
  // ce qui permet de baisser le glow uniquement aux tiers où la sommation
  // washoutait l'écran.
  private meshes: THREE.InstancedMesh[] = new Array(4 * TIER_BUCKETS);
  private counts: number[] = new Array(4 * TIER_BUCKETS).fill(0);
  private idToIndex = new Map<string, { rarity: BladeRarity; tier: number; index: number }>();
  private entries = new Map<string, BladeEntry>();
  private perOwnerRingCount = new Map<string, Map<number, number>>();

  private tmpMat = new THREE.Matrix4();
  private tmpQuat = new THREE.Quaternion();
  private tmpEuler = new THREE.Euler();
  private tmpScale = new THREE.Vector3();
  private tmpPos = new THREE.Vector3();
  public root = new THREE.Group();

  constructor(simpleMaterials = false) {
    const geo = createBladeGeometry();
    const rarities: BladeRarity[] = [
      BladeRarity.Common, BladeRarity.Rare, BladeRarity.Epic, BladeRarity.Legendary,
    ];
    for (const r of rarities) {
      for (let t = 0; t < TIER_BUCKETS; t++) {
        const baseColor = new THREE.Color(RARITY_COLOR[r]);
        const tintedColor = baseColor.clone().multiplyScalar(TIER_COLOR_MULT[t]);
        const tintedEmissive = baseColor.clone().multiplyScalar(TIER_COLOR_MULT[t]);
        const mat = simpleMaterials
          ? new THREE.MeshBasicMaterial({ color: tintedColor })
          : new THREE.MeshPhongMaterial({
              color: tintedColor,
              emissive: tintedEmissive,
              // Compensation luminance × tier intensity : équilibre le bloom
              // entre raretés (sinon les blanches dominent visuellement).
              // Boost +15 % en plus pour pousser le glow spirit-world
              // (les lames doivent lire comme des "fragments d'âme" lumineux,
              // pas comme du métal poli).
              emissiveIntensity: TIER_EMISSIVE[t] * RARITY_GLOW_COMP[r] * 1.15,
              // Shininess basse (30 au lieu de 80) : highlight spéculaire
              // plus large et doux → lecture "lumière intérieure" plutôt
              // que "métal réfléchissant". Plus cohérent avec un objet
              // spirituel qu'avec une épée d'acier.
              shininess: 30,
              specular: 0x4a3a6e, // tint mauve sur le specular pour
              // unifier avec l'ambiance générale (au lieu du blanc défaut
              // qui crée des reflets cyberpunk-froids).
            });
        const mesh = new THREE.InstancedMesh(geo, mat, MAX_INSTANCES_PER_BUCKET);
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.meshes[bucketKey(r, t)] = mesh;
        this.root.add(mesh);
      }
    }
  }

  upsert(
    id: string, rarity: BladeRarity, ownerId: string,
    ringIndex: number, slotIndex: number, x: number, y: number, now: number,
    isProjectile: boolean = false, vx: number = 0, vy: number = 0,
  ): void {
    let e = this.entries.get(id);
    if (!e) {
      e = { id, rarity, ownerId, ringIndex, slotIndex,
        prevX: x, prevY: y, prevTime: now, targetX: x, targetY: y, targetTime: now,
        isProjectile, vx, vy };
      this.entries.set(id, e);
      // Allocation au tier 0 par défaut. update() migrera au bon tier dès
      // la frame suivante en lisant owner.tier (la lame n'est pas rendue
      // d'ici là donc pas de flicker).
      this.allocate(id, rarity, 0);
      this.incOwnerRing(ownerId, ringIndex, +1);
      return;
    }
    if (e.ownerId !== ownerId || e.ringIndex !== ringIndex) {
      this.incOwnerRing(e.ownerId, e.ringIndex, -1);
      this.incOwnerRing(ownerId, ringIndex, +1);
    }
    e.ownerId = ownerId; e.ringIndex = ringIndex; e.slotIndex = slotIndex;
    e.isProjectile = isProjectile;
    e.vx = vx; e.vy = vy;
    if (e.rarity !== rarity) {
      const ref = this.idToIndex.get(id);
      const tier = ref?.tier ?? 0;
      this.removeInstance(id);
      this.allocate(id, rarity, tier);
      e.rarity = rarity;
    }
    e.prevX = e.targetX; e.prevY = e.targetY; e.prevTime = e.targetTime;
    e.targetX = x; e.targetY = y; e.targetTime = now;
  }

  remove(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    this.incOwnerRing(e.ownerId, e.ringIndex, -1);
    this.entries.delete(id);
    this.removeInstance(id);
  }

  // Vide toutes les instances sans détruire le renderer. Utilisé sur retour
  // menu / reconnexion : sinon les InstancedMesh accumulent les lames
  // d'anciennes sessions et le joueur voit des "fantômes" non ramassables
  // (parce qu'absents du state serveur courant).
  clear(): void {
    this.entries.clear();
    this.idToIndex.clear();
    this.perOwnerRingCount.clear();
    for (let i = 0; i < this.meshes.length; i++) {
      this.counts[i] = 0;
      const m = this.meshes[i];
      m.count = 0;
      m.instanceMatrix.needsUpdate = true;
    }
  }

  private incOwnerRing(ownerId: string, ringIndex: number, delta: number): void {
    if (!ownerId) return;
    let rings = this.perOwnerRingCount.get(ownerId);
    if (!rings) { rings = new Map(); this.perOwnerRingCount.set(ownerId, rings); }
    const next = (rings.get(ringIndex) ?? 0) + delta;
    if (next <= 0) rings.delete(ringIndex);
    else rings.set(ringIndex, next);
    if (rings.size === 0) this.perOwnerRingCount.delete(ownerId);
  }

  private allocate(id: string, rarity: BladeRarity, tier: number): void {
    const t = Math.max(0, Math.min(TIER_BUCKETS - 1, tier));
    const key = bucketKey(rarity, t);
    const mesh = this.meshes[key];
    const count = this.counts[key];
    if (count >= MAX_INSTANCES_PER_BUCKET) return;
    this.counts[key] = count + 1;
    mesh.count = count + 1;
    this.idToIndex.set(id, { rarity, tier: t, index: count });
  }

  private removeInstance(id: string): void {
    const ref = this.idToIndex.get(id);
    if (!ref) return;
    const key = bucketKey(ref.rarity, ref.tier);
    const mesh = this.meshes[key];
    const count = this.counts[key];
    const last = count - 1;
    if (ref.index !== last) {
      mesh.getMatrixAt(last, this.tmpMat);
      mesh.setMatrixAt(ref.index, this.tmpMat);
      for (const [, otherRef] of this.idToIndex) {
        if (otherRef.rarity === ref.rarity && otherRef.tier === ref.tier && otherRef.index === last) {
          otherRef.index = ref.index; break;
        }
      }
    }
    this.counts[key] = Math.max(0, count - 1);
    mesh.count = Math.max(0, count - 1);
    mesh.instanceMatrix.needsUpdate = true;
    this.idToIndex.delete(id);
  }

  // Migre une lame d'un bucket (rarity, oldTier) vers (rarity, newTier).
  // Appelé depuis update() quand on détecte un tier-up/tier-down sur l'owner.
  private migrateTier(id: string, newTier: number): void {
    const ref = this.idToIndex.get(id);
    if (!ref) return;
    if (ref.tier === newTier) return;
    const rarity = ref.rarity;
    this.removeInstance(id);
    this.allocate(id, rarity, newTier);
  }

  update(
    now: number, renderDelay: number, elapsedSec: number,
    players: PlayerPositionProvider,
  ): void {
    const renderTime = now - renderDelay;
    const dirtyBuckets = new Set<number>();

    // Pass 1 (rapide) : détection des changements de tier. On collecte les
    // ids à migrer puis on applique en dehors du forEach pour ne pas muter
    // idToIndex pendant l'itération principale.
    const migrations: Array<{ id: string; newTier: number }> = [];
    this.entries.forEach((e, id) => {
      if (!e.ownerId) return;
      const ref = this.idToIndex.get(id);
      if (!ref) return;
      const owner = players.getRenderPosition(e.ownerId);
      const ownerTier = owner?.tier ?? 0;
      if (ref.tier !== ownerTier) migrations.push({ id, newTier: ownerTier });
    });
    for (const m of migrations) this.migrateTier(m.id, m.newTier);

    this.entries.forEach((e, id) => {
      const ref = this.idToIndex.get(id);
      if (!ref) return;
      const mesh = this.meshes[bucketKey(ref.rarity, ref.tier)];
      let x: number; let y: number; let yRender: number; let angle: number;

      if (e.ownerId) {
        const owner = players.getRenderPosition(e.ownerId);
        if (!owner) return;
        // Owner caché (dans un buisson, vu d'un autre joueur) : on collapse
        // l'instance à scale 0 plutôt que de la skip — sinon la matrice
        // précédente reste affichée à la position d'avant.
        if (owner.hidden) {
          this.tmpScale.set(0, 0, 0);
          this.tmpPos.set(0, -100, 0);
          this.tmpEuler.set(0, 0, 0);
          this.tmpQuat.setFromEuler(this.tmpEuler);
          this.tmpMat.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
          mesh.setMatrixAt(ref.index, this.tmpMat);
          dirtyBuckets.add(bucketKey(ref.rarity, ref.tier));
          return;
        }
        const rings = this.perOwnerRingCount.get(e.ownerId);
        const nInRing = rings?.get(e.ringIndex) ?? 1;
        // spinPhase/spinScale du joueur : reste en phase avec le serveur qui
        // désynchronise les orbites par joueur (sinon 2 joueurs = orbites
        // jamais alignées → lames jamais en collision).
        // (elapsedSec - orbitTimeOffset) : pendant un hitlag, le serveur
        // incrémente offset au même rythme que elapsed → angle figé.
        // tierRotationMult : palier de vitesse selon le tier du joueur.
        const effT = elapsedSec - owner.orbitTimeOffset;
        const rotMult = tierRotationMult(owner.tier) * bladeCountRotationMult(owner.bladeCount);
        angle = slotAngle(
          e.ringIndex,
          e.slotIndex,
          nInRing,
          effT,
          owner.spinPhase,
          owner.spinScale,
          rotMult,
        );
        const r = ringRadius(e.ringIndex);
        x = owner.x + Math.cos(angle) * r;
        y = owner.y + Math.sin(angle) * r;
        yRender = 0.9;
      } else if (e.isProjectile) {
        // Projectile : extrapolation linéaire à partir du dernier snapshot
        // serveur en utilisant la velocity. Plus juste que l'interpolation
        // entre deux snapshots (qui retarde l'image de RENDER_DELAY).
        const dtMs = renderTime - e.targetTime;
        x = e.targetX + e.vx * (dtMs / 1000);
        y = e.targetY + e.vy * (dtMs / 1000);
        // Orientation : alignée à la velocity (pointe en avant). On ajoute
        // un petit spin pour que la lame "vrille" en vol au lieu d'être
        // figée comme une flèche.
        const heading = Math.atan2(e.vy, e.vx);
        angle = heading + elapsedSec * 8;
        yRender = 0.95;
      } else {
        const span = e.targetTime - e.prevTime;
        let alpha = 1;
        if (span > 0) alpha = Math.max(0, Math.min(1.2, (renderTime - e.prevTime) / span));
        x = e.prevX + (e.targetX - e.prevX) * alpha;
        y = e.prevY + (e.targetY - e.prevY) * alpha;
        const phase = elapsedSec * 2 + e.prevX * 0.7 + e.prevY * 0.7;
        angle = phase;
        yRender = 0.4 + Math.sin(phase * 0.6) * 0.08;
      }

      // L'échelle finale combine la rareté (couleur+stat) et le tier (palier
      // de progression). Tier 1 = 1.3×, Tier 2 = 1.7× — assez pour "lire" la
      // le tier-up sans cramer l'écran (bloom + multi-instances émissives ont
      // tendance à se sommer en blanc pur sur les hauts tiers).
      const baseS = RARITY_SCALE[e.rarity];
      let sx = baseS;
      let sy = baseS;
      let sz = baseS;
      if (e.ownerId) {
        const owner = players.getRenderPosition(e.ownerId);
        const tier = owner?.tier ?? 0;
        const ts = tierVisualScale(tier);
        sx *= ts;          // longueur (extension de la lame vers l'extérieur)
        sy *= ts;          // épaisseur
        // Stretch transversal léger pour suggérer "lame large" sans toucher
        // la géométrie. +15 %/tier (au lieu de +25 % qui washout l'écran).
        sz *= ts * (tier > 0 ? 1.0 + tier * 0.15 : 1.0);
      }
      this.tmpPos.set(x, yRender, y);
      this.tmpEuler.set(0, -angle, 0);
      this.tmpQuat.setFromEuler(this.tmpEuler);
      this.tmpScale.set(sx, sy, sz);
      this.tmpMat.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      mesh.setMatrixAt(ref.index, this.tmpMat);
      dirtyBuckets.add(bucketKey(ref.rarity, ref.tier));
    });

    dirtyBuckets.forEach((key) => {
      this.meshes[key].instanceMatrix.needsUpdate = true;
    });
  }
}
