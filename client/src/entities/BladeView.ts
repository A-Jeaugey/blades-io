import * as THREE from "three";
import {
  BladeRarity,
  RARITY_SCALE,
  TIER_COUNT,
  orbitSlotAngle,
  ringRadius,
  tierVisualScale,
} from "@bladeio/shared";
import { getActiveTheme } from "../themes";
import { FLASH_COLOR } from "../themes/Theme";
import { createTierGeometry } from "./bladeGeometries";

export interface PlayerPositionProvider {
  getRenderPosition(
    playerId: string,
  ): {
    x: number;
    y: number;
    spinPhase: number;
    // Horloge d'orbite du joueur au tick de rendu (cf. orbitThetaAt) :
    // intègre tier, nombre de lames et Spin, comme sur le serveur.
    theta: number;
    // Tier du joueur (0 à TIER_COUNT - 1) : forme, échelle et glow.
    tier: number;
    // Nombre total de lames du joueur, utilisé pour le rotMult dynamique.
    bladeCount: number;
    // Motif du style de lame équipé (tâche 6.1), 0 = aucun.
    bladeStyle: number;
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
  // Drop au sol dans ses dernières secondes : clignote avant de disparaître.
  expiring: boolean;
  // Fin du flash blanc d'un clash (performance.now(), ms).
  flashUntil: number;
}

// Capacité de départ d'un bucket ; elle double quand il est plein. Avant,
// un plafond fixe de 800 rendait invisibles, sans avertissement, les lames
// suivantes (atteignable dans une room pleine de joueurs de tier 2 en lames
// communes).
const INITIAL_BUCKET_CAPACITY = 256;
const TIER_BUCKETS = TIER_COUNT;
const BUCKETS = 4 * TIER_BUCKETS;
// Émissif par tier. Avec un matériau par bucket, on peut pousser franchement
// sans craindre le washout du matériau partagé d'avant. Les hauts tiers ont
// des formes plus grandes (disque de scie, halo) et des orbites plus
// pleines : leur glow baisse d'un cran par tier pour que la somme sous bloom
// reste lisible.
const TIER_EMISSIVE: readonly number[] = [0.90, 0.75, 0.60, 0.52, 0.46, 0.42];
// Couleur "body" légèrement atténuée à haut tier pour limiter la sommation
// sous bloom additif, mais sans assombrir.
const TIER_COLOR_MULT: readonly number[] = [1.0, 0.92, 0.85, 0.82, 0.8, 0.78];
// Compensation de luminance par rareté : voir palette.ts (calculée
// dynamiquement à partir des couleurs courantes). Permet à toutes les raretés
// de franchir le threshold UnrealBloom de manière équilibrée — sinon les
// teintes claires (Common, Legendary or) écrasent les violets profonds.
const bucketKey = (rarity: BladeRarity, tier: number): number => rarity * TIER_BUCKETS + tier;

// Flash blanc d'une lame qui vient de clasher : plein sur les 40 premières
// millisecondes, puis fondu.
const FLASH_MS = 80;
// Lames brisées en plein flash, gardées en blanc à leur dernière pose.
const MAX_GHOSTS = 64;

// Motifs des styles de lame (tâche 6.1) : un multiplicateur de luminosité
// (1 = aucun effet), jamais un changement de teinte, pour que la rareté
// reste lisible. Coordonnées locales de la lame : pointe vers +x, de -0,55
// à 0,95 (cf. bladeGeometries.ts).
const STYLE_GLSL = /* glsl */ `
float bladeStyle(float s, vec3 p) {
  if (s < 0.5) return 1.0;
  // 1. Pulse : une vague lumineuse remonte vers la pointe.
  if (s < 1.5) {
    float w = sin(p.x * 7.0 - uBladeTime * 7.0) * 0.5 + 0.5;
    return 0.85 + 0.55 * smoothstep(0.55, 1.0, w);
  }
  // 2. Stries : bandes claires obliques qui défilent.
  if (s < 2.5) {
    float b = fract(p.x * 2.5 + p.z * 4.0 - uBladeTime * 1.5);
    return 0.85 + 0.5 * smoothstep(0.75, 0.95, b);
  }
  // 3. Étincelles : des points de la lame scintillent.
  if (s < 3.5) {
    vec3 c = floor(p * 18.0);
    float h = fract(sin(dot(c, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float tw = sin(uBladeTime * 6.0 + h * 40.0) * 0.5 + 0.5;
    return 0.9 + 0.9 * step(0.92, h) * tw;
  }
  // 4. Noyau : arête centrale vive, bords assombris.
  if (s < 4.5) {
    float edge = clamp(abs(p.z) * 7.0 + abs(p.y) * 7.0, 0.0, 1.0);
    return mix(1.45, 0.7, edge);
  }
  // 5. Glitch : de brefs décrochages de luminosité, par tranches.
  float g = fract(sin(floor(p.x * 6.0) * 91.7 + floor(uBladeTime * 8.0) * 13.1) * 4375.85);
  return g > 0.85 ? 1.5 : (g < 0.1 ? 0.6 : 1.0);
}
`;

// Flash et motif par instance. aFlash (0..1) tire la couleur finale vers le
// blanc, mélangé en toute fin de shader, après brouillard et émissif :
// blanc franc quelle que soit la rareté (multiplier la couleur d'instance
// ne blanchit pas une teinte saturée). aStyle choisit le motif du style de
// lame du propriétaire, appliqué juste avant.
function addInstanceShading(material: THREE.Material, time: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBladeTime = time;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aFlash;\nattribute float aStyle;\nvarying float vFlash;\nvarying float vStyle;\nvarying vec3 vBladePos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFlash = aFlash;\nvStyle = aStyle;\nvBladePos = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uBladeTime;\nvarying float vFlash;\nvarying float vStyle;\nvarying vec3 vBladePos;\n" + STYLE_GLSL)
      .replace(
        "#include <dithering_fragment>",
        "#include <dithering_fragment>\ngl_FragColor.rgb *= bladeStyle(vStyle, vBladePos);\ngl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0), vFlash);",
      );
  };
}

type OwnerPose = NonNullable<ReturnType<PlayerPositionProvider["getRenderPosition"]>>;

export class BladeRenderer {
  // 4 raretés × TIER_COUNT tiers InstancedMesh, indexés à plat par bucketKey().
  // Chaque bucket a son propre matériau avec emissiveIntensity tier-aware,
  // ce qui permet de baisser le glow uniquement aux tiers où la sommation
  // washoutait l'écran.
  private meshes: THREE.InstancedMesh[] = new Array(BUCKETS);
  private materials: THREE.Material[] = new Array(BUCKETS);
  private tierGeos: THREE.BufferGeometry[];
  private capacity: number[] = new Array(BUCKETS).fill(INITIAL_BUCKET_CAPACITY);
  // Flash par instance, un attribut par bucket (d'où une géométrie par
  // bucket : l'attribut vit sur la géométrie).
  private flashes: THREE.InstancedBufferAttribute[] = new Array(BUCKETS);
  // Motif du style de lame du propriétaire, par instance (tâche 6.1).
  private styles: THREE.InstancedBufferAttribute[] = new Array(BUCKETS);
  private dirtyStyles: boolean[] = new Array(BUCKETS).fill(false);
  // Horloge des motifs (secondes), partagée par tous les matériaux.
  private time = { value: 0 };
  // Index inverse : id de la lame dessinée à chaque instance d'un bucket.
  // Retirer une instance y déplace la dernière : on sait laquelle sans
  // parcourir tout l'index (O(1) au lieu de O(n) par lame, d'où des pics
  // de frame aux morts et aux ramassages en masse).
  private slots: string[][] = Array.from({ length: BUCKETS }, () => []);
  // Une lame brisée dans un clash disparaît au tick du clash, donc avant la
  // fin de son flash : entre deux raretés égales (PV = dégâts), les deux
  // lames cassent et on ne voyait jamais le flash. Sa dernière pose reste
  // affichée en blanc jusqu'à la fin du flash.
  // Un InstancedMesh de fantômes par tier : la forme suit le palier.
  private ghosts: THREE.InstancedMesh[] = [];
  private ghostList: Array<{ matrix: THREE.Matrix4; until: number; tier: number; rarity: BladeRarity }> = [];
  // Réglage des flashs (tâche 3.8), de 0 à 1 : part de blanc du flash, et
  // couleur des fantômes (couleur de la rareté mêlée de blanc d'autant).
  private flashIntensity = 1;
  private ghostColors: THREE.Color[] = [];
  private counts: number[] = new Array(BUCKETS).fill(0);
  private idToIndex = new Map<string, { rarity: BladeRarity; tier: number; index: number }>();
  private entries = new Map<string, BladeEntry>();
  private perOwnerRingCount = new Map<string, Map<number, number>>();

  private tmpMat = new THREE.Matrix4();
  private tmpQuat = new THREE.Quaternion();
  private tmpEuler = new THREE.Euler();
  private tmpScale = new THREE.Vector3();
  private tmpPos = new THREE.Vector3();
  // Réutilisés d'une frame à l'autre.
  private ownerPoses = new Map<string, OwnerPose | null>();
  private migrations: Array<{ id: string; newTier: number }> = [];
  private dirtyMatrices: boolean[] = new Array(BUCKETS).fill(false);
  private dirtyFlashes: boolean[] = new Array(BUCKETS).fill(false);
  public root = new THREE.Group();

  constructor(simpleMaterials = false) {
    const geos = Array.from({ length: TIER_BUCKETS }, (_, t) => createTierGeometry(t, simpleMaterials));
    this.tierGeos = geos;
    const theme = getActiveTheme();
    const rarities: BladeRarity[] = [
      BladeRarity.Common, BladeRarity.Rare, BladeRarity.Epic, BladeRarity.Legendary,
    ];
    for (const r of rarities) {
      for (let t = 0; t < TIER_BUCKETS; t++) {
        const baseColor = new THREE.Color(theme.palette.rarityColor[r]);
        const tintedColor = baseColor.clone().multiplyScalar(TIER_COLOR_MULT[t]);
        const tintedEmissive = baseColor.clone().multiplyScalar(TIER_COLOR_MULT[t]);
        const mat = simpleMaterials
          ? new THREE.MeshBasicMaterial({ color: tintedColor })
          : new THREE.MeshPhongMaterial({
              color: tintedColor,
              emissive: tintedEmissive,
              // Compensation luminance × tier intensity × boost emissif du
              // thème. Le boost permet aux thèmes "spirit" de pousser le
              // glow (1.15) tandis que neon reste à 1.0 pour préserver
              // les reflets net cyberpunk d'origine.
              emissiveIntensity:
                TIER_EMISSIVE[t] *
                theme.palette.rarityGlowComp[r] *
                theme.blades.emissiveBoost,
              shininess: theme.blades.shininess,
              specular: theme.blades.specularColor,
            });
        addInstanceShading(mat, this.time);
        const key = bucketKey(r, t);
        this.materials[key] = mat;
        this.setBucketMesh(key, this.createBucketMesh(key, INITIAL_BUCKET_CAPACITY));
      }
    }
    const ghostMat = new THREE.MeshBasicMaterial({ color: FLASH_COLOR });
    for (const r of rarities) this.ghostColors[r] = new THREE.Color(FLASH_COLOR);
    for (let t = 0; t < TIER_BUCKETS; t++) {
      const ghosts = new THREE.InstancedMesh(geos[t], ghostMat, MAX_GHOSTS);
      ghosts.count = 0;
      ghosts.frustumCulled = false;
      ghosts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Couleur par instance créée d'emblée : le shader l'inclut dès sa
      // compilation.
      ghosts.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_GHOSTS * 3).fill(1), 3);
      ghosts.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.ghosts.push(ghosts);
      this.root.add(ghosts);
    }
  }

  upsert(
    id: string, rarity: BladeRarity, ownerId: string,
    ringIndex: number, slotIndex: number, x: number, y: number, now: number,
    isProjectile: boolean = false, vx: number = 0, vy: number = 0,
    expiring: boolean = false,
  ): void {
    let e = this.entries.get(id);
    if (!e) {
      e = { id, rarity, ownerId, ringIndex, slotIndex,
        prevX: x, prevY: y, prevTime: now, targetX: x, targetY: y, targetTime: now,
        isProjectile, vx, vy, expiring, flashUntil: 0 };
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
    e.expiring = expiring;
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
    const ref = this.idToIndex.get(id);
    if (ref && e.flashUntil > performance.now() && this.flashIntensity > 0 && this.ghostList.length < MAX_GHOSTS) {
      const matrix = new THREE.Matrix4();
      this.meshes[bucketKey(ref.rarity, ref.tier)].getMatrixAt(ref.index, matrix);
      this.ghostList.push({ matrix, until: e.flashUntil, tier: ref.tier, rarity: ref.rarity });
    }
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
    this.ghostList.length = 0;
    for (const g of this.ghosts) g.count = 0;
    for (let i = 0; i < this.meshes.length; i++) {
      this.counts[i] = 0;
      this.slots[i].length = 0;
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

  private createBucketMesh(key: number, capacity: number): THREE.InstancedMesh {
    const geo = this.tierGeos[key % TIER_BUCKETS].clone();
    const flash = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    flash.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aFlash", flash);
    const style = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    style.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aStyle", style);
    const mesh = new THREE.InstancedMesh(geo, this.materials[key], capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return mesh;
  }

  private setBucketMesh(key: number, mesh: THREE.InstancedMesh): void {
    this.meshes[key] = mesh;
    this.flashes[key] = mesh.geometry.getAttribute("aFlash") as THREE.InstancedBufferAttribute;
    this.styles[key] = mesh.geometry.getAttribute("aStyle") as THREE.InstancedBufferAttribute;
    this.root.add(mesh);
  }

  // Bucket plein : un maillage deux fois plus grand le remplace, instances
  // et flashs recopiés. Rare (la capacité double à chaque fois) ; le
  // matériau, partagé, ne se recompile pas.
  private grow(key: number): void {
    const old = this.meshes[key];
    const count = this.counts[key];
    this.capacity[key] *= 2;
    const mesh = this.createBucketMesh(key, this.capacity[key]);
    (mesh.instanceMatrix.array as Float32Array).set((old.instanceMatrix.array as Float32Array).subarray(0, count * 16));
    const flash = mesh.geometry.getAttribute("aFlash") as THREE.InstancedBufferAttribute;
    (flash.array as Float32Array).set((this.flashes[key].array as Float32Array).subarray(0, count));
    const style = mesh.geometry.getAttribute("aStyle") as THREE.InstancedBufferAttribute;
    (style.array as Float32Array).set((this.styles[key].array as Float32Array).subarray(0, count));
    mesh.count = count;
    this.root.remove(old);
    old.geometry.dispose();
    old.dispose();
    this.setBucketMesh(key, mesh);
  }

  private allocate(id: string, rarity: BladeRarity, tier: number): void {
    const t = Math.max(0, Math.min(TIER_BUCKETS - 1, tier));
    const key = bucketKey(rarity, t);
    if (this.counts[key] >= this.capacity[key]) this.grow(key);
    const index = this.counts[key]++;
    this.meshes[key].count = this.counts[key];
    this.slots[key][index] = id;
    this.idToIndex.set(id, { rarity, tier: t, index });
  }

  private removeInstance(id: string): void {
    const ref = this.idToIndex.get(id);
    if (!ref) return;
    const key = bucketKey(ref.rarity, ref.tier);
    const mesh = this.meshes[key];
    const last = this.counts[key] - 1;
    // La dernière instance prend la place libérée.
    const movedId = this.slots[key].pop()!;
    if (ref.index !== last) {
      mesh.getMatrixAt(last, this.tmpMat);
      mesh.setMatrixAt(ref.index, this.tmpMat);
      const flash = this.flashes[key].array as Float32Array;
      flash[ref.index] = flash[last];
      const style = this.styles[key].array as Float32Array;
      style[ref.index] = style[last];
      this.dirtyStyles[key] = true;
      this.slots[key][ref.index] = movedId;
      const movedRef = this.idToIndex.get(movedId);
      if (movedRef) movedRef.index = ref.index;
    }
    this.counts[key] = last;
    mesh.count = last;
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

  // Place d'une lame en orbite (mode debug), relevée avant qu'elle ne
  // disparaisse éventuellement dans le clash mesuré.
  orbitInfo(id: string): { ownerId: string; ring: number; slot: number; inRing: number } | null {
    const e = this.entries.get(id);
    if (!e || !e.ownerId) return null;
    const inRing = this.perOwnerRingCount.get(e.ownerId)?.get(e.ringIndex) ?? 1;
    return { ownerId: e.ownerId, ring: e.ringIndex, slot: e.slotIndex, inRing };
  }

  isOrbiting(id: string): boolean {
    return !!this.entries.get(id)?.ownerId;
  }

  setFlashIntensity(k: number): void {
    this.flashIntensity = k;
    const rarityColor = getActiveTheme().palette.rarityColor;
    const white = new THREE.Color(FLASH_COLOR);
    for (const r of [BladeRarity.Common, BladeRarity.Rare, BladeRarity.Epic, BladeRarity.Legendary]) {
      this.ghostColors[r].set(rarityColor[r]).lerp(white, k);
    }
  }

  // Flash blanc d'une lame impliquée dans un clash (now : performance.now()).
  flash(id: string, now: number): void {
    const e = this.entries.get(id);
    if (e) e.flashUntil = now + FLASH_MS;
  }

  // Lames en cours de flash, brisées comprises (mode debug).
  flashingCount(now: number): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.flashUntil > now) n++;
    for (const g of this.ghostList) if (g.until > now) n++;
    return n;
  }

  // Pose d'un joueur à cette frame : une seule lecture par propriétaire et
  // par frame (avant, jusqu'à trois par lame : tier, position, échelle).
  private ownerPose(players: PlayerPositionProvider, id: string): OwnerPose | null {
    let pose = this.ownerPoses.get(id);
    if (pose === undefined) {
      pose = players.getRenderPosition(id) ?? null;
      this.ownerPoses.set(id, pose);
    }
    return pose;
  }

  update(
    now: number, renderDelay: number, elapsedSec: number,
    players: PlayerPositionProvider,
  ): void {
    const renderTime = now - renderDelay;
    this.time.value = elapsedSec;
    this.ownerPoses.clear();
    const dirtyMatrices = this.dirtyMatrices;
    const dirtyFlashes = this.dirtyFlashes;
    const dirtyStyles = this.dirtyStyles;

    // Pass 1 (rapide) : détection des changements de tier. On collecte les
    // ids à migrer puis on applique en dehors du forEach pour ne pas muter
    // idToIndex pendant l'itération principale.
    const migrations = this.migrations;
    migrations.length = 0;
    this.entries.forEach((e, id) => {
      if (!e.ownerId) return;
      const ref = this.idToIndex.get(id);
      if (!ref) return;
      const ownerTier = this.ownerPose(players, e.ownerId)?.tier ?? 0;
      if (ref.tier !== ownerTier) migrations.push({ id, newTier: ownerTier });
    });
    for (const m of migrations) this.migrateTier(m.id, m.newTier);

    this.entries.forEach((e, id) => {
      const ref = this.idToIndex.get(id);
      if (!ref) return;
      const key = bucketKey(ref.rarity, ref.tier);
      const mesh = this.meshes[key];
      let x: number; let y: number; let yRender: number; let angle: number;
      const owner = e.ownerId ? this.ownerPose(players, e.ownerId) : null;

      if (e.ownerId) {
        if (!owner) return;
        const rings = this.perOwnerRingCount.get(e.ownerId);
        const nInRing = rings?.get(e.ringIndex) ?? 1;
        // Même formule que le serveur, à l'horloge d'orbite du tick de rendu :
        // la lame est dessinée là où le serveur la fait collisionner.
        angle = orbitSlotAngle(e.ringIndex, e.slotIndex, nInRing, owner.theta, owner.spinPhase);
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

      // L'échelle finale combine la rareté (couleur+stat) et le tier (cf.
      // TIER_VISUAL_SCALE) ; la forme du tier vient de sa géométrie.
      // Drop sur le point d'expirer : clignotement à ~4 Hz (réduit, pas
      // masqué, pour qu'on voie encore où il est).
      const blink = !e.ownerId && !e.isProjectile && e.expiring && Math.floor(elapsedSec * 8) % 2 === 1
        ? 0.3
        : 1;
      const baseS = RARITY_SCALE[e.rarity] * blink;
      let sx = baseS;
      let sy = baseS;
      let sz = baseS;
      if (owner) {
        const ts = tierVisualScale(owner.tier);
        sx *= ts;
        sy *= ts;
        sz *= ts;
      }
      this.tmpPos.set(x, yRender, y);
      this.tmpEuler.set(0, -angle, 0);
      this.tmpQuat.setFromEuler(this.tmpEuler);
      this.tmpScale.set(sx, sy, sz);
      this.tmpMat.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      mesh.setMatrixAt(ref.index, this.tmpMat);
      dirtyMatrices[key] = true;
      // Réécrit à chaque frame : un index d'instance change de lame quand
      // une autre est retirée du bucket.
      const k = (e.flashUntil - now) / FLASH_MS;
      const flash = k > 0 ? Math.min(1, k * 2) * this.flashIntensity : 0;
      const flashArr = this.flashes[key].array as Float32Array;
      if (flashArr[ref.index] !== flash) {
        flashArr[ref.index] = flash;
        dirtyFlashes[key] = true;
      }
      // Motif du propriétaire ; lames au sol et lancées : aucun.
      const style = owner?.bladeStyle ?? 0;
      const styleArr = this.styles[key].array as Float32Array;
      if (styleArr[ref.index] !== style) {
        styleArr[ref.index] = style;
        dirtyStyles[key] = true;
      }
    });

    for (let key = 0; key < BUCKETS; key++) {
      if (dirtyMatrices[key]) this.meshes[key].instanceMatrix.needsUpdate = true;
      if (dirtyFlashes[key]) this.flashes[key].needsUpdate = true;
      if (dirtyStyles[key]) this.styles[key].needsUpdate = true;
      dirtyMatrices[key] = false;
      dirtyFlashes[key] = false;
      dirtyStyles[key] = false;
    }

    if (this.ghostList.length > 0 || this.ghosts.some((g) => g.count > 0)) {
      this.ghostList = this.ghostList.filter((g) => g.until > now);
      for (const g of this.ghosts) g.count = 0;
      for (const ghost of this.ghostList) {
        const mesh = this.ghosts[ghost.tier];
        mesh.setColorAt(mesh.count, this.ghostColors[ghost.rarity]);
        mesh.setMatrixAt(mesh.count++, ghost.matrix);
      }
      for (const g of this.ghosts) {
        g.instanceMatrix.needsUpdate = true;
        g.instanceColor!.needsUpdate = true;
      }
    }
  }
}
