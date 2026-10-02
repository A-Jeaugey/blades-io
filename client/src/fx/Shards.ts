import * as THREE from "three";
import { FLASH_COLOR } from "../themes/Theme";
import { FxBudget } from "../quality";

// Éclats d'une lame brisée (tâche 4.9) : quelques fragments à la couleur de
// sa rareté, projetés vers l'extérieur de l'orbite (le coup vient de là),
// qui tournoient, retombent et rétrécissent. Blancs l'espace d'un instant
// (réglage des flashs), petits et brefs : on ne les prend pas pour une lame
// au sol, plus grande, posée et immobile.

// Pointe vers +x, ~0,3 u : un tétraèdre effilé.
function shardGeometry(): THREE.BufferGeometry {
  const v = [
    [0.17, 0, 0],
    [-0.09, 0.05, 0],
    [-0.06, -0.03, 0.06],
    [-0.06, -0.03, -0.06],
  ];
  const faces = [[0, 1, 2], [0, 2, 3], [0, 3, 1], [1, 3, 2]];
  const pos: number[] = [];
  for (const f of faces) for (const i of f) pos.push(...v[i]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return geo;
}

const GRAVITY = 16;
const FLASH_S = 0.09;

interface Shard {
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  axis: THREE.Vector3;
  spin: number;
  angle: number;
  age: number;
  life: number;
  size: number;
  color: THREE.Color;
}

export class Shards {
  readonly object: THREE.InstancedMesh;
  private shards: Shard[] = [];
  private pool: Shard[] = [];
  private readonly max: number;
  private readonly perBlade: number;
  private flashK = 1;
  private white = new THREE.Color(FLASH_COLOR);
  private tmpColor = new THREE.Color();
  private tmpMat = new THREE.Matrix4();
  private tmpQuat = new THREE.Quaternion();
  private tmpPos = new THREE.Vector3();
  private tmpScale = new THREE.Vector3();

  constructor(budget: FxBudget) {
    this.max = Math.max(1, budget.shards);
    this.perBlade = budget.shardsPerBlade;
    // Matériau sans éclairage : la couleur de rareté telle quelle, comme
    // le corps lumineux des lames.
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.object = new THREE.InstancedMesh(shardGeometry(), mat, this.max);
    this.object.count = 0;
    this.object.frustumCulled = false;
    this.object.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Couleur par instance créée d'emblée : le shader l'inclut dès sa
    // compilation.
    this.object.setColorAt(0, this.white);
    this.object.instanceColor!.setUsage(THREE.DynamicDrawUsage);
  }

  // Lame brisée en (x, z) ; (dirX, dirZ) : direction de projection, du
  // centre de l'orbite vers la lame (nulle : au hasard).
  burst(x: number, z: number, color: number, dirX: number, dirZ: number, scale = 1): void {
    const len = Math.hypot(dirX, dirZ);
    const base = len > 1e-3 ? Math.atan2(dirZ, dirX) : Math.random() * Math.PI * 2;
    const spread = len > 1e-3 ? 1.7 : Math.PI * 2;
    for (let i = 0; i < this.perBlade; i++) {
      let s: Shard;
      if (this.shards.length >= this.max) s = this.shards.shift()!;
      else s = this.pool.pop() ?? {
        px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, axis: new THREE.Vector3(), spin: 0, angle: 0,
        age: 0, life: 1, size: 1, color: new THREE.Color(),
      };
      const a = base + (Math.random() - 0.5) * spread;
      const speed = 3.5 + Math.random() * 4;
      s.px = x; s.py = 0.9; s.pz = z;
      s.vx = Math.cos(a) * speed;
      s.vy = 1.5 + Math.random() * 2.8;
      s.vz = Math.sin(a) * speed;
      s.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      s.spin = 9 + Math.random() * 12;
      s.angle = Math.random() * Math.PI * 2;
      s.age = 0;
      s.life = 0.45 + Math.random() * 0.25;
      s.size = scale * (0.7 + Math.random() * 0.6);
      s.color.setHex(color);
      this.shards.push(s);
    }
  }

  // Préchauffage (CombatFx) : des éclats de taille nulle.
  prime(): void {
    this.burst(0, 0, 0x000000, 0, 0, 0);
  }

  setFlashIntensity(k: number): void {
    this.flashK = Math.max(0, Math.min(1, k));
  }

  update(dt: number): void {
    const mesh = this.object;
    let n = 0;
    let write = 0;
    for (let i = 0; i < this.shards.length; i++) {
      const s = this.shards[i];
      s.age += dt;
      if (s.age >= s.life) {
        this.pool.push(s);
        continue;
      }
      this.shards[write++] = s;
      s.vy -= GRAVITY * dt;
      s.px += s.vx * dt;
      s.py += s.vy * dt;
      s.pz += s.vz * dt;
      if (s.py < 0.04) {
        // Au sol : il glisse en ralentissant et cesse de tourner.
        s.py = 0.04;
        s.vy = 0;
        const f = Math.max(0, 1 - dt * 8);
        s.vx *= f;
        s.vz *= f;
        s.spin *= f;
      }
      s.angle += s.spin * dt;
      // Rétrécit sur le dernier tiers de sa vie.
      const t = s.age / s.life;
      const k = s.size * (t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35);
      this.tmpQuat.setFromAxisAngle(s.axis, s.angle);
      this.tmpMat.compose(this.tmpPos.set(s.px, s.py, s.pz), this.tmpQuat, this.tmpScale.set(k, k, k));
      mesh.setMatrixAt(n, this.tmpMat);
      // Blanc au premier instant (d'autant moins que les flashs sont
      // réduits), puis la couleur de la rareté.
      const w = s.age < FLASH_S ? (1 - s.age / FLASH_S) * this.flashK : 0;
      this.tmpColor.copy(s.color).lerp(this.white, w);
      mesh.setColorAt(n, this.tmpColor);
      n++;
    }
    this.shards.length = write;
    if (n === 0 && mesh.count === 0) return;
    mesh.count = n;
    if (n === 0) return;
    mesh.instanceMatrix.addUpdateRange(0, n * 16);
    mesh.instanceColor!.addUpdateRange(0, n * 3);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
  }

  clear(): void {
    for (const s of this.shards) this.pool.push(s);
    this.shards.length = 0;
    this.object.count = 0;
  }

  dispose(): void {
    this.object.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
    this.object.dispose();
  }
}
