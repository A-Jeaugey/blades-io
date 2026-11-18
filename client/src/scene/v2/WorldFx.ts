import * as THREE from "three";
import { fxIntensity } from "../../fx/flash";

// Ce qui fait réagir le décor du rendu v2 à la partie, à chaque frame :
// - lumières au sol : une lueur sous chaque joueur visible (la couleur de
//   son anneau) et un éclair bref à chaque choc, élimination ou palier ;
//   le sol les lit comme un tableau d'uniforms (GroundV2.ts) ;
// - joueurs qui écartent les roseaux en les traversant (DecorV2.ts).
// Rien ici ne vient d'ailleurs que de ce que l'écran montre déjà : un
// joueur caché dans un buisson n'est pas envoyé au client, il n'éclaire et
// n'écarte donc rien.

// Tailles des tableaux, reprises dans les shaders.
export const GROUND_LIGHTS = 16;
export const REED_PUSHERS = 6;
// Les premières lumières sont réservées aux éclairs, le reste aux joueurs
// (les plus proches du point suivi par la caméra s'il y en a trop).
const FLASH_SLOTS = 6;
const PLAYER_SLOTS = GROUND_LIGHTS - FLASH_SLOTS;
const MAX_CANDIDATES = 64;

// Lueur d'un joueur : assez pour l'ancrer au sol, pas au point de noyer
// ses lames dans un halo.
const PLAYER_LIGHT_RADIUS = 3.8;
const PLAYER_LIGHT_STRENGTH = 0.36;

interface Flash {
  x: number;
  z: number;
  r: number;
  g: number;
  b: number;
  radius: number;
  life: number;
  ttl: number;
}

export class WorldFx {
  // (x, z, rayon², inutilisé) et couleur linéaire déjà multipliée par sa force.
  private readonly lightPos = new Float32Array(GROUND_LIGHTS * 4);
  private readonly lightCol = new Float32Array(GROUND_LIGHTS * 3);
  // (x, z, actif).
  private readonly pushers = new Float32Array(REED_PUSHERS * 3);
  readonly uniforms = {
    uGDynPos: { value: this.lightPos },
    uGDynCol: { value: this.lightCol },
    uReedPush: { value: this.pushers },
  };

  private readonly flashes: Flash[] = [];
  private nextFlash = 0;
  private flashK = 1;
  // Joueurs visibles de la frame.
  private readonly candX = new Float32Array(MAX_CANDIDATES);
  private readonly candZ = new Float32Array(MAX_CANDIDATES);
  private readonly candD = new Float32Array(MAX_CANDIDATES);
  private readonly candColor: THREE.Color[] = [];
  private readonly order: number[] = [];
  private count = 0;
  private readonly tmp = new THREE.Color();

  constructor() {
    for (let i = 0; i < FLASH_SLOTS; i++) this.flashes.push({ x: 0, z: 0, r: 0, g: 0, b: 0, radius: 1, life: 0, ttl: 1 });
    // Rayon² jamais nul : le shader divise par lui.
    for (let i = 0; i < GROUND_LIGHTS; i++) this.lightPos[i * 4 + 2] = 1;
  }

  setFlashIntensity(k: number): void {
    this.flashK = k;
  }

  // Éclair au sol : couleur hex, rayon (u), force (1 = pleine), durée (s).
  // Le plus ancien laisse sa place.
  flash(x: number, z: number, color: number, radius: number, strength: number, ttl: number): void {
    const f = this.flashes[this.nextFlash];
    this.nextFlash = (this.nextFlash + 1) % FLASH_SLOTS;
    // Réglage des flashs : atténué, jamais éteint (cf. fx/flash.ts).
    const k = strength * fxIntensity(this.flashK);
    this.tmp.set(color);
    f.x = x;
    f.z = z;
    f.r = this.tmp.r * k;
    f.g = this.tmp.g * k;
    f.b = this.tmp.b * k;
    f.radius = radius;
    f.life = ttl;
    f.ttl = ttl;
  }

  beginFrame(): void {
    this.count = 0;
  }

  // Joueur visible de la frame ; color : son repère (anneau), gardé tel quel
  // (l'appelant passe toujours les mêmes objets, rien n'est alloué).
  addPlayer(x: number, z: number, color: THREE.Color): void {
    if (this.count >= MAX_CANDIDATES) return;
    const i = this.count++;
    this.candX[i] = x;
    this.candZ[i] = z;
    this.candColor[i] = color;
  }

  // (focusX, focusZ) : point suivi par la caméra.
  endFrame(dt: number, focusX: number, focusZ: number): void {
    const pos = this.lightPos;
    const col = this.lightCol;
    for (let i = 0; i < FLASH_SLOTS; i++) {
      const f = this.flashes[i];
      f.life = Math.max(0, f.life - dt);
      // Extinction en carré : vif au départ, traîne courte.
      const a = f.life / f.ttl;
      const k = a * a;
      pos[i * 4] = f.x;
      pos[i * 4 + 1] = f.z;
      pos[i * 4 + 2] = Math.max(1e-3, f.radius * f.radius);
      col[i * 3] = f.r * k;
      col[i * 3 + 1] = f.g * k;
      col[i * 3 + 2] = f.b * k;
    }

    // Joueurs, du plus proche du point suivi au plus lointain.
    const n = this.count;
    this.order.length = n;
    for (let i = 0; i < n; i++) {
      this.order[i] = i;
      this.candD[i] = (this.candX[i] - focusX) ** 2 + (this.candZ[i] - focusZ) ** 2;
    }
    if (n > Math.min(PLAYER_SLOTS, REED_PUSHERS)) this.order.sort((a, b) => this.candD[a] - this.candD[b]);
    for (let s = 0; s < PLAYER_SLOTS; s++) {
      const o = (FLASH_SLOTS + s) * 4;
      const c = (FLASH_SLOTS + s) * 3;
      if (s < n) {
        const i = this.order[s];
        const color = this.candColor[i];
        pos[o] = this.candX[i];
        pos[o + 1] = this.candZ[i];
        pos[o + 2] = PLAYER_LIGHT_RADIUS * PLAYER_LIGHT_RADIUS;
        col[c] = color.r * PLAYER_LIGHT_STRENGTH;
        col[c + 1] = color.g * PLAYER_LIGHT_STRENGTH;
        col[c + 2] = color.b * PLAYER_LIGHT_STRENGTH;
      } else {
        col[c] = col[c + 1] = col[c + 2] = 0;
      }
    }
    for (let s = 0; s < REED_PUSHERS; s++) {
      const o = s * 3;
      if (s < n) {
        const i = this.order[s];
        this.pushers[o] = this.candX[i];
        this.pushers[o + 1] = this.candZ[i];
        this.pushers[o + 2] = 1;
      } else {
        this.pushers[o + 2] = 0;
      }
    }
  }
}
