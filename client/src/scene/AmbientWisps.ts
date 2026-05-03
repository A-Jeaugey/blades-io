import * as THREE from "three";
import { MAP_RADIUS } from "@bladeio/shared";
import { PALETTE } from "./palette";
import { QualityConfig } from "../quality";

// ─────────────────────────────────────────────────────────────────────────────
// AmbientWisps — particules d'âme en suspension permanente sur la carte.
//
// Différent du ParticlePool (qui gère les bursts de combat) : ici, des
// points lumineux dérivent en continu, respawn quand ils sortent du champ
// du joueur, oscillent légèrement pour simuler un mouvement organique.
//
// Visuellement c'est ce qui transforme une map "atmosphérique mais figée"
// en "monde vivant". Le coût est bas (un seul Points draw call, pool fixe).
// ─────────────────────────────────────────────────────────────────────────────

interface Wisp {
  x: number; y: number; z: number;
  vx: number; vz: number;
  // Couleur de base (RGB 0..1) + intensité pulsée.
  cr: number; cg: number; cb: number;
  basePhase: number;   // décalage de phase pour le scintillement
  baseSize: number;
  baseY: number;       // hauteur de référence (pour l'oscillation verticale)
  driftSpeed: number;
}

// Couleurs spirit-world tirées de la palette : crème lunaire (dominant),
// rose poudré, mint léger. Sélection aléatoire pondérée à l'init —
// dominante crème pour rester subtil.
const WISP_COLORS = [
  PALETTE.playerLocalPrimary, // crème (60%)
  PALETTE.playerLocalPrimary,
  PALETTE.playerLocalPrimary,
  PALETTE.shrineAccent,       // rose poudré (20%)
  PALETTE.mushroomGlow,       // mint spirit (20%)
];

export class AmbientWisps {
  public readonly object3d: THREE.Points;
  private geometry: THREE.BufferGeometry;
  private material: THREE.PointsMaterial;
  private wisps: Wisp[];
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  // Centre courant autour duquel les wisps respawn (= position joueur). Sans
  // ça, les wisps restent statiques au centre de la map et le joueur en
  // sort. On les garde toujours dans un anneau autour du joueur.
  private centerX = 0;
  private centerZ = 0;
  private readonly spawnRadius: number;
  private readonly despawnRadius: number;

  constructor(q: QualityConfig) {
    // Dimensionnement selon le preset. Volontairement modeste : trop de
    // wisps fatigue l'œil et concurrence la lecture du combat. On vise
    // "ambiance vivante en arrière-plan", pas "blizzard d'étoiles".
    const count =
      q.preset === "high" ? 80 :
      q.preset === "medium" ? 50 :
      q.preset === "low" ? 30 :
      18;

    this.spawnRadius = 70;   // rayon où on crée des wisps autour du joueur
    this.despawnRadius = 90; // au-delà, on respawn de l'autre côté

    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    this.sizes = new Float32Array(count);
    this.wisps = new Array(count);

    for (let i = 0; i < count; i++) {
      this.wisps[i] = this.createWisp();
      this.writeBuffer(i);
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("size", new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));

    this.material = new THREE.PointsMaterial({
      // Sprite par défaut Three.js (rond doux). Suffisant pour des points
      // de lumière diffus — pas besoin de texture custom.
      size: 0.6,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
      // Additif : les wisps "s'ajoutent" à la couleur derrière, ce qui
      // donne le côté lueur sans contour dur.
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.object3d = new THREE.Points(this.geometry, this.material);
    this.object3d.frustumCulled = false;
  }

  private createWisp(): Wisp {
    const colorHex = WISP_COLORS[Math.floor(Math.random() * WISP_COLORS.length)];
    const cr = ((colorHex >> 16) & 0xff) / 255;
    const cg = ((colorHex >> 8) & 0xff) / 255;
    const cb = (colorHex & 0xff) / 255;
    // Position aléatoire dans un disque autour du centre courant.
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * this.spawnRadius;
    const baseY = 1.5 + Math.random() * 4.5;
    return {
      x: this.centerX + Math.cos(angle) * r,
      y: baseY,
      z: this.centerZ + Math.sin(angle) * r,
      // Drift latéral très lent (0.1 à 0.4 u/s) — donne l'impression
      // que les wisps suivent un courant aérien plutôt qu'aller au hasard.
      vx: (Math.random() - 0.5) * 0.6,
      vz: (Math.random() - 0.5) * 0.6,
      cr, cg, cb,
      basePhase: Math.random() * Math.PI * 2,
      baseSize: 0.3 + Math.random() * 0.5,
      baseY,
      driftSpeed: 0.6 + Math.random() * 0.6,
    };
  }

  private writeBuffer(i: number): void {
    const w = this.wisps[i];
    this.positions[i * 3] = w.x;
    this.positions[i * 3 + 1] = w.y;
    this.positions[i * 3 + 2] = w.z;
    this.colors[i * 3] = w.cr;
    this.colors[i * 3 + 1] = w.cg;
    this.colors[i * 3 + 2] = w.cb;
    this.sizes[i] = w.baseSize;
  }

  // Appelé chaque frame avec la position du joueur local (centre de spawn)
  // et le temps écoulé. Met à jour positions + scintillement + respawn.
  update(playerX: number, playerZ: number, dt: number, elapsed: number): void {
    this.centerX = playerX;
    this.centerZ = playerZ;
    const despawnSq = this.despawnRadius * this.despawnRadius;

    for (let i = 0; i < this.wisps.length; i++) {
      const w = this.wisps[i];
      // Drift latéral.
      w.x += w.vx * dt;
      w.z += w.vz * dt;
      // Oscillation verticale autour de baseY (mouvement de respiration).
      w.y = w.baseY + Math.sin(elapsed * w.driftSpeed + w.basePhase) * 0.6;

      // Hors champ → respawn de l'autre côté du joueur. Pas de pop : on
      // place le wisp en bordure dans la direction inverse à sa sortie,
      // donc visuellement il "rentre" juste depuis l'horizon.
      const dx = w.x - this.centerX;
      const dz = w.z - this.centerZ;
      if (dx * dx + dz * dz > despawnSq) {
        const angle = Math.atan2(dz, dx) + Math.PI; // direction opposée
        const r = this.spawnRadius * (0.7 + Math.random() * 0.3);
        w.x = this.centerX + Math.cos(angle) * r;
        w.z = this.centerZ + Math.sin(angle) * r;
        w.baseY = 1.5 + Math.random() * 4.5;
        w.y = w.baseY;
      }

      // Clamp aux frontières de la map (pas au-delà du mur de mort).
      const distFromOrigin = Math.hypot(w.x, w.z);
      if (distFromOrigin > MAP_RADIUS) {
        const norm = MAP_RADIUS / distFromOrigin;
        w.x *= norm;
        w.z *= norm;
      }

      // Scintillement : taille + intensité couleur pulse à fréquence
      // individuelle. Un wisp peut "s'éteindre" temporairement (size→0.1)
      // puis revenir, ce qui donne le côté luciole vivante.
      const flick = 0.55 + 0.45 * Math.sin(elapsed * 1.4 + w.basePhase);
      this.positions[i * 3] = w.x;
      this.positions[i * 3 + 1] = w.y;
      this.positions[i * 3 + 2] = w.z;
      this.colors[i * 3] = w.cr * flick;
      this.colors[i * 3 + 1] = w.cg * flick;
      this.colors[i * 3 + 2] = w.cb * flick;
      this.sizes[i] = w.baseSize * (0.5 + flick * 0.5);
    }

    (this.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute("size") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
