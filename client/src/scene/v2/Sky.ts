import * as THREE from "three";
import { getActiveTheme } from "../../themes";

// Ciel du rendu v2 : une nuit de ville, calculée dans le fragment shader
// d'après la seule direction du regard. Dégradé du zénith à la lueur de la
// ville sur l'horizon, nuages éclairés par dessous, lune et son halo,
// étoiles, et deux rangs d'immeubles lointains aux fenêtres allumées.
//
// Le même ciel sert deux fois :
//  - à l'écran, derrière tout le reste (dôme centré sur la caméra qui
//    dessine, la vraie comme celle du reflet des flaques) ;
//  - en carte d'environnement (buildEnvironment) : c'est lui qui éclaire les
//    matériaux (lumière ambiante qui dépend de l'orientation, au lieu d'un
//    aplat) et qui se reflète dans le métal, les vitres et le sol mouillé.
//
// Toutes les couleurs viennent du thème (fond, brouillard, lumière
// principale, néons du décor).

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    // Rotation de la caméra seule : le dôme est toujours centré sur elle,
    // quelle que soit la caméra qui dessine. Profondeur au plan lointain :
    // dessiné après les objets opaques, il ne coûte que les pixels de ciel.
    vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
    gl_Position = p.xyww;
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uMoon;
  uniform vec3 uMoonDir;
  uniform vec3 uLightA;
  uniform vec3 uLightB;
  uniform float uTime;
  uniform float uGain;
  varying vec3 vDir;

  float sHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float sNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(sHash(i), sHash(i + vec2(1.0, 0.0)), f.x),
               mix(sHash(i + vec2(0.0, 1.0)), sHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float sFbm(vec2 p) {
    float a = 0.5;
    float s = 0.0;
    for (int k = 0; k < 4; k++) {
      s += a * sNoise(p);
      p = p * 2.03 + 17.0;
      a *= 0.5;
    }
    return s;
  }

  // Un rang d'immeubles lointains : az en tours (0 à 1), elev = tangente de
  // la hauteur au-dessus de l'horizon. Rend (lumière des fenêtres, présence,
  // tirage de l'immeuble pour sa teinte).
  vec3 skyline(float az, float elev, float count, float maxH, float seed) {
    float u = az * count;
    float id = floor(u);
    float fx = fract(u);
    float r = sHash(vec2(id, seed));
    float r2 = sHash(vec2(id, seed + 7.0));
    float width = 0.5 + 0.5 * r2;
    float height = maxH * (0.22 + 0.78 * r * r);
    float inside = step(abs(fx - 0.5), width * 0.5) * step(elev, height);
    // Fenêtres : une grille par immeuble, une case sur quatre allumée.
    vec2 w = vec2((fx - 0.5) / width * (3.0 + floor(r2 * 5.0)), elev * 110.0);
    vec2 wi = floor(w);
    vec2 wf = fract(w);
    float lit = step(0.74, sHash(wi + vec2(id * 13.0, seed)));
    lit *= step(0.22, wf.x) * step(wf.x, 0.78) * step(0.3, wf.y) * step(wf.y, 0.75);
    return vec3(lit * (0.4 + 0.6 * sHash(wi + 3.0)), inside, r2);
  }

  void main() {
    // vDir est un point de la sphère : jamais nul.
    vec3 d = normalize(vDir);
    float up = d.y;
    float h = max(up, 0.0);
    float haze = exp(-h * 5.5);
    vec3 col = mix(uZenith, uHorizon, haze);

    // Nuages : un plafond projeté, éclairé par la ville (plus clair vers
    // l'horizon), qui dérive lentement.
    vec2 cp = d.xz / (h + 0.22);
    float cl = sFbm(cp * 1.3 + vec2(uTime * 0.012, uTime * 0.004));
    float cloud = smoothstep(0.42, 0.78, cl) * smoothstep(-0.02, 0.18, up);
    col = mix(col, uHorizon * (0.5 + 0.6 * haze) + uZenith * 0.6, cloud * 0.75);

    // Étoiles, entre les nuages, loin de l'horizon.
    vec2 sc = d.xz / (h + 0.35) * 70.0;
    float star = step(0.994, sHash(floor(sc))) * (1.0 - cloud) * smoothstep(0.12, 0.45, up);
    col += uMoon * star * 0.5 * (0.6 + 0.4 * sin(uTime * 2.0 + sHash(floor(sc) + 5.0) * 40.0));

    // Lune : disque, halo serré, lueur large (carrés successifs, pas pow()).
    float md = max(dot(d, uMoonDir), 0.0);
    float g2 = md * md;
    float g8 = g2 * g2 * g2 * g2;
    float g64 = g8 * g8 * g8 * g8 * g8 * g8 * g8 * g8;
    float disc = smoothstep(0.99905, 0.9994, md);
    col += uMoon * (disc * 2.6 * (1.0 - 0.85 * cloud) + g64 * g64 * 0.22 + g8 * 0.035);

    // Ville lointaine : deux rangs, le plus loin noyé dans la brume. atan()
    // n'est appelé que loin de la verticale (d.xz non nul).
    if (up < 0.5 && up > -0.02) {
      float az = atan(d.z, d.x) / 6.2831853 + 0.5;
      float elev = up / max(length(d.xz), 1e-3);
      vec3 far = skyline(az, elev, 110.0, 0.2, 3.0);
      vec3 near = skyline(az + 0.37, elev, 64.0, 0.34, 21.0);
      vec3 body = uZenith * 0.55;
      vec3 farCol = mix(body, uHorizon, 0.72) + mix(uLightA, uLightB, far.z) * far.x * 0.35;
      vec3 nearCol = mix(body, uHorizon, 0.42) + mix(uLightB, uLightA, near.z) * near.x * 0.7;
      col = mix(col, farCol, far.y);
      col = mix(col, nearCol, near.y);
    }

    // Sous l'horizon : la brume du sol.
    col = mix(uHorizon * 0.55, col, smoothstep(-0.06, 0.0, up));
    gl_FragColor = vec4(col * uGain, 1.0);
    #include <colorspace_fragment>
  }
`;

interface SkyColors {
  zenith: THREE.Color;
  horizon: THREE.Color;
  moon: THREE.Color;
  lightA: THREE.Color;
  lightB: THREE.Color;
}

// Une couleur tirée vers son gris (même luminance). Le brouillard d'un thème
// est une teinte franche, faite pour un fond uni ; étalée sur tout un ciel
// et sur tout ce qu'il éclaire, elle noyait la scène dans une seule couleur.
// Une brume de nuit est presque grise, à peine teintée : les couleurs
// viennent alors des lumières (enseignes, vitrines), pas de l'air.
export function muted(c: THREE.Color, amount: number): THREE.Color {
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return c.clone().lerp(new THREE.Color(l, l, l), amount);
}

function skyColors(): SkyColors {
  const theme = getActiveTheme();
  const decor = theme.decor;
  const fog = new THREE.Color(theme.palette.fogColor);
  const neon = new THREE.Color(decor.structureNeon);
  // Lueur de la ville sur l'horizon : le brouillard du thème, tiré vers ses
  // néons et relevé. C'est aussi la couleur du brouillard de la scène, pour
  // que le lointain se fonde dans le ciel.
  const horizon = muted(fog.clone().lerp(neon, 0.12), 0.84).multiplyScalar(2.1);
  return {
    zenith: muted(new THREE.Color(theme.palette.clearColor).lerp(fog, 0.35), 0.7),
    horizon,
    moon: new THREE.Color(theme.lighting.key.color),
    lightA: new THREE.Color(decor.structureScreen).lerp(new THREE.Color(1, 1, 1), 0.45),
    lightB: new THREE.Color(decor.shrineHalo).lerp(new THREE.Color(1, 1, 1), 0.45),
  };
}

function skyMaterial(colors: SkyColors, moonDir: THREE.Vector3, gain: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: colors.zenith },
      uHorizon: { value: colors.horizon },
      uMoon: { value: colors.moon },
      uMoonDir: { value: moonDir },
      uLightA: { value: colors.lightA },
      uLightB: { value: colors.lightB },
      uTime: { value: 0 },
      uGain: { value: gain },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

export interface SkyHandle {
  mesh: THREE.Mesh;
  // Couleur du lointain : celle du brouillard de la scène.
  horizon: THREE.Color;
  update(t: number): void;
}

export function createSky(moonDir: THREE.Vector3): SkyHandle {
  const colors = skyColors();
  const mat = skyMaterial(colors, moonDir, 1);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  // Après tout ce qui est opaque : là où quelque chose est déjà dessiné, le
  // test de profondeur écarte le ciel avant son shader.
  mesh.renderOrder = 1000;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return {
    mesh,
    horizon: colors.horizon,
    update(t) {
      mat.uniforms.uTime.value = t;
    },
  };
}

// Lumière que le ciel donne aux matériaux, rapportée à ce qu'on en voit :
// une nuit fidèle n'éclairerait presque rien (la lumière ambiante d'origine
// du thème vaut bien plus), et le jeu doit rester lisible.
const ENV_SKY_GAIN = 2.6;
// Enseignes et vitrines de la ville dans les reflets : quelques panneaux
// lumineux bas sur l'horizon. Sans eux, le métal et les flaques ne
// renverraient qu'un ciel uni.
const ENV_SIGNS = 14;
const ENV_SIGN_GAIN = 5;

// Carte d'environnement (préfiltrée par niveaux de rugosité) tirée du ciel.
// Une fois, au démarrage : quelques dizaines de millisecondes au lobby.
export function buildEnvironment(renderer: THREE.WebGLRenderer, moonDir: THREE.Vector3): THREE.Texture {
  const theme = getActiveTheme();
  const decor = theme.decor;
  const colors = skyColors();
  const scene = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMaterial(colors, moonDir, ENV_SKY_GAIN));
  sky.frustumCulled = false;
  scene.add(sky);
  // Le sol, vu d'en dessous des objets : sombre, à la couleur du thème.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(60, 24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.ground.colors.base).multiplyScalar(1.5) }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.2;
  scene.add(ground);
  const signColors = [decor.structureNeon, decor.structureScreen, decor.shrineHalo, decor.obeliskOuter, decor.structureLed];
  const signGeo = new THREE.PlaneGeometry(1, 1);
  for (let i = 0; i < ENV_SIGNS; i++) {
    const a = (i / ENV_SIGNS) * Math.PI * 2 + (i % 3) * 0.21;
    const dist = 16 + (i % 4) * 5;
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(signColors[i % signColors.length]).multiplyScalar(ENV_SIGN_GAIN * (0.6 + (i % 5) * 0.2)),
      side: THREE.DoubleSide,
    });
    const sign = new THREE.Mesh(signGeo, mat);
    sign.position.set(Math.cos(a) * dist, 1.5 + (i % 5) * 1.6, Math.sin(a) * dist);
    sign.scale.set(3 + (i % 3) * 2.5, 1 + (i % 2) * 1.4, 1);
    sign.lookAt(0, sign.position.y, 0);
    scene.add(sign);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0, 0.1, 200);
  pmrem.dispose();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
  });
  return target.texture;
}
