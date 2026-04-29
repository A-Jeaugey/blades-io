import * as THREE from "three";

interface Particle {
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  life: number;
  maxLife: number;
  // Couleur stockée en R,G,B [0,1]. Pas d'objet THREE.Color (alloc) — on
  // garde des floats plats pour zéro GC pression.
  cr: number; cg: number; cb: number;
  size: number;
}

// Pool de particules : un Points unique avec BufferGeometry dynamique.
// Optimisations :
//  - particleScale (0..1) atténue le count des bursts (utile en low/ultra).
//  - allocations 0 par spawn (on réutilise une pool d'objets pré-allouée).
export class ParticlePool {
  private geometry: THREE.BufferGeometry;
  private material: THREE.PointsMaterial;
  private points: THREE.Points;
  private particles: Particle[] = [];
  private pool: Particle[] = [];
  private maxParticles: number;
  private particleScale: number;
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;

  constructor(maxParticles = 800, particleScale = 1.0) {
    this.maxParticles = maxParticles;
    this.particleScale = particleScale;
    this.positions = new Float32Array(maxParticles * 3);
    this.colors = new Float32Array(maxParticles * 3);
    this.sizes = new Float32Array(maxParticles);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("size", new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));

    this.material = new THREE.PointsMaterial({
      size: 0.25,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;

    // Pré-alloue la pool d'objets pour éviter `new` par spawn.
    for (let i = 0; i < maxParticles; i++) {
      this.pool.push({
        px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 0, cr: 0, cg: 0, cb: 0, size: 0,
      });
    }
  }

  get object3d(): THREE.Object3D {
    return this.points;
  }

  spawnSparks(x: number, y: number, z: number, color: number, count: number, speed = 4): void {
    // Atténue le count selon le preset. On garantit au moins 1 si le burst
    // d'origine en demandait au moins 1 (sinon les "petits effets" type
    // pickup local disparaîtraient totalement).
    const scaled = Math.max(count > 0 ? 1 : 0, Math.round(count * this.particleScale));
    const cr = ((color >> 16) & 0xff) / 255;
    const cg = ((color >> 8) & 0xff) / 255;
    const cb = (color & 0xff) / 255;
    for (let i = 0; i < scaled; i++) {
      let p: Particle;
      if (this.particles.length >= this.maxParticles) {
        // Pool pleine : on récupère le plus ancien (shift) et on le réutilise.
        p = this.particles.shift()!;
      } else if (this.pool.length > 0) {
        p = this.pool.pop()!;
      } else {
        p = { px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 0, cr: 0, cg: 0, cb: 0, size: 0 };
      }
      const a = Math.random() * Math.PI * 2;
      const elev = (Math.random() - 0.3) * 1.5;
      const s = speed * (0.5 + Math.random());
      p.px = x; p.py = y; p.pz = z;
      p.vx = Math.cos(a) * s;
      p.vy = elev;
      p.vz = Math.sin(a) * s;
      p.life = 0.4 + Math.random() * 0.2;
      p.maxLife = 0.6;
      p.cr = cr; p.cg = cg; p.cb = cb;
      p.size = 0.2 + Math.random() * 0.15;
      this.particles.push(p);
    }
  }

  spawnExplosion(x: number, y: number, z: number, color: number, count: number): void {
    this.spawnSparks(x, y, z, color, count, 6);
  }

  update(dt: number): void {
    let write = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        // Recycle dans la pool.
        this.pool.push(p);
        continue;
      }
      p.px += p.vx * dt;
      p.py += p.vy * dt;
      p.pz += p.vz * dt;
      p.vy -= 9 * dt * 0.3;
      const damp = 1 - dt * 1.5;
      p.vx *= damp;
      p.vy *= damp;
      p.vz *= damp;
      if (write !== i) this.particles[write] = p;
      write++;
    }
    this.particles.length = write;

    const n = Math.min(this.particles.length, this.maxParticles);
    if (n === 0 && this.geometry.drawRange.count === 0) return;

    for (let i = 0; i < n; i++) {
      const p = this.particles[i];
      this.positions[i * 3] = p.px;
      this.positions[i * 3 + 1] = p.py;
      this.positions[i * 3 + 2] = p.pz;
      const lf = p.life > 0 ? p.life / p.maxLife : 0;
      this.colors[i * 3] = p.cr * lf;
      this.colors[i * 3 + 1] = p.cg * lf;
      this.colors[i * 3 + 2] = p.cb * lf;
      this.sizes[i] = p.size * lf;
    }
    this.geometry.setDrawRange(0, n);
    (this.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute("size") as THREE.BufferAttribute).needsUpdate = true;
  }
}
