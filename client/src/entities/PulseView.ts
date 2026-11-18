import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { THREAT_COLORS, getActiveTheme } from "../themes";

// Obélisque armé (décor interactif) : le cercle de son onde, au sol, pendant
// le préavis. Un anneau grandit jusqu'au bord de la zone : il l'atteint
// quand l'onde part. Pour ceux qu'elle va toucher : couleur de danger et
// anneau en tirets ; pour celui qui l'a armé et ses alliés : la couleur de
// son propre anneau, trait plein (la forme en plus de la couleur).
// Tout est créé d'avance et caché : rien ne se compile ni ne s'alloue quand
// un obélisque s'arme.

const SLOTS = 8;
const DASHES = 28;
const FILL_OPACITY = 0.1;
const EDGE_OPACITY = 0.75;

interface Slot {
  group: THREE.Group;
  // Anneaux qui grandissent : trait plein (épargné), tirets (visé).
  solid: THREE.Mesh;
  dashed: THREE.Mesh;
  fill: THREE.Mesh;
  radius: number;
  elapsed: number;
  duration: number;
  active: boolean;
}

function dashedRing(): THREE.BufferGeometry {
  const step = (Math.PI * 2) / DASHES;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < DASHES; i++) parts.push(new THREE.RingGeometry(0.95, 1, 3, 1, i * step, step * 0.6));
  const merged = mergeGeometries(parts, false) ?? new THREE.RingGeometry(0.95, 1, 48, 1);
  for (const g of parts) g.dispose();
  return merged;
}

export class PulseView {
  readonly root = new THREE.Group();
  private readonly slots: Slot[] = [];
  private next = 0;

  constructor() {
    const theme = getActiveTheme();
    const flat = (color: number, opacity: number) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    const dangerEdge = flat(THREAT_COLORS.danger, EDGE_OPACITY);
    const dangerFill = flat(THREAT_COLORS.danger, FILL_OPACITY);
    const ownEdge = flat(theme.palette.playerLocal.accent, EDGE_OPACITY);
    const ownFill = flat(theme.palette.playerLocal.accent, FILL_OPACITY);
    const solidGeo = new THREE.RingGeometry(0.95, 1, 64, 1);
    const dashedGeo = dashedRing();
    const fillGeo = new THREE.CircleGeometry(1, 48);
    for (let i = 0; i < SLOTS; i++) {
      const group = new THREE.Group();
      group.rotation.x = -Math.PI / 2;
      group.position.y = 0.07;
      group.visible = false;
      const solid = new THREE.Mesh(solidGeo, ownEdge);
      const dashed = new THREE.Mesh(dashedGeo, dangerEdge);
      const fill = new THREE.Mesh(fillGeo, dangerFill);
      // Matériaux de remplissage : celui du danger par défaut, échangé à
      // l'armement (même programme, une autre couleur).
      fill.userData.danger = dangerFill;
      fill.userData.own = ownFill;
      group.add(fill, solid, dashed);
      this.root.add(group);
      this.slots.push({ group, solid, dashed, fill, radius: 1, elapsed: 0, duration: 1, active: false });
    }
  }

  // Obélisque armé en (x, z) : onde de rayon radius dans delayMs. spared :
  // le joueur local n'en subira rien (il l'a armé, ou c'est un allié).
  arm(x: number, z: number, radius: number, delayMs: number, spared: boolean): void {
    const s = this.slots[this.next];
    this.next = (this.next + 1) % SLOTS;
    s.group.position.set(x, 0.07, z);
    s.radius = radius;
    s.elapsed = 0;
    s.duration = Math.max(0.05, delayMs / 1000);
    s.active = true;
    s.solid.visible = spared;
    s.dashed.visible = !spared;
    s.fill.material = spared ? s.fill.userData.own : s.fill.userData.danger;
    s.fill.scale.setScalar(radius);
    s.group.visible = true;
  }

  // L'onde est partie de (x, z) : son cercle s'efface.
  release(x: number, z: number): void {
    for (const s of this.slots) {
      if (!s.active) continue;
      if (Math.abs(s.group.position.x - x) < 0.5 && Math.abs(s.group.position.z - z) < 0.5) this.hide(s);
    }
  }

  update(dt: number): void {
    for (const s of this.slots) {
      if (!s.active) continue;
      s.elapsed += dt;
      // Un peu au-delà du préavis : l'évènement de l'onde le retire ; s'il
      // n'arrive jamais (joueur sorti de la zone d'intérêt), il s'efface seul.
      if (s.elapsed > s.duration + 0.6) {
        this.hide(s);
        continue;
      }
      const k = Math.min(1, s.elapsed / s.duration);
      const r = s.radius * (0.15 + 0.85 * k);
      s.solid.scale.setScalar(r);
      s.dashed.scale.setScalar(r);
      // Les tirets tournent : on voit que ça approche, même de loin.
      s.dashed.rotation.z += dt * 1.2;
    }
  }

  clear(): void {
    for (const s of this.slots) this.hide(s);
  }

  private hide(s: Slot): void {
    s.active = false;
    s.group.visible = false;
  }
}
