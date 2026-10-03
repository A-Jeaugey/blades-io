import * as THREE from "three";
import { BUSHES } from "@bladeio/shared";
import { QualityConfig } from "../quality";
import { DecorVariant } from "../themes";
import { scalePointsWithViewport } from "./renderScale";

// Buissons (tâche 4.7). Ils cachent joueurs et lames aux autres : règle du
// serveur (tâche 2.4), le client n'en reçoit rien. Ici, leur visuel, qui
// doit se lire de loin comme une cachette :
//   cyber  : « Glitch Field », dôme bas presque opaque parcouru de lignes
//            de balayage, de blocs de pixels corrompus et de tranches qui se
//            décalent ; halo au sol qui pulse ; pixels qui montent.
//   spirit : voile de brume chatoyant, cercle au sol, lucioles, autour des
//            champignons (Decor.ts).
// Le dôme devient transparent pour qui est dedans : on s'y voit soi-même.
// Pulsations, scintillements et décalages suivent le réglage des flashs.
// Qualité : haute, tout ; moyenne, dôme sans corruption ni décalage et
// moitié moins de particules ; basse (matériaux simples), dôme uni ;
// potato, dôme et halo fixes, sans particules.

export interface BushField {
  object: THREE.Object3D;
  update(t: number): void;
  // Buisson du joueur local (-1 : aucun).
  setInside(index: number): void;
  setFlashIntensity(k: number): void;
  // Couleur des rafales à l'entrée et à la sortie d'un buisson.
  readonly burstColor: number;
  dispose(): void;
}

// Hauteur du dôme, en part du rayon : bas, on voit par-dessus.
const DOME_HEIGHT = 0.55;
// Opacité vu de dehors, et de dedans.
const DOME_ALPHA = 0.74;
const DOME_ALPHA_INSIDE = 0.18;

const DOME_VERT = /* glsl */ `
  attribute float aSeed;
  attribute float aInside;
  // Même précision que dans le fragment (mediump) : un uniform partagé par
  // les deux étapes avec deux précisions fait échouer le lien du programme.
  uniform mediump float uTime;
  uniform mediump float uFlash;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  varying float vHeight;
  varying float vAround;
  varying float vSeed;
  varying float vInside;
  void main() {
    vec3 p = position;
    #ifdef GLITCH
    // Par moments, une tranche horizontale se décale (déplacement).
    float slice = floor(p.y * 7.0);
    float tick = floor(uTime * 7.0 + aSeed * 13.0);
    float h = fract(sin(dot(vec2(slice, tick), vec2(12.9898, 78.233))) * 43758.5453);
    p.x += step(0.94, h) * (h - 0.94) * 2.5 * uFlash;
    #endif
    vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
    vNormalW = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    vViewDir = normalize(cameraPosition - wp.xyz);
    vHeight = position.y;
    // Tour du dôme, de 0 à 1 : la coordonnée u de la sphère, les mêmes
    // valeurs que atan(z, x), qui n'est pas défini au pôle (x = z = 0).
    vAround = 1.0 - uv.x;
    vSeed = aSeed;
    vInside = aInside;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const DOME_FRAG = /* glsl */ `
  precision mediump float;
  uniform vec3 uBase;
  uniform vec3 uGlow;
  uniform float uTime;
  uniform float uFlash;
  uniform float uAlpha;
  uniform float uAlphaInside;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  varying float vHeight;
  varying float vAround;
  varying float vSeed;
  varying float vInside;
  void main() {
    // Sans pow() : le produit scalaire de deux vecteurs normalisés dépasse
    // parfois 1 d'un rien, et pow() d'un négatif donne NaN (Direct3D).
    float rim = 1.0 - min(abs(dot(normalize(vNormalW), normalize(vViewDir))), 1.0);
    float fres = rim * rim;
    float light = fres * 0.8;
    #ifdef GLITCH
    // Lignes de balayage qui montent.
    light += smoothstep(0.8, 1.0, fract(vHeight * 9.0 - uTime * 0.8 + vSeed)) * 0.35;
    // Blocs de pixels corrompus, tirés par bloc et par instant.
    vec2 cell = floor(vec2(vAround * 32.0, vHeight * 8.0));
    float n = fract(sin(dot(cell + floor(uTime * 6.0 + vSeed * 7.0), vec2(127.1, 311.7))) * 43758.5453);
    float corrupt = step(0.965, n) * uFlash;
    light += corrupt * 0.9;
    // Double frange au bord : la couleur se dédouble (aberration).
    light += (smoothstep(0.5, 0.7, fres) - 0.5 * smoothstep(0.75, 0.95, fres)) * 0.3;
    #endif
    #ifdef SHIMMER
    // Voile : bandes lentes qui ondulent.
    light += (0.5 + 0.5 * sin(vAround * 37.7 + vHeight * 6.0 - uTime * (0.6 + 0.4 * uFlash))) * 0.18;
    #endif
    #ifdef SCANLINES
    light += smoothstep(0.85, 1.0, fract(vHeight * 6.0 - uTime * 0.4 + vSeed)) * 0.2;
    #endif
    // Un peu de l'accent partout : le dôme se lit sur un sol sombre.
    vec3 col = mix(uBase, uGlow, clamp(0.12 + light, 0.0, 1.0));
    float a = mix(uAlpha, uAlphaInside, vInside) * (0.85 + 0.15 * fres);
    #ifdef GLITCH
    a = max(a, corrupt * mix(0.9, 0.4, vInside));
    #endif
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

export function createBushField(q: QualityConfig, v: DecorVariant): BushField {
  const group = new THREE.Group();
  const disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  const cyber = v.kind === "cyber";
  const detail = q.decorDetail;
  const base = cyber ? v.bushFoliage : v.mossColor;
  const glow = cyber ? v.bushAccent : v.mushroomUnderglow;
  const ringColor = cyber ? v.bushAccent : v.shrineHalo;
  const particleColor = cyber ? v.bushAccent : v.lanternEmissive;
  const time: THREE.IUniform = { value: 0 };
  const flash: THREE.IUniform = { value: 1 };
  const n = BUSHES.length;
  const tmpM = new THREE.Matrix4();
  const tmpP = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3();

  // --- Dôme ---
  const seg = detail === "rich" ? 28 : detail === "simple" ? 18 : 12;
  const rings = detail === "rich" ? 10 : detail === "simple" ? 6 : 4;
  const domeGeo = new THREE.SphereGeometry(1, seg, rings, 0, Math.PI * 2, 0, Math.PI / 2);
  const seeds = new Float32Array(n);
  const inside = new Float32Array(n);
  for (let i = 0; i < n; i++) seeds[i] = (i * 0.618) % 1;
  domeGeo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
  const insideAttr = new THREE.InstancedBufferAttribute(inside, 1);
  insideAttr.setUsage(THREE.DynamicDrawUsage);
  domeGeo.setAttribute("aInside", insideAttr);
  let domeMat: THREE.Material;
  // Dôme uni en basse qualité et en potato : sur les petits GPU, c'est le
  // remplissage d'un grand volume translucide qui coûte.
  const flatDome = detail === "minimal" || q.simpleMaterials;
  if (flatDome) {
    // Couleur unie, le joueur dedans fait disparaître son dôme.
    domeMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(base).lerp(new THREE.Color(glow), 0.25),
      transparent: true,
      opacity: DOME_ALPHA,
      depthWrite: false,
    });
  } else {
    const defines: Record<string, string> = {};
    if (!cyber) defines.SHIMMER = "";
    else if (detail === "rich") defines.GLITCH = "";
    else defines.SCANLINES = "";
    domeMat = new THREE.ShaderMaterial({
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      defines,
      uniforms: {
        uBase: { value: new THREE.Color(base) },
        uGlow: { value: new THREE.Color(glow) },
        uTime: time,
        uFlash: flash,
        uAlpha: { value: DOME_ALPHA },
        uAlphaInside: { value: DOME_ALPHA_INSIDE },
      },
      transparent: true,
      depthWrite: false,
    });
  }
  disposables.push(domeGeo, domeMat);
  const dome = new THREE.InstancedMesh(domeGeo, domeMat, n);
  const setDome = (i: number, hidden: boolean): void => {
    const b = BUSHES[i];
    const r = hidden ? 0 : b.radius;
    tmpM.compose(tmpP.set(b.x, 0, b.y), tmpQ.identity(), tmpS.set(r, r * DOME_HEIGHT, r));
    dome.setMatrixAt(i, tmpM);
  };
  for (let i = 0; i < n; i++) setDome(i, false);
  dome.instanceMatrix.needsUpdate = true;
  dome.matrixAutoUpdate = false;
  dome.frustumCulled = false;
  dome.renderOrder = 2;
  group.add(dome);

  // --- Halo au sol ---
  const ringGeo = new THREE.RingGeometry(0.96, 1.05, detail === "minimal" ? 32 : 48);
  // Face avant seulement : vu d'en haut, et une passe au lieu de deux
  // (three.js dessine deux fois un objet translucide à double face).
  const ringMat = new THREE.MeshBasicMaterial({
    color: ringColor,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  disposables.push(ringGeo, ringMat);
  const halo = new THREE.InstancedMesh(ringGeo, ringMat, n);
  const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  for (let i = 0; i < n; i++) {
    const b = BUSHES[i];
    tmpM.compose(tmpP.set(b.x, 0.05, b.y), flat, tmpS.set(b.radius, b.radius, 1));
    halo.setMatrixAt(i, tmpM);
  }
  halo.instanceMatrix.needsUpdate = true;
  halo.matrixAutoUpdate = false;
  halo.frustumCulled = false;
  group.add(halo);

  // --- Particules qui montent (pixels en cyber, lucioles en spirit) ---
  const perBush = detail === "rich" ? 8 : detail === "simple" ? 4 : 0;
  if (perBush > 0) {
    const count = n * perBush;
    const pos = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const b = BUSHES[i];
      for (let j = 0; j < perBush; j++) {
        // Répartition fixe (spirale) : rien de tiré au hasard côté rendu.
        const a = (j / perBush) * Math.PI * 2 + i * 1.3;
        const r = b.radius * (0.25 + 0.55 * ((j * 0.618 + i * 0.37) % 1));
        pos[k * 3] = b.x + Math.cos(a) * r;
        pos[k * 3 + 1] = 0.2;
        pos[k * 3 + 2] = b.y + Math.sin(a) * r;
        phase[k] = (j * 0.381 + i * 0.173) % 1;
        k++;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    const mat = new THREE.PointsMaterial({
      color: particleColor,
      size: cyber ? 0.3 : 0.26,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const drift = cyber
      ? ""
      : "transformed.x += sin(uTime * 0.7 + aPhase * 6.2831) * 0.4;\ntransformed.z += cos(uTime * 0.6 + aPhase * 4.0) * 0.4;";
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = shader.vertexShader
        .replace("void main() {", "attribute float aPhase;\nuniform float uTime;\nvarying float vFade;\nvoid main() {")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          float tt = fract(uTime * 0.22 + aPhase);
          transformed.y += tt * 3.2;
          ${drift}
          vFade = sin(tt * 3.14159);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", "varying float vFade;\nvoid main() {")
        .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.a *= vFade;");
    };
    mat.customProgramCacheKey = () => `bush-particles:${cyber}`;
    disposables.push(geo, mat);
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    scalePointsWithViewport(points, mat);
    points.matrixAutoUpdate = false;
    group.add(points);
  }

  group.matrixAutoUpdate = false;
  let current = -1;
  let flashK = 1;

  return {
    object: group,
    burstColor: particleColor,
    update(t: number) {
      time.value = t;
      if (detail !== "minimal") ringMat.opacity = 0.32 + 0.18 * flashK * (0.5 + 0.5 * Math.sin(t * 2.2));
    },
    setInside(index: number) {
      if (index === current) return;
      const prev = current;
      current = index;
      if (flatDome) {
        if (prev >= 0) setDome(prev, false);
        if (index >= 0) setDome(index, true);
        dome.instanceMatrix.needsUpdate = true;
        return;
      }
      if (prev >= 0) inside[prev] = 0;
      if (index >= 0) inside[index] = 1;
      insideAttr.needsUpdate = true;
    },
    setFlashIntensity(k: number) {
      flashK = Math.max(0, Math.min(1, k));
      flash.value = flashK;
    },
    dispose() {
      group.parent?.remove(group);
      for (const d of disposables) d.dispose();
    },
  };
}
