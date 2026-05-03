import * as THREE from "three";
import { MAP_RADIUS } from "@bladeio/shared";
import { QualityConfig } from "../quality";
import { getActiveTheme } from "../themes";

// ─────────────────────────────────────────────────────────────────────────────
// AmbientWisps — particules d'âme en suspension permanente.
//
// Activé/désactivé par theme.ambient.wisps : si null (cas neon), le système
// est inerte (objet vide ajouté à la scène, update() no-op). Si configuré,
// drift continu autour du joueur local avec respawn aux bords + scintillement.
// ─────────────────────────────────────────────────────────────────────────────

interface Wisp {
  x: number; y: number; z: number;
  vx: number; vz: number;
  cr: number; cg: number; cb: number;
  basePhase: number;
  baseSize: number;
  baseY: number;
  driftSpeed: number;
}

export class AmbientWisps {
  public readonly object3d: THREE.Object3D;
  private active: boolean;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.PointsMaterial | null = null;
  private wisps: Wisp[] = [];
  private positions: Float32Array | null = null;
  private colors: Float32Array | null = null;
  private sizes: Float32Array | null = null;
  private centerX = 0;
  private centerZ = 0;
  private spawnRadius = 70;
  private despawnRadius = 90;
  private wispColors: number[] = [];

  constructor(q: QualityConfig) {
    const theme = getActiveTheme();
    const config = theme.ambient.wisps;
    if (!config) {
      // Thème sans wisps : objet placeholder vide. On n'alloue rien, update()
      // sort tôt. Permet à main.ts d'ajouter inconditionnellement
      // wisps.object3d à la scène sans se soucier du thème.
      this.active = false;
      this.object3d = new THREE.Object3D();
      return;
    }
    this.active = true;
    this.wispColors = config.colors;
    const count =
      q.preset === "high" ? config.counts.high :
      q.preset === "medium" ? config.counts.medium :
      q.preset === "low" ? config.counts.low :
      config.counts.ultra;

    this.positions = new Float32Array(count * 3);
    this.colors = new Float32Array(count * 3);
    this.sizes = new Float32Array(count);
    this.wisps = new Array(count);

    for (let i = 0; i < count; i++) {
      this.wisps[i] = this.createWisp(config.drifSpeedMin, config.drifSpeedMax);
      this.writeBuffer(i);
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("size", new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));

    this.material = new THREE.PointsMaterial({
      size: 0.6,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(this.geometry, this.material);
    points.frustumCulled = false;
    this.object3d = points;
  }

  private createWisp(speedMin: number, speedMax: number): Wisp {
    const colorHex = this.wispColors[Math.floor(Math.random() * this.wispColors.length)];
    const cr = ((colorHex >> 16) & 0xff) / 255;
    const cg = ((colorHex >> 8) & 0xff) / 255;
    const cb = (colorHex & 0xff) / 255;
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * this.spawnRadius;
    const baseY = 1.5 + Math.random() * 4.5;
    return {
      x: this.centerX + Math.cos(angle) * r,
      y: baseY,
      z: this.centerZ + Math.sin(angle) * r,
      vx: (Math.random() - 0.5) * 0.6,
      vz: (Math.random() - 0.5) * 0.6,
      cr, cg, cb,
      basePhase: Math.random() * Math.PI * 2,
      baseSize: 0.3 + Math.random() * 0.5,
      baseY,
      driftSpeed: speedMin + Math.random() * (speedMax - speedMin),
    };
  }

  private writeBuffer(i: number): void {
    if (!this.positions || !this.colors || !this.sizes) return;
    const w = this.wisps[i];
    this.positions[i * 3] = w.x;
    this.positions[i * 3 + 1] = w.y;
    this.positions[i * 3 + 2] = w.z;
    this.colors[i * 3] = w.cr;
    this.colors[i * 3 + 1] = w.cg;
    this.colors[i * 3 + 2] = w.cb;
    this.sizes[i] = w.baseSize;
  }

  update(playerX: number, playerZ: number, dt: number, elapsed: number): void {
    if (!this.active || !this.positions || !this.colors || !this.sizes || !this.geometry) return;
    this.centerX = playerX;
    this.centerZ = playerZ;
    const despawnSq = this.despawnRadius * this.despawnRadius;

    for (let i = 0; i < this.wisps.length; i++) {
      const w = this.wisps[i];
      w.x += w.vx * dt;
      w.z += w.vz * dt;
      w.y = w.baseY + Math.sin(elapsed * w.driftSpeed + w.basePhase) * 0.6;

      const dx = w.x - this.centerX;
      const dz = w.z - this.centerZ;
      if (dx * dx + dz * dz > despawnSq) {
        const angle = Math.atan2(dz, dx) + Math.PI;
        const r = this.spawnRadius * (0.7 + Math.random() * 0.3);
        w.x = this.centerX + Math.cos(angle) * r;
        w.z = this.centerZ + Math.sin(angle) * r;
        w.baseY = 1.5 + Math.random() * 4.5;
        w.y = w.baseY;
      }

      const distFromOrigin = Math.hypot(w.x, w.z);
      if (distFromOrigin > MAP_RADIUS) {
        const norm = MAP_RADIUS / distFromOrigin;
        w.x *= norm;
        w.z *= norm;
      }

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
    this.geometry?.dispose();
    this.material?.dispose();
  }
}
