import * as THREE from "three";
import { CTF_BASE_RADIUS, TEAM_NONE, teamBase } from "@bladeio/shared";
import { QualityConfig } from "../quality";
import { getActiveTheme } from "../themes";

// Drapeaux et bases de la capture du drapeau (tâche 7.2). Les deux camps
// diffèrent par la couleur (celle de son propre anneau pour le sien, celle
// des autres joueurs pour celui d'en face) ET par la forme (tâche 3.8) : le
// sien carré, surmonté d'un losange comme les repères des alliés ; celui
// d'en face en fanion triangulaire, surmonté d'une boule. Mêmes repères au
// sol : losanges autour de sa base. Tissu qui ondule en qualité haute,
// immobile ailleurs.

// Ce que le rendu lit d'un drapeau synchronisé (state.flags).
export interface FlagSnapshot {
  team: number;
  x: number;
  y: number;
  carrierId: string;
  atBase: boolean;
}

const POLE_HEIGHT = 3.2;
const CLOTH_W = 1.5;
const CLOTH_H = 0.95;
// Porté : plus petit, au-dessus du joueur et à côté de sa tête.
const CARRIED_SCALE = 0.7;
const CARRIED_LIFT = 0.9;
const CARRIED_SIDE = 0.45;
// Lissage d'un drapeau dont le porteur n'est pas reçu (hors de vue) : sa
// position synchronisée avance par pas de tick.
const FOLLOW_TAU = 0.08;

interface FlagMesh {
  team: number;
  root: THREE.Group;
  cloth: THREE.Mesh;
  // Positions de repos du tissu, pour l'ondulation (qualité haute).
  rest: Float32Array | null;
  x: number;
  y: number;
  placed: boolean;
}

export class FlagRenderer {
  private readonly group = new THREE.Group();
  private flags: FlagMesh[] = [];
  // Équipe locale pour laquelle les maillages sont construits (-1 : aucun).
  private builtFor = -1;
  private disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  private time = 0;

  constructor(scene: THREE.Scene, private readonly q: QualityConfig) {
    scene.add(this.group);
  }

  // carrierAt : position affichée d'un porteur reçu (vue interpolée, ou
  // prédite pour soi), null s'il ne l'est pas.
  update(
    flags: FlagSnapshot[],
    myTeam: number,
    carrierAt: (id: string) => { x: number; y: number } | null,
    dt: number,
  ): void {
    if (flags.length === 0 || myTeam === TEAM_NONE) {
      if (this.builtFor !== -1) this.clear();
      return;
    }
    if (this.builtFor !== myTeam) this.build(flags, myTeam);
    this.time += dt;
    const k = 1 - Math.exp(-dt / FOLLOW_TAU);
    for (const f of flags) {
      const m = this.flags.find((e) => e.team === f.team);
      if (!m) continue;
      const carried = f.carrierId !== "";
      const at = carried ? carrierAt(f.carrierId) : null;
      if (at) {
        m.x = at.x;
        m.y = at.y;
      } else if (carried && m.placed) {
        m.x += (f.x - m.x) * k;
        m.y += (f.y - m.y) * k;
      } else {
        m.x = f.x;
        m.y = f.y;
      }
      m.placed = true;
      m.root.position.set(m.x + (carried ? CARRIED_SIDE : 0), carried ? CARRIED_LIFT : 0, m.y);
      m.root.scale.setScalar(carried ? CARRIED_SCALE : 1);
      // À terre : penché, pour le distinguer d'un drapeau à sa base.
      m.root.rotation.z = !carried && !f.atBase ? -0.45 : 0;
      if (m.rest) this.wave(m, carried ? 2.2 : 1);
    }
  }

  // Ondulation du tissu, nulle au mât, plus ample au bout et quand le
  // drapeau est emporté.
  private wave(m: FlagMesh, amp: number): void {
    const pos = m.cloth.geometry.getAttribute("position") as THREE.BufferAttribute;
    const rest = m.rest!;
    for (let i = 0; i < pos.count; i++) {
      const x = rest[i * 3];
      const u = x / CLOTH_W;
      pos.setZ(i, Math.sin(this.time * 5 - u * 5.5) * 0.12 * u * amp);
    }
    pos.needsUpdate = true;
  }

  private build(flags: FlagSnapshot[], myTeam: number): void {
    this.clear();
    this.builtFor = myTeam;
    const palette = getActiveTheme().palette;
    const detail = this.q.playerDetail;
    const poleMat = new THREE.MeshBasicMaterial({ color: palette.playerLocal.primary });
    const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, POLE_HEIGHT, detail === "rich" ? 8 : 5);
    poleGeo.translate(0, POLE_HEIGHT / 2, 0);
    this.disposables.push(poleMat, poleGeo);
    for (const f of flags) {
      const ally = f.team === myTeam;
      const color = ally ? palette.playerLocal.accent : palette.playerRemote.accent;
      const root = new THREE.Group();
      root.add(new THREE.Mesh(poleGeo, poleMat));
      // Tissu : segments pour l'ondulation en qualité haute seulement.
      const seg = detail === "rich" ? 10 : 1;
      const clothGeo = new THREE.PlaneGeometry(CLOTH_W, CLOTH_H, seg, ally ? Math.max(1, seg >> 2) : 1);
      clothGeo.translate(CLOTH_W / 2, 0, 0);
      if (!ally) {
        // Fanion : les bords se rejoignent en pointe au bout.
        const pos = clothGeo.getAttribute("position") as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) * (1 - pos.getX(i) / CLOTH_W));
      }
      clothGeo.translate(0, POLE_HEIGHT - CLOTH_H / 2, 0);
      const clothMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
      const cloth = new THREE.Mesh(clothGeo, clothMat);
      root.add(cloth);
      const finialGeo = ally ? new THREE.OctahedronGeometry(0.17) : new THREE.SphereGeometry(0.12, 8, 6);
      const finial = new THREE.Mesh(finialGeo, clothMat);
      finial.position.y = POLE_HEIGHT + 0.12;
      root.add(finial);
      this.group.add(root);
      this.disposables.push(clothGeo, clothMat, finialGeo);
      const rest = detail === "rich" ? Float32Array.from((clothGeo.getAttribute("position") as THREE.BufferAttribute).array) : null;
      if (rest) (clothGeo.getAttribute("position") as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
      this.flags.push({ team: f.team, root, cloth, rest, x: f.x, y: f.y, placed: false });
      this.buildBase(f.team, color, ally);
    }
  }

  // Base au sol : anneau de rayon CTF_BASE_RADIUS (où l'on rapporte le
  // drapeau adverse) et disque léger ; losanges autour de la sienne.
  private buildBase(team: number, color: number, ally: boolean): void {
    const { x, y } = teamBase(team);
    const seg = this.q.playerDetail === "rich" ? 64 : 40;
    const ringGeo = new THREE.RingGeometry(CTF_BASE_RADIUS - 0.3, CTF_BASE_RADIUS, seg);
    const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide });
    const discGeo = new THREE.CircleGeometry(CTF_BASE_RADIUS - 0.3, seg);
    const discMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide });
    const base = new THREE.Group();
    base.add(new THREE.Mesh(ringGeo, ringMat), new THREE.Mesh(discGeo, discMat));
    this.disposables.push(ringGeo, ringMat, discGeo, discMat);
    if (ally) {
      const marks = diamondsGeometry(CTF_BASE_RADIUS + 0.9, 0.35, 8);
      base.add(new THREE.Mesh(marks, ringMat));
      this.disposables.push(marks);
    }
    base.rotation.x = -Math.PI / 2;
    base.position.set(x, 0.025, y);
    base.matrixAutoUpdate = false;
    base.updateMatrix();
    this.group.add(base);
  }

  clear(): void {
    for (const child of [...this.group.children]) this.group.remove(child);
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.flags = [];
    this.builtFor = -1;
  }

  dispose(): void {
    this.clear();
    this.group.parent?.remove(this.group);
  }
}

// n losanges à plat (plan XY), répartis sur un cercle de rayon r.
function diamondsGeometry(r: number, h: number, n: number): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    pos.push(x + h, y, 0, x, y + h, 0, x - h, y, 0);
    pos.push(x - h, y, 0, x, y - h, 0, x + h, y, 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return geo;
}
