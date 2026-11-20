import * as THREE from "three";
import {
  AGENT_FX_SNARED,
  AgentEffect,
  TRAP_RADIUS,
  ZoneKind,
  agentFxBit,
  outerOrbitRadius,
} from "@bladeio/shared";
import type { QualityConfig } from "../quality";
import { AGENT_FX } from "./looks";

// Effets des capacités d'agent dans la scène (docs/AGENTS.md) : les zones
// reçues du serveur (nuages de Brume, pièges et puits de Vortex) et les
// auras des joueurs (Surtension, Rafale, Égide, Bastion, Éclipse, ralenti).
// Le préavis de l'Onde de Vigie reprend celui des obélisques (PulseView),
// ses éclats et l'anneau du Sonar les ondes de CombatFx.
//
// Lisibilité : des formes (nuage, anneau, spirale, coque) qu'on ne peut pas
// prendre pour une lame ; rien d'opaque sur un joueur (la coque d'Égide est
// une lueur au bord, transparente au centre). Tout est créé d'avance, dans
// la scène dès le lobby (caché, ou à zéro instance) : les shaders passent
// au préchauffage, rien ne se compile ni ne s'alloue en partie.

export interface ZoneLike {
  kind: number;
  x: number;
  y: number;
  radius: number;
  startsAt: number;
  endsAt: number;
}

export interface AuraSource {
  x: number;
  z: number;
  fx: number;
  bladeCount: number;
}

const SMOKE_SLOTS = 8;
const TRAP_SLOTS = 8;
const WELL_SLOTS = 4;
const AURA_MAX = 48;
// Apparition et dissipation d'un nuage (ms).
const SMOKE_FADE_IN = 300;
const SMOKE_FADE_OUT = 700;

const SMOKE_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vView;
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    vN = normalMatrix * normal;
    gl_Position = projectionMatrix * mv;
  }
`;

// Nuage : dense au centre de la vue, effiloché au bord (le bord d'une
// sphère vue de face), remué par un bruit qui dérive. Longueurs testées :
// jamais de normalize() d'un vecteur nul.
const SMOKE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uCore;
  uniform float uOpacity;
  uniform float uTime;
  varying vec3 vN;
  varying vec3 vView;
  varying vec3 vLocal;
  float sHash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }
  float sNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(sHash(i), sHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(sHash(i + vec3(0.0, 1.0, 0.0)), sHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(sHash(i + vec3(0.0, 0.0, 1.0)), sHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(sHash(i + vec3(0.0, 1.0, 1.0)), sHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }
  void main() {
    float nl = length(vN);
    float vl = length(vView);
    float facing = nl > 1e-5 && vl > 1e-5 ? abs(dot(vN, vView)) / (nl * vl) : 0.0;
    float n = sNoise(vLocal * 2.2 + vec3(uTime * 0.25, uTime * 0.1, -uTime * 0.2));
    float a = facing * facing * (0.55 + 0.45 * n) * uOpacity;
    gl_FragColor = vec4(mix(uColor, uCore, facing * n), a);
    #include <colorspace_fragment>
  }
`;

const WELL_VERT = /* glsl */ `
  varying vec2 vUv2;
  void main() {
    vUv2 = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Puits : cœur sombre, spirale claire qui tourne vers le centre. vUv2 :
// position sur le disque (rayon 1). atan() n'est lu qu'hors du centre.
const WELL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uCore;
  uniform float uTime;
  uniform float uActive;
  uniform float uOpacity;
  varying vec2 vUv2;
  void main() {
    float r = length(vUv2);
    if (r > 1.0) discard;
    float ang = r > 1e-3 ? atan(vUv2.y, vUv2.x) : 0.0;
    float swirl = 0.5 + 0.5 * sin(ang * 3.0 + r * 9.0 + uTime * 5.0);
    float arms = smoothstep(0.55, 1.0, swirl) * smoothstep(1.0, 0.25, r) * uActive;
    float rim = smoothstep(0.9, 0.99, r) * smoothstep(1.0, 0.985, r);
    float core = smoothstep(0.55, 0.0, r);
    vec3 col = mix(uColor, uCore, core);
    float a = (0.18 * uActive + core * 0.45 * uActive + arms * 0.5 + rim * 0.9) * uOpacity;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

const SHELL_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vView;
  varying vec3 vTint;
  void main() {
    vec4 p = vec4(position, 1.0);
    vec3 n = normal;
    #ifdef USE_INSTANCING
      p = instanceMatrix * p;
      n = mat3(instanceMatrix) * n;
    #endif
    #ifdef USE_INSTANCING_COLOR
      vTint = instanceColor;
    #else
      vTint = vec3(1.0);
    #endif
    vec4 mv = modelViewMatrix * p;
    vView = -mv.xyz;
    vN = normalMatrix * n;
    gl_Position = projectionMatrix * mv;
  }
`;

// Coque d'Égide et de Bastion : une lueur au bord seulement (Fresnel), le
// centre reste transparent : l'orbite et le joueur se lisent à travers.
const SHELL_FRAG = /* glsl */ `
  varying vec3 vN;
  varying vec3 vView;
  varying vec3 vTint;
  void main() {
    float nl = length(vN);
    float vl = length(vView);
    float facing = nl > 1e-5 && vl > 1e-5 ? abs(dot(vN, vView)) / (nl * vl) : 1.0;
    float edge = 1.0 - facing;
    float a = edge * edge * edge;
    gl_FragColor = vec4(vTint * a, 1.0);
    #include <colorspace_fragment>
  }
`;

interface SmokeSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  floor: THREE.Mesh;
  floorMat: THREE.MeshBasicMaterial;
}

interface WellSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}

interface TrapSlot {
  group: THREE.Group;
  mat: THREE.MeshBasicMaterial;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

export class AbilityView {
  readonly root = new THREE.Group();
  private readonly smokes: SmokeSlot[] = [];
  private readonly wells: WellSlot[] = [];
  private readonly traps: TrapSlot[] = [];
  // Auras : coques (Égide, Bastion, Éclipse), anneaux (Surtension, Rafale,
  // ralenti).
  private readonly shells: THREE.InstancedMesh;
  private readonly rings: THREE.InstancedMesh;
  private readonly rich: boolean;
  private time = 0;
  private flash = 1;

  constructor(q: QualityConfig) {
    this.rich = q.decorDetail === "rich";
    const seg = q.decorDetail === "minimal" ? 12 : 20;
    const smokeGeo = new THREE.SphereGeometry(1, seg, Math.max(8, seg >> 1));
    const floorGeo = new THREE.CircleGeometry(1, 40);
    floorGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < SMOKE_SLOTS; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(AGENT_FX.smoke) },
          uCore: { value: new THREE.Color(AGENT_FX.smokeCore) },
          uOpacity: { value: 0 },
          uTime: { value: 0 },
        },
        vertexShader: SMOKE_VERT,
        fragmentShader: SMOKE_FRAG,
        transparent: true,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(smokeGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      const floorMat = new THREE.MeshBasicMaterial({ color: AGENT_FX.smoke, transparent: true, opacity: 0, depthWrite: false });
      const floor = new THREE.Mesh(floorGeo, floorMat);
      floor.visible = false;
      this.root.add(mesh, floor);
      this.smokes.push({ mesh, mat, floor, floorMat });
    }
    const wellGeo = new THREE.CircleGeometry(1, 48);
    for (let i = 0; i < WELL_SLOTS; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(AGENT_FX.well) },
          uCore: { value: new THREE.Color(AGENT_FX.wellCore) },
          uTime: { value: 0 },
          uActive: { value: 0 },
          uOpacity: { value: 1 },
        },
        vertexShader: WELL_VERT,
        fragmentShader: WELL_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(wellGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.08;
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      this.wells.push({ mesh, mat });
    }
    // Piège : un anneau et quatre crocs, à plat (vu de son poseur et de ses
    // alliés seulement : le serveur ne l'envoie qu'à eux).
    const trapRing = new THREE.RingGeometry(TRAP_RADIUS * 0.82, TRAP_RADIUS, 32);
    const tooth = new THREE.RingGeometry(TRAP_RADIUS * 0.35, TRAP_RADIUS * 0.75, 3, 1, 0, Math.PI / 6);
    for (let i = 0; i < TRAP_SLOTS; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: AGENT_FX.trap, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
      const group = new THREE.Group();
      group.rotation.x = -Math.PI / 2;
      group.position.y = 0.06;
      group.add(new THREE.Mesh(trapRing, mat));
      for (let k = 0; k < 4; k++) {
        const m = new THREE.Mesh(tooth, mat);
        m.rotation.z = (k * Math.PI) / 2;
        group.add(m);
      }
      group.visible = false;
      this.root.add(group);
      this.traps.push({ group, mat });
    }
    const shellGeo = new THREE.SphereGeometry(1, seg, Math.max(8, seg >> 1));
    const shellMat = new THREE.ShaderMaterial({
      vertexShader: SHELL_VERT,
      fragmentShader: SHELL_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.shells = new THREE.InstancedMesh(shellGeo, shellMat, AURA_MAX);
    this.shells.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(AURA_MAX * 3), 3);
    this.shells.count = 0;
    this.shells.frustumCulled = false;
    const ringGeo = new THREE.TorusGeometry(1, 0.035, 4, 40);
    ringGeo.rotateX(Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.rings = new THREE.InstancedMesh(ringGeo, ringMat, AURA_MAX * 2);
    this.rings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(AURA_MAX * 6), 3);
    this.rings.count = 0;
    this.rings.frustumCulled = false;
    this.root.add(this.shells, this.rings);
  }

  // Réglage des flashs (accessibilité) : les auras qui pulsent s'atténuent.
  setFlashIntensity(k: number): void {
    this.flash = Math.max(0.35, k);
  }

  // Zones visibles par ce client, à l'heure du serveur. (viewerX, viewerZ) :
  // le joueur local, dans une fumée qu'il ne doit pas perdre de vue.
  updateZones(zones: Iterable<ZoneLike>, serverNow: number, dt: number, viewerX = Infinity, viewerZ = Infinity): void {
    this.time += dt;
    let s = 0;
    let w = 0;
    let tr = 0;
    for (const z of zones) {
      if (z.kind === ZoneKind.Smoke && s < SMOKE_SLOTS) {
        const slot = this.smokes[s++];
        const fadeIn = Math.min(1, Math.max(0, serverNow - z.startsAt) / SMOKE_FADE_IN);
        const fadeOut = Math.min(1, Math.max(0, z.endsAt - serverNow) / SMOKE_FADE_OUT);
        // Au cœur de la fumée, le joueur local la voit à 35 % : il se voit
        // dedans, les autres ne le voient pas.
        const inside = Math.hypot(viewerX - z.x, viewerZ - z.y) / Math.max(0.1, z.radius);
        const clear = 1 - 0.65 * Math.min(1, Math.max(0, (1.05 - inside) / 0.35));
        const k = fadeIn * fadeOut * clear;
        slot.mesh.visible = slot.floor.visible = k > 0.001;
        slot.mesh.position.set(z.x, z.radius * 0.18, z.y);
        slot.mesh.scale.set(z.radius, z.radius * 0.55, z.radius);
        slot.mat.uniforms.uOpacity.value = 0.62 * k;
        slot.mat.uniforms.uTime.value = this.time;
        slot.floor.position.set(z.x, 0.05, z.y);
        slot.floor.scale.setScalar(z.radius);
        slot.floorMat.opacity = 0.22 * k;
      } else if (z.kind === ZoneKind.Well && w < WELL_SLOTS) {
        const slot = this.wells[w++];
        const active = serverNow >= z.startsAt;
        slot.mesh.visible = serverNow < z.endsAt;
        slot.mesh.position.set(z.x, 0.08, z.y);
        // Préavis : le bord grandit jusqu'au rayon ; puis la spirale.
        const grow = active ? 1 : Math.min(1, Math.max(0.15, 1 - (z.startsAt - serverNow) / 500));
        slot.mesh.scale.setScalar(z.radius * grow);
        slot.mat.uniforms.uActive.value = active ? 1 : 0;
        slot.mat.uniforms.uTime.value = this.time;
        slot.mat.uniforms.uOpacity.value = Math.min(1, Math.max(0, z.endsAt - serverNow) / 300);
      } else if (z.kind === ZoneKind.Trap && tr < TRAP_SLOTS) {
        const slot = this.traps[tr++];
        const armed = serverNow >= z.startsAt;
        slot.group.visible = true;
        slot.group.position.set(z.x, 0.06, z.y);
        slot.mat.opacity = armed ? 0.45 + 0.25 * (0.5 + 0.5 * Math.sin(this.time * 4)) * this.flash : 0.22;
      }
    }
    for (; s < SMOKE_SLOTS; s++) this.smokes[s].mesh.visible = this.smokes[s].floor.visible = false;
    for (; w < WELL_SLOTS; w++) this.wells[w].mesh.visible = false;
    for (; tr < TRAP_SLOTS; tr++) this.traps[tr].group.visible = false;
  }

  // Auras des joueurs visibles (agentFx de chacun).
  updateAuras(players: Iterable<AuraSource>): void {
    let shells = 0;
    let rings = 0;
    const pulse = 0.75 + 0.25 * Math.sin(this.time * 6) * this.flash;
    for (const p of players) {
      if (p.fx === 0) continue;
      const orbit = Math.max(1.2, outerOrbitRadius(p.bladeCount) + 0.8);
      if (shells < AURA_MAX) {
        let tint: number | null = null;
        let k = 0;
        if (p.fx & agentFxBit(AgentEffect.Bastion)) { tint = AGENT_FX.aegis; k = 1.1 * pulse; }
        else if (p.fx & agentFxBit(AgentEffect.Aegis)) { tint = AGENT_FX.aegis; k = 0.75 * pulse; }
        else if (p.fx & agentFxBit(AgentEffect.Eclipse)) { tint = AGENT_FX.smoke; k = 0.6; }
        if (tint !== null) {
          tmpM.compose(tmpP.set(p.x, 0.9, p.z), tmpQ.identity(), tmpS.set(orbit, Math.max(1.4, orbit * 0.45), orbit));
          this.shells.setMatrixAt(shells, tmpM);
          this.shells.setColorAt(shells, tmpC.set(tint).multiplyScalar(k));
          shells++;
        }
      }
      const ring = (color: number, radius: number, y: number, k: number, spin: number) => {
        if (rings >= AURA_MAX * 2) return;
        tmpM.compose(tmpP.set(p.x, y, p.z), tmpQ.setFromAxisAngle(UP, spin), tmpS.set(radius, 1, radius));
        this.rings.setMatrixAt(rings, tmpM);
        this.rings.setColorAt(rings, tmpC.set(color).multiplyScalar(k));
        rings++;
      };
      if (p.fx & agentFxBit(AgentEffect.Surge)) {
        ring(AGENT_FX.surge, 1.05, 1.0 + 0.15 * Math.sin(this.time * 9), pulse, this.time * 4);
        if (this.rich) ring(AGENT_FX.surge, 0.8, 0.5, 0.7 * pulse, -this.time * 6);
      }
      if (p.fx & agentFxBit(AgentEffect.Barrage)) ring(AGENT_FX.barrage, orbit, 0.6, pulse, this.time);
      if (p.fx & AGENT_FX_SNARED) ring(AGENT_FX.snared, 0.9, 0.1, 0.9, this.time * 0.5);
    }
    this.shells.count = shells;
    this.rings.count = rings;
    if (shells > 0) {
      this.shells.instanceMatrix.needsUpdate = true;
      if (this.shells.instanceColor) this.shells.instanceColor.needsUpdate = true;
    }
    if (rings > 0) {
      this.rings.instanceMatrix.needsUpdate = true;
      if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
    }
  }

  clear(): void {
    for (const s of this.smokes) s.mesh.visible = s.floor.visible = false;
    for (const w of this.wells) w.mesh.visible = false;
    for (const t of this.traps) t.group.visible = false;
    this.shells.count = 0;
    this.rings.count = 0;
  }
}
