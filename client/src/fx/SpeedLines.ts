import * as THREE from "three";
import { FxBudget } from "../quality";
import { fxIntensity } from "./flash";

// Lignes de vitesse au boost (tâche 4.9) : de fins traits parallèles au
// déplacement apparaissent devant et autour du joueur qui boost, puis
// filent vers l'arrière et s'effacent. Dans le monde et non sur l'écran :
// pas de passe plein écran (coûteuse sans post-FX), et on voit aussi qui
// d'autre boost (haute et moyenne qualité), ce qui aide à lire une menace
// qui fond sur soi. Traits orientés face à la caméra autour de leur axe :
// même largeur apparente quelle que soit la direction.

const VERT = /* glsl */ `
attribute vec3 aStart;
attribute vec3 aAxis;
attribute vec2 aParams;
attribute vec3 aColor;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec3 base = aStart + aAxis * position.x;
  // Ligne de longueur nulle (joueur à l'arrêt) : côté nul, quad plat, au
  // lieu de normaliser un vecteur nul (NaN).
  vec3 across = cross(aAxis, cameraPosition - base);
  vec3 side = across * inversesqrt(max(dot(across, across), 1e-12));
  vec3 p = base + side * position.y * aParams.y;
  vUv = position.xy;
  vAlpha = aParams.x;
  vColor = aColor;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

// Fondu aux deux bouts et sur les bords (pas de crénelage, même sans
// antialiasing).
const FRAG = /* glsl */ `
precision mediump float;
uniform float uIntensity;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
void main() {
  float a = vAlpha * uIntensity * sin(vUv.x * 3.14159) * (1.0 - abs(vUv.y));
  gl_FragColor = vec4(vColor, a);
  #include <colorspace_fragment>
}
`;

// Attributs par instance, envoyés pour les seules instances de la frame.
const INSTANCE_ATTRS = ["aStart", "aAxis", "aParams", "aColor"];

interface Line {
  x: number; y: number; z: number;
  // Direction (unité) et longueur.
  dx: number; dz: number;
  len: number;
  // Vitesse dans le monde (u/s), le long de la direction.
  speed: number;
  age: number;
  life: number;
  r: number; g: number; b: number;
}

interface Emitter {
  // Lignes à émettre (fraction reportée d'une frame à l'autre).
  carry: number;
  seen: boolean;
}

const LIFE_S = 0.24;
const HALF_WIDTH = 0.06;
const ALPHA = 0.6;

export class SpeedLines {
  readonly object: THREE.Mesh;
  private geometry: THREE.InstancedBufferGeometry;
  private material: THREE.ShaderMaterial;
  private starts: Float32Array;
  private axes: Float32Array;
  private params: Float32Array;
  private colors: Float32Array;
  private lines: Line[] = [];
  private pool: Line[] = [];
  private emitters = new Map<string, Emitter>();
  private readonly max: number;
  // Lignes émises par seconde, joueur local et autres (0 : aucune).
  private readonly localRate: number;
  private readonly remoteRate: number;
  private color = new THREE.Color();

  constructor(budget: FxBudget) {
    this.max = Math.max(1, budget.speedLines);
    this.localRate = budget.detail === "rich" ? 40 : budget.detail === "simple" ? 26 : 15;
    this.remoteRate = budget.detail === "rich" ? 16 : 0;
    const geo = new THREE.InstancedBufferGeometry();
    // Quadrilatère : x de 0 à 1 le long de l'axe, y de -1 à 1 en travers.
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.starts = new Float32Array(this.max * 3);
    this.axes = new Float32Array(this.max * 3);
    this.params = new Float32Array(this.max * 2);
    this.colors = new Float32Array(this.max * 3);
    geo.setAttribute("aStart", new THREE.InstancedBufferAttribute(this.starts, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aAxis", new THREE.InstancedBufferAttribute(this.axes, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aParams", new THREE.InstancedBufferAttribute(this.params, 2).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aColor", new THREE.InstancedBufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    geo.instanceCount = 0;
    this.geometry = geo;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uIntensity: { value: 1 } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      forceSinglePass: true,
    });
    this.object = new THREE.Mesh(geo, this.material);
    this.object.frustumCulled = false;
    this.object.matrixAutoUpdate = false;
    this.object.visible = false;
  }

  // Joueur qui boost à cette frame : position, direction du déplacement
  // (unité), vitesse (u/s), couleur. local : le joueur de ce client.
  track(key: string, x: number, z: number, dirX: number, dirZ: number, speed: number, color: number, local: boolean, dt: number): void {
    const rate = local ? this.localRate : this.remoteRate;
    if (rate <= 0) return;
    let e = this.emitters.get(key);
    if (!e) {
      e = { carry: 0, seen: false };
      this.emitters.set(key, e);
    }
    e.seen = true;
    e.carry += rate * dt;
    if (e.carry < 1) return;
    this.color.setHex(color);
    // Côté et avant du joueur (perpendiculaire à la direction, dans le sol).
    const sideX = -dirZ;
    const sideZ = dirX;
    while (e.carry >= 1) {
      e.carry -= 1;
      let l: Line;
      if (this.lines.length >= this.max) l = this.lines.shift()!;
      else l = this.pool.pop() ?? { x: 0, y: 0, z: 0, dx: 0, dz: 0, len: 0, speed: 0, age: 0, life: 1, r: 0, g: 0, b: 0 };
      const lateral = (0.8 + Math.random() * 1.8) * (Math.random() < 0.5 ? -1 : 1);
      const ahead = -0.5 + Math.random() * 3;
      l.x = x + sideX * lateral + dirX * ahead;
      l.y = 0.25 + Math.random() * 1.4;
      l.z = z + sideZ * lateral + dirZ * ahead;
      l.dx = dirX;
      l.dz = dirZ;
      l.len = (1.2 + Math.random() * 1.2) * Math.min(1.6, speed / 15);
      // Un peu emportée par le joueur : elle défile moins vite que lui.
      l.speed = speed * 0.35;
      l.age = 0;
      l.life = LIFE_S * (0.8 + Math.random() * 0.4);
      l.r = this.color.r; l.g = this.color.g; l.b = this.color.b;
      this.lines.push(l);
    }
  }

  // Préchauffage (CombatFx) : une ligne sous le sol.
  prime(): void {
    const l = this.pool.pop() ?? { x: 0, y: 0, z: 0, dx: 0, dz: 0, len: 0, speed: 0, age: 0, life: 1, r: 0, g: 0, b: 0 };
    l.x = 0; l.y = -10; l.z = 0; l.dx = 1; l.dz = 0; l.len = 0.1; l.speed = 0;
    l.age = 0; l.life = 0.2; l.r = 0; l.g = 0; l.b = 0;
    this.lines.push(l);
  }

  setFlashIntensity(k: number): void {
    this.material.uniforms.uIntensity.value = fxIntensity(k);
  }

  update(dt: number): void {
    // Émetteurs pas revus à cette frame : le joueur ne boost plus.
    for (const [key, e] of this.emitters) {
      if (!e.seen) this.emitters.delete(key);
      else e.seen = false;
    }
    let n = 0;
    let write = 0;
    for (let i = 0; i < this.lines.length; i++) {
      const l = this.lines[i];
      l.age += dt;
      if (l.age >= l.life) {
        this.pool.push(l);
        continue;
      }
      this.lines[write++] = l;
      l.x += l.dx * l.speed * dt;
      l.z += l.dz * l.speed * dt;
      const t = l.age / l.life;
      // La ligne part de sa queue (en arrière) et va vers l'avant.
      this.starts[n * 3] = l.x - l.dx * l.len;
      this.starts[n * 3 + 1] = l.y;
      this.starts[n * 3 + 2] = l.z - l.dz * l.len;
      this.axes[n * 3] = l.dx * l.len;
      this.axes[n * 3 + 1] = 0;
      this.axes[n * 3 + 2] = l.dz * l.len;
      this.params[n * 2] = ALPHA * Math.sin(t * Math.PI);
      this.params[n * 2 + 1] = HALF_WIDTH;
      this.colors[n * 3] = l.r;
      this.colors[n * 3 + 1] = l.g;
      this.colors[n * 3 + 2] = l.b;
      n++;
    }
    this.lines.length = write;
    this.object.visible = n > 0;
    if (n === 0) return;
    this.geometry.instanceCount = n;
    for (const name of INSTANCE_ATTRS) {
      const attr = this.geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
      attr.addUpdateRange(0, n * attr.itemSize);
      attr.needsUpdate = true;
    }
  }

  clear(): void {
    for (const l of this.lines) this.pool.push(l);
    this.lines.length = 0;
    this.emitters.clear();
    this.object.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
