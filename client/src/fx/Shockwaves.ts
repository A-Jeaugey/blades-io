import * as THREE from "three";
import { FxBudget } from "../quality";
import { fxIntensity } from "./flash";

// Ondes de choc (tâche 4.9) : un anneau qui s'élargit et s'éteint. Aux
// clashs, petit et bref, à hauteur des lames ; aux éliminations, large et
// au sol ; au passage de palier, au pied de la colonne de lumière.
// Une seule géométrie instanciée pour toutes : une couronne dont le shader
// place les deux bords d'après le rayon courant, si bien que seuls les
// pixels de l'anneau sont dessinés (un disque texturé remplirait tout son
// intérieur pour rien, le coût qui compte sur les petits GPU).

export interface WaveSpec {
  radius: number;   // rayon final (u)
  width: number;    // épaisseur du front au départ (u)
  alpha: number;    // opacité au départ
  duration: number; // s
}

// Front à l'extérieur, épaisseur vers l'intérieur.
const VERT = /* glsl */ `
attribute float aSide;
attribute vec3 aCenter;
attribute vec3 aShape;
attribute vec3 aColor;
varying float vSide;
varying vec3 vColor;
varying float vAlpha;
#include <fog_pars_vertex>
void main() {
  float r = max(0.0, aShape.x - aShape.y * (1.0 - aSide));
  vec3 p = aCenter + vec3(position.x * r, 0.0, position.z * r);
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vSide = aSide;
  vColor = aColor;
  vAlpha = aShape.z;
  #include <fog_vertex>
}
`;

// Profil à travers l'anneau : nul au bord intérieur, maximal vers 80 % de
// l'épaisseur, nul au bord extérieur (pas de crénelage). En mélange
// additif, le brouillard éteint l'onde au lieu de la teinter.
const FRAG = /* glsl */ `
precision mediump float;
uniform float uIntensity;
varying float vSide;
varying vec3 vColor;
varying float vAlpha;
#include <fog_pars_fragment>
void main() {
  float a = vAlpha * uIntensity * 1.4 * vSide * vSide * (1.0 - smoothstep(0.8, 1.0, vSide));
  #ifdef USE_FOG
    a *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor = vec4(vColor, a);
  #include <colorspace_fragment>
}
`;

// Attributs par instance, envoyés pour les seules instances de la frame.
const INSTANCE_ATTRS = ["aCenter", "aShape", "aColor"];

interface Wave {
  x: number; y: number; z: number;
  r: number; g: number; b: number;
  radius: number; width: number; alpha: number; duration: number;
  // Négatif tant que l'onde n'a pas commencé (seconde onde, retardée).
  age: number;
}

export class Shockwaves {
  readonly object: THREE.Mesh;
  private geometry: THREE.InstancedBufferGeometry;
  private material: THREE.ShaderMaterial;
  private centers: Float32Array;
  private shapes: Float32Array;
  private colors: Float32Array;
  private waves: Wave[] = [];
  private pool: Wave[] = [];
  private readonly max: number;
  private color = new THREE.Color();

  constructor(budget: FxBudget) {
    this.max = Math.max(1, budget.shockwaves);
    const seg = budget.ringSegments;
    // Deux sommets par facette : bord intérieur (aSide 0) et extérieur (1),
    // sur le cercle unité ; triangles tournés vers le haut (face avant vue
    // d'au-dessus, une seule passe).
    const pos = new Float32Array((seg + 1) * 2 * 3);
    const side = new Float32Array((seg + 1) * 2);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      for (let k = 0; k < 2; k++) {
        const v = i * 2 + k;
        pos[v * 3] = Math.cos(a);
        pos[v * 3 + 2] = Math.sin(a);
        side[v] = k;
      }
    }
    const index: number[] = [];
    for (let i = 0; i < seg; i++) {
      const a = i * 2;
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(index);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
    this.centers = new Float32Array(this.max * 3);
    this.shapes = new Float32Array(this.max * 3);
    this.colors = new Float32Array(this.max * 3);
    geo.setAttribute("aCenter", new THREE.InstancedBufferAttribute(this.centers, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aShape", new THREE.InstancedBufferAttribute(this.shapes, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aColor", new THREE.InstancedBufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    geo.instanceCount = 0;
    this.geometry = geo;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uIntensity: { value: 1 } }]),
      fog: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.object = new THREE.Mesh(geo, this.material);
    // Les sommets sont placés par le shader : la sphère englobante de la
    // couronne unité ne dit rien de l'étendue réelle.
    this.object.frustumCulled = false;
    this.object.matrixAutoUpdate = false;
    this.object.visible = false;
  }

  // Une onde centrée en (x, y, z). delay : départ retardé (s).
  spawn(x: number, y: number, z: number, color: number, spec: WaveSpec, delay = 0): void {
    let w: Wave;
    if (this.waves.length >= this.max) w = this.waves.shift()!;
    else w = this.pool.pop() ?? { x: 0, y: 0, z: 0, r: 0, g: 0, b: 0, radius: 0, width: 0, alpha: 0, duration: 1, age: 0 };
    this.color.setHex(color);
    w.x = x; w.y = y; w.z = z;
    w.r = this.color.r; w.g = this.color.g; w.b = this.color.b;
    w.radius = spec.radius; w.width = spec.width; w.alpha = spec.alpha; w.duration = spec.duration;
    w.age = -delay;
    this.waves.push(w);
  }

  // Préchauffage (CombatFx) : une onde invisible, sous le sol.
  prime(): void {
    this.spawn(0, -10, 0, 0x000000, { radius: 0.01, width: 0.01, alpha: 0, duration: 0.2 });
  }

  setFlashIntensity(k: number): void {
    this.material.uniforms.uIntensity.value = fxIntensity(k);
  }

  update(dt: number): void {
    let n = 0;
    let write = 0;
    for (let i = 0; i < this.waves.length; i++) {
      const w = this.waves[i];
      w.age += dt;
      if (w.age >= w.duration) {
        this.pool.push(w);
        continue;
      }
      this.waves[write++] = w;
      if (w.age < 0) continue;
      const t = w.age / w.duration;
      // Départ rapide puis ralenti (le souffle s'essouffle), front qui
      // s'amincit, extinction progressive.
      const grow = 1 - (1 - t) * (1 - t) * (1 - t);
      const o = n * 3;
      this.centers[o] = w.x; this.centers[o + 1] = w.y; this.centers[o + 2] = w.z;
      this.shapes[o] = w.radius * (0.15 + 0.85 * grow);
      this.shapes[o + 1] = w.width * (1 - 0.4 * t);
      this.shapes[o + 2] = w.alpha * Math.pow(1 - t, 1.6);
      this.colors[o] = w.r; this.colors[o + 1] = w.g; this.colors[o + 2] = w.b;
      n++;
    }
    this.waves.length = write;
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
    for (const w of this.waves) this.pool.push(w);
    this.waves.length = 0;
    this.object.visible = false;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
