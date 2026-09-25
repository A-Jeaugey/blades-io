import * as THREE from "three";
import { THROW_PROJECTILE_HITBOX, THROW_PROJECTILE_MAX_RANGE, outerOrbitRadius } from "@bladeio/shared";
import { getActiveTheme } from "../themes";

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Tirets qui défilent vers l'extérieur (la direction se lit d'un coup
// d'œil), largeur adoucie, fondu le long de la portée et trait plein sur
// les derniers 0,6 u : c'est là que la lame retombe si elle ne touche rien.
const FRAG = /* glsl */ `
  precision mediump float;
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uLength;
  varying vec2 vUv;
  void main() {
    float along = vUv.x * uLength;
    float dash = step(0.4, fract(along / 1.25 - uTime * 1.8));
    float fade = mix(1.0, 0.3, smoothstep(0.3, 1.0, vUv.x));
    float cap = step(uLength - 0.6, along) * 0.8;
    float edge = 1.0 - smoothstep(0.2, 0.5, abs(vUv.y - 0.5));
    gl_FragColor = vec4(uColor, max(dash * fade, cap) * edge * uOpacity);
  }
`;

const WIDTH = 0.32;
// Vitesse du fondu d'apparition (1/s) : ~80 ms.
const FADE_RATE = 12;

// Indicateur de visée au sol du joueur local (tâche 1.3) : trajectoire du
// prochain lancer, du point de départ du projectile (bord de l'orbite)
// jusqu'à sa portée maximale. Un seul quad, même rendu à tous les niveaux
// de qualité.
export class AimIndicator {
  readonly object: THREE.Mesh;
  private readonly uniforms: {
    uColor: THREE.IUniform<THREE.Color>;
    uOpacity: THREE.IUniform<number>;
    uTime: THREE.IUniform<number>;
    uLength: THREE.IUniform<number>;
  };
  private opacity = 0;

  constructor() {
    // Quad couché sur le sol, de x = 0 à x = 1 : l'échelle x donne la
    // longueur, la rotation y la direction.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([
      0, 0, -0.5, 1, 0, -0.5, 1, 0, 0.5, 0, 0, 0.5,
    ], 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geometry.setIndex([0, 2, 1, 0, 3, 2]);
    this.uniforms = {
      uColor: { value: new THREE.Color(getActiveTheme().palette.playerLocal.accent) },
      uOpacity: { value: 0 },
      uTime: { value: 0 },
      uLength: { value: THROW_PROJECTILE_MAX_RANGE },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.object = new THREE.Mesh(geometry, material);
    this.object.scale.set(THROW_PROJECTILE_MAX_RANGE, 1, WIDTH);
    this.object.frustumCulled = false;
    this.object.renderOrder = 2;
    this.object.visible = false;
  }

  // opacity : cible (0 = caché). Position au sol du joueur telle que
  // dessinée ; direction normalisée ; lames pour le rayon de départ.
  update(
    dt: number,
    time: number,
    x: number,
    y: number,
    dirX: number,
    dirY: number,
    bladeCount: number,
    opacity: number,
  ): void {
    const k = 1 - Math.exp(-dt * FADE_RATE);
    this.opacity += (opacity - this.opacity) * k;
    if (opacity === 0 && this.opacity < 0.01) this.opacity = 0;
    this.object.visible = this.opacity > 0;
    if (!this.object.visible) return;
    // Même départ que le projectile côté serveur (processThrows).
    const startR = outerOrbitRadius(bladeCount) + THROW_PROJECTILE_HITBOX + 0.1;
    this.object.position.set(x + dirX * startR, 0.05, y + dirY * startR);
    this.object.rotation.y = -Math.atan2(dirY, dirX);
    this.uniforms.uOpacity.value = this.opacity;
    this.uniforms.uTime.value = time;
  }
}
