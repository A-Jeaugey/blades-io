import * as THREE from "three";
import { QualityConfig } from "../../quality";
import { ThemeWeather } from "../../themes";

// Météo du rendu v2 : pluie (traits), neige ou braises (points), dans un
// volume qui suit le point visé par la caméra. Tout se calcule dans le
// vertex shader (position de départ tirée une fois, vitesse, repli dans le
// volume) : rien n'est mis à jour par particule côté CPU.
//
// Lisibilité : de la lumière additive très faible, sans écriture de
// profondeur ; la couleur vient du thème (ambient.weather.color), que
// check:themes tient à l'écart des raretés comme les autres particules
// d'ambiance.

// Volume (u) : large comme la plus grande vue (caméra reculée), haut de
// quelques étages.
const BOX = new THREE.Vector3(84, 24, 84);

interface WeatherSpec {
  // Particules en qualité haute ; moitié en moyenne.
  count: number;
  // Vitesse (u/s) : y négatif, ça tombe.
  velocity: [number, number, number];
  // Traits : longueur (u). Points : 0.
  streak: number;
  // Points : taille au sol (u).
  size: number;
  // Dérive latérale (u) et son rythme (rad/s).
  wobble: number;
  wobbleRate: number;
  opacity: number;
}

const SPECS: Record<ThemeWeather["kind"], WeatherSpec> = {
  rain: { count: 1500, velocity: [-4, -42, 3], streak: 1.7, size: 0, wobble: 0, wobbleRate: 0, opacity: 0.2 },
  snow: { count: 900, velocity: [-1.2, -3.2, 0.8], streak: 0, size: 0.26, wobble: 0.9, wobbleRate: 0.8, opacity: 0.5 },
  embers: { count: 420, velocity: [0.6, 2.6, -0.4], streak: 0, size: 0.2, wobble: 0.7, wobbleRate: 1.3, opacity: 0.75 },
};

const WEATHER_VERT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCenter;
  uniform vec3 uBox;
  uniform vec3 uVel;
  uniform vec3 uDir;
  uniform float uStreak;
  uniform float uWobble;
  uniform float uWobbleRate;
  uniform float uPointScale;
  attribute vec3 aSeed;
  attribute float aEnd;
  varying float vAlpha;
  void main() {
    // Chaque particule a son allure (aSeed.y resservi : 0,7 à 1,3).
    float pace = 0.7 + 0.6 * fract(aSeed.y * 7.31);
    vec3 p = aSeed * uBox + uVel * (uTime * pace);
    p.x += sin(uTime * uWobbleRate + aSeed.z * 40.0) * uWobble;
    p.z += cos(uTime * uWobbleRate * 0.8 + aSeed.x * 40.0) * uWobble;
    // Repli dans le volume centré sur le point visé (au sol : y de 0 à uBox.y).
    vec3 c = vec3(uCenter.x, uBox.y * 0.5, uCenter.z);
    vec3 q = mod(p - c, uBox) - 0.5 * uBox;
    // Fondu aux bords du volume : pas d'apparition sèche.
    vec2 edge = 1.0 - abs(q.xz) / (0.5 * uBox.xz);
    vAlpha = clamp(min(edge.x, edge.y) * 6.0, 0.0, 1.0) * (1.0 - 0.6 * aEnd);
    vec3 world = q + c - uDir * (uStreak * aEnd);
    vec4 mv = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uPointScale / max(-mv.z, 0.1);
  }
`;

const WEATHER_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uRound;
  varying float vAlpha;
  void main() {
    // Points : disque doux. Traits : uRound = 0, rien à découper.
    vec2 d = gl_PointCoord - 0.5;
    float disc = 1.0 - smoothstep(0.1, 0.5, length(d));
    float a = vAlpha * uOpacity * mix(1.0, disc, uRound);
    gl_FragColor = vec4(uColor * a, 1.0);
    #include <colorspace_fragment>
  }
`;

export interface WeatherHandle {
  object: THREE.Object3D;
  // t : temps (s) ; (cx, cz) : point visé par la caméra.
  update(t: number, cx: number, cz: number): void;
}

export function createWeather(q: QualityConfig, weather: ThemeWeather): WeatherHandle {
  const spec = SPECS[weather.kind];
  const lines = spec.streak > 0;
  const count = Math.round(spec.count * (q.preset === "high" ? 1 : 0.5));
  const perItem = lines ? 2 : 1;
  const seeds = new Float32Array(count * perItem * 3);
  const ends = new Float32Array(count * perItem);
  for (let i = 0; i < count; i++) {
    const sx = Math.random();
    const sy = Math.random();
    const sz = Math.random();
    for (let k = 0; k < perItem; k++) {
      const o = (i * perItem + k) * 3;
      seeds[o] = sx;
      seeds[o + 1] = sy;
      seeds[o + 2] = sz;
      ends[i * perItem + k] = k;
    }
  }
  const geo = new THREE.BufferGeometry();
  // three.js exige un attribut position ; le shader ne lit que aSeed.
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * perItem * 3), 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 3));
  geo.setAttribute("aEnd", new THREE.BufferAttribute(ends, 1));

  const vel = new THREE.Vector3(...spec.velocity);
  const uniforms = {
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector3() },
    uBox: { value: BOX },
    uVel: { value: vel },
    uDir: { value: vel.clone().normalize() },
    uStreak: { value: spec.streak },
    uWobble: { value: spec.wobble },
    uWobbleRate: { value: spec.wobbleRate },
    uPointScale: { value: 1 },
    uColor: { value: new THREE.Color(weather.color) },
    uOpacity: { value: spec.opacity },
    uRound: { value: lines ? 0 : 1 },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: WEATHER_VERT,
    fragmentShader: WEATHER_FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const object = lines ? new THREE.LineSegments(geo, mat) : new THREE.Points(geo, mat);
  // Les positions sont calculées par le shader : la boîte englobante de la
  // géométrie ne dit rien.
  object.frustumCulled = false;
  object.matrixAutoUpdate = false;
  if (!lines) {
    // Taille d'un point en pixels à 1 u de distance : sa taille au sol, la
    // demi-hauteur de la partie dessinée de la cible (résolution dynamique
    // comprise) et le champ de la caméra (terme vertical de sa projection) :
    // la même à l'écran dans les deux cadrages.
    const size = new THREE.Vector2();
    object.onBeforeRender = (renderer, _scene, camera) => {
      const target = renderer.getRenderTarget();
      const height = target ? target.viewport.w : renderer.getDrawingBufferSize(size).y;
      uniforms.uPointScale.value = spec.size * height * 0.5 * camera.projectionMatrix.elements[5];
    };
  }
  return {
    object,
    update(t: number, cx: number, cz: number) {
      uniforms.uTime.value = t;
      uniforms.uCenter.value.set(cx, 0, cz);
    },
  };
}
