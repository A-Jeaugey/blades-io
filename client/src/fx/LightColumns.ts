import * as THREE from "three";
import { FLASH_COLOR } from "../themes/Theme";
import { FxBudget } from "../quality";
import { fxIntensity } from "./flash";

// Colonne de lumière au passage de palier (tâche 4.9) : un faisceau jaillit
// du joueur, qu'il suit, puis s'amincit et s'éteint en moins d'une seconde.
// Courte (5 à 8 u) et éteinte vers le haut : le pilier de 15 u des
// power-ups barrait l'écran (constat GFX-03). Additive : le joueur et ses
// lames restent visibles au travers.
// Qualité : haute et moyenne, cœur plus clair et stries qui montent ;
// basse, gaine et cœur unis ; potato, la gaine seule, moins de facettes.

const VERT = /* glsl */ `
attribute float aAround;
attribute vec3 aCenter;
attribute vec4 aShape;
attribute vec3 aColor;
varying float vY;
varying float vAround;
varying float vFacing;
varying vec3 vColor;
varying float vAlpha;
varying float vPhase;
void main() {
  vec3 p = aCenter + vec3(position.x * aShape.x, position.y * aShape.y, position.z * aShape.x);
  // Face à la caméra (dans le plan du sol) : le cœur du faisceau ; de
  // profil : ses bords, plus pâles.
  vec2 toCam = normalize(cameraPosition.xz - p.xz);
  vFacing = abs(dot(normalize(position.xz), toCam));
  vY = position.y;
  vAround = aAround;
  vColor = aColor;
  vAlpha = aShape.z;
  vPhase = aShape.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
precision mediump float;
uniform float uIntensity;
varying float vY;
varying float vAround;
varying float vFacing;
varying vec3 vColor;
varying float vAlpha;
varying float vPhase;
void main() {
  float a = vAlpha * uIntensity * pow(vFacing, 1.6);
  // Plein au pied, éteint en haut.
  float top = 1.0 - vY;
  a *= top * top;
  #ifdef STREAKS
  // Stries qui montent, décalées d'une bande verticale à l'autre.
  float s = fract(vY * 2.5 - vPhase * 2.2 + floor(vAround * 7.0) * 0.37);
  a *= 0.6 + 0.8 * smoothstep(0.6, 1.0, s);
  #endif
  gl_FragColor = vec4(vColor, a);
  #include <colorspace_fragment>
}
`;

// Attributs par instance, envoyés pour les seules instances de la frame.
const INSTANCE_ATTRS = ["aCenter", "aShape", "aColor"];

interface Column {
  playerId: string;
  x: number; z: number;
  color: THREE.Color;
  core: THREE.Color;
  height: number;
  radius: number;
  // Opacité (0 : colonne de préchauffage).
  alpha: number;
  age: number;
}

const LIFE_S = 0.9;
const RISE_S = 0.14;

export class LightColumns {
  readonly object: THREE.Mesh;
  private geometry: THREE.InstancedBufferGeometry;
  private material: THREE.ShaderMaterial;
  private centers: Float32Array;
  private shapes: Float32Array;
  private colors: Float32Array;
  private columns: Column[] = [];
  private readonly max: number;
  private readonly withCore: boolean;
  private flashK = 1;
  private white = new THREE.Color(FLASH_COLOR);

  constructor(budget: FxBudget) {
    this.max = Math.max(1, budget.columns);
    const minimal = budget.detail === "minimal";
    this.withCore = !minimal;
    const seg = minimal ? 10 : budget.detail === "simple" ? 16 : 24;
    // Cylindre ouvert, rayon 1, de y = 0 à 1. Une colonne de sommets de
    // plus pour fermer le tour sans saut de aAround.
    const pos = new Float32Array((seg + 1) * 2 * 3);
    const around = new Float32Array((seg + 1) * 2);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      for (let k = 0; k < 2; k++) {
        const v = i * 2 + k;
        pos[v * 3] = Math.cos(a);
        pos[v * 3 + 1] = k;
        pos[v * 3 + 2] = Math.sin(a);
        around[v] = i / seg;
      }
    }
    const index: number[] = [];
    for (let i = 0; i < seg; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const instances = this.max * (this.withCore ? 2 : 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(index);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aAround", new THREE.BufferAttribute(around, 1));
    this.centers = new Float32Array(instances * 3);
    this.shapes = new Float32Array(instances * 4);
    this.colors = new Float32Array(instances * 3);
    geo.setAttribute("aCenter", new THREE.InstancedBufferAttribute(this.centers, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aShape", new THREE.InstancedBufferAttribute(this.shapes, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aColor", new THREE.InstancedBufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    geo.instanceCount = 0;
    this.geometry = geo;
    const defines: Record<string, string> = {};
    if (budget.detail === "rich") defines.STREAKS = "";
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      defines,
      uniforms: { uIntensity: { value: 1 } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      // Les deux faces en une passe : la paroi du fond s'ajoute à celle de
      // devant, le centre du faisceau est plus clair que ses bords.
      side: THREE.DoubleSide,
      forceSinglePass: true,
    });
    this.object = new THREE.Mesh(geo, this.material);
    this.object.frustumCulled = false;
    this.object.matrixAutoUpdate = false;
    this.object.visible = false;
  }

  // Palier atteint par playerId, en (x, z). tier : nouveau palier (la
  // colonne grandit avec lui).
  spawn(playerId: string, x: number, z: number, tier: number, color: number): void {
    // Un même joueur ne garde qu'une colonne (paliers enchaînés).
    let c = this.columns.find((o) => o.playerId === playerId);
    if (!c) {
      if (this.columns.length >= this.max) c = this.columns.shift()!;
      else c = { playerId, x, z, color: new THREE.Color(), core: new THREE.Color(), height: 0, radius: 0, alpha: 1, age: 0 };
      this.columns.push(c);
    }
    c.playerId = playerId;
    c.x = x;
    c.z = z;
    c.color.setHex(color);
    c.core.setHex(color).lerp(this.white, 0.45 * this.flashK);
    c.height = 5 + Math.min(tier, 5) * 0.6;
    c.radius = 0.9 + Math.min(tier, 5) * 0.08;
    c.alpha = 1;
    c.age = 0;
  }

  // Préchauffage (CombatFx) : une colonne transparente.
  prime(): void {
    this.spawn("", 0, 0, 0, 0x000000);
    this.columns[this.columns.length - 1].alpha = 0;
  }

  setFlashIntensity(k: number): void {
    this.flashK = Math.max(0, Math.min(1, k));
    this.material.uniforms.uIntensity.value = fxIntensity(k);
  }

  // posOf : position de rendu d'un joueur (la colonne le suit), undefined
  // s'il n'est plus affiché (elle reste là où il était).
  update(dt: number, posOf: (id: string) => { x: number; z: number } | undefined): void {
    let n = 0;
    let write = 0;
    for (let i = 0; i < this.columns.length; i++) {
      const c = this.columns[i];
      c.age += dt;
      if (c.age >= LIFE_S) continue;
      this.columns[write++] = c;
      const at = posOf(c.playerId);
      if (at) {
        c.x = at.x;
        c.z = at.z;
      }
      const t = c.age / LIFE_S;
      // Jaillit (hauteur pleine en RISE_S), s'élargit puis s'amincit.
      const rise = Math.min(1, c.age / RISE_S);
      const h = c.height * (1 - (1 - rise) * (1 - rise));
      const r = c.radius * (c.age < RISE_S ? 0.4 + 0.6 * rise : 1 - 0.65 * (c.age - RISE_S) / (LIFE_S - RISE_S));
      const a = c.alpha * (t < 0.08 ? t / 0.08 : Math.pow(1 - (t - 0.08) / 0.92, 1.3));
      n = this.write(n, c.x, c.z, r, h, 0.5 * a, c.age, c.color);
      if (this.withCore) n = this.write(n, c.x, c.z, r * 0.35, h * 1.05, 0.7 * a, c.age + 0.5, c.core);
    }
    this.columns.length = write;
    this.object.visible = n > 0;
    if (n === 0) return;
    this.geometry.instanceCount = n;
    for (const name of INSTANCE_ATTRS) {
      const attr = this.geometry.getAttribute(name) as THREE.InstancedBufferAttribute;
      attr.addUpdateRange(0, n * attr.itemSize);
      attr.needsUpdate = true;
    }
  }

  private write(n: number, x: number, z: number, r: number, h: number, alpha: number, phase: number, color: THREE.Color): number {
    this.centers[n * 3] = x;
    this.centers[n * 3 + 1] = 0;
    this.centers[n * 3 + 2] = z;
    this.shapes[n * 4] = r;
    this.shapes[n * 4 + 1] = h;
    this.shapes[n * 4 + 2] = alpha;
    this.shapes[n * 4 + 3] = phase;
    this.colors[n * 3] = color.r;
    this.colors[n * 3 + 1] = color.g;
    this.colors[n * 3 + 2] = color.b;
    return n + 1;
  }

  clear(): void {
    this.columns.length = 0;
    this.object.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
