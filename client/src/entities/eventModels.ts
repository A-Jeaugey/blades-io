import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { QualityConfig } from "../quality";
import { ThemePalette } from "../themes/Theme";

// Modèles des évènements de carte (retours du 2026-10-12), tout procédural :
// le coffre-fort (caisson d'acier, porte ronde à molette, rivets, joints
// lumineux) et la puce de la chute de processeurs (boîtier, broches,
// capot, cœur lumineux). Géométries et matériaux créés une fois par kit et
// partagés par toutes les instances (le coffre est seul, les puces au plus
// PROCESSOR_COUNT_MAX) ; le kit les libère.
//
// Trois niveaux (q.fx.detail) : « rich » tout (rivets, charnières,
// boutons de la molette, pistes de la puce), « simple » les formes
// principales, « minimal » (potato) le caisson, la porte, la molette et
// les joints, en matériaux sans éclairage comme le reste du potato.

type Detail = "rich" | "simple" | "minimal";

// Métal : reflet de la teinte claire du kit (garnitures, broches).
// shaded : faces ombrées par sommet (cf. shadeFaces).
function steelMaterial(q: QualityConfig, color: number, specular: number, shininess: number, shaded = false): THREE.Material {
  return q.simpleMaterials
    ? new THREE.MeshBasicMaterial({ color, vertexColors: shaded })
    : new THREE.MeshPhongMaterial({ color, specular, shininess, vertexColors: shaded });
}

// Ombrage fixe d'une boîte, par face (dessus clair, façade moyenne, côtés
// sombres) : sans éclairage (potato, basse qualité), un caisson uni se
// lisait comme une tache plate. Facteurs de luminosité, pas des couleurs :
// la teinte reste celle du thème.
const FACE_SHADE = [0.72, 0.72, 1.0, 0.5, 0.86, 0.6]; // +x, -x, +y, -y, +z, -z
function shadeFaces(box: THREE.BoxGeometry): THREE.BoxGeometry {
  const count = box.attributes.position.count;
  const colors = new Float32Array(count * 3);
  // BoxGeometry : 4 sommets par face, faces dans l'ordre +x, -x, +y, -y, +z, -z.
  for (let v = 0; v < count; v++) {
    const k = FACE_SHADE[Math.min(5, Math.floor(v / 4))];
    colors[v * 3] = colors[v * 3 + 1] = colors[v * 3 + 2] = k;
  }
  box.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return box;
}

// Lueur : sans éclairage, au-dessus de 1 en haute qualité pour le bloom.
function glowMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color });
}

// Mesh statique dans son groupe : matrice calculée une fois.
function place(mesh: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D {
  mesh.position.set(x, y, z);
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// --- Coffre-fort -----------------------------------------------------------

// Caisson : largeur (x), hauteur, profondeur (z). Porte côté +z, face à la
// caméra (placée au sud, regard vers -z). Hitbox serveur VAULT_HITBOX
// (2,2 u) : la demi-largeur du caisson, les coins un peu au-delà.
const VAULT_W = 3.6;
const VAULT_H = 3.0;
const VAULT_D = 3.0;
const PLINTH_H = 0.18;
const BODY_Y = PLINTH_H + VAULT_H / 2;
const FRONT_Z = VAULT_D / 2;
const DOOR_R = 1.12;
// Jauge de PV au sol, autour du coffre.
export const VAULT_GAUGE_SEGMENTS = 48;

export interface VaultParts {
  group: THREE.Group;
  // Molette (tourne sur l'axe z de la porte).
  dial: THREE.Object3D;
  // Jauge des PV au sol : drawRange réglé selon les PV restants.
  gauge: THREE.Mesh;
}

export class VaultKit {
  readonly glowMat: THREE.MeshBasicMaterial;
  readonly gaugeMat: THREE.MeshBasicMaterial;
  private readonly detail: Detail;
  private readonly steelMat: THREE.Material;
  private readonly hubMat: THREE.Material;
  private readonly trimMat: THREE.Material;
  private readonly gaugeBackMat: THREE.MeshBasicMaterial;
  private readonly geo: {
    body: THREE.BufferGeometry;
    plinth: THREE.BufferGeometry | null;
    band: THREE.BufferGeometry;
    door: THREE.BufferGeometry;
    rim: THREE.BufferGeometry;
    joint: THREE.BufferGeometry;
    hub: THREE.BufferGeometry;
    spokes: THREE.BufferGeometry;
    marker: THREE.BufferGeometry;
    details: THREE.BufferGeometry | null;
    gauge: THREE.BufferGeometry;
    gaugeBack: THREE.BufferGeometry;
  };

  constructor(q: QualityConfig, palette: ThemePalette) {
    this.detail = q.fx.detail;
    const c = palette.mapEvent;
    const rich = this.detail === "rich";
    const minimal = this.detail === "minimal";
    const seg = rich ? 40 : minimal ? 16 : 28;
    this.steelMat = steelMaterial(q, c.vaultSteel, c.vaultTrim, 40, true);
    this.hubMat = steelMaterial(q, c.vaultSteel, c.vaultTrim, 40);
    this.trimMat = steelMaterial(q, c.vaultTrim, c.vaultTrim, 90);
    this.glowMat = glowMaterial(c.vaultGlow);
    this.gaugeMat = new THREE.MeshBasicMaterial({ color: c.vaultGlow, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide });
    this.gaugeBackMat = new THREE.MeshBasicMaterial({ color: c.vaultGlow, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });

    const toZ = (g: THREE.BufferGeometry) => g.rotateX(Math.PI / 2);
    // Molette : trois rayons en étoile (six branches), un seul maillage.
    const spokeParts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) {
      spokeParts.push(new THREE.BoxGeometry(1.5, 0.1, 0.1).rotateZ((i * Math.PI) / 3));
    }
    if (rich) {
      // Boutons au bout des branches.
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        spokeParts.push(new THREE.SphereGeometry(0.1, 8, 6).translate(Math.cos(a) * 0.75, Math.sin(a) * 0.75, 0));
      }
    }
    const spokes = mergeGeometries(spokeParts, false)!;
    for (const g of spokeParts) g.dispose();

    // Rivets du pourtour de la façade et charnières de la porte (rich).
    let details: THREE.BufferGeometry | null = null;
    if (rich) {
      const parts: THREE.BufferGeometry[] = [];
      const mx = VAULT_W / 2 - 0.22;
      const my = VAULT_H / 2 - 0.22;
      const rivet = (x: number, y: number) => parts.push(new THREE.SphereGeometry(0.07, 6, 4).translate(x, BODY_Y + y, FRONT_Z + 0.01));
      for (let i = 0; i <= 5; i++) {
        const x = -mx + (i * 2 * mx) / 5;
        rivet(x, my);
        rivet(x, -my);
      }
      for (let i = 1; i < 4; i++) {
        const y = -my + (i * 2 * my) / 4;
        rivet(mx, y);
        rivet(-mx, y);
      }
      for (const dy of [-0.55, 0.55]) {
        parts.push(new THREE.CylinderGeometry(0.09, 0.09, 0.36, 10).translate(-DOOR_R - 0.04, BODY_Y + dy, FRONT_Z + 0.12));
      }
      details = mergeGeometries(parts, false);
      for (const g of parts) g.dispose();
    }

    this.geo = {
      body: shadeFaces(new THREE.BoxGeometry(VAULT_W, VAULT_H, VAULT_D)),
      plinth: minimal ? null : new THREE.BoxGeometry(VAULT_W + 0.24, PLINTH_H, VAULT_D + 0.24),
      // Bandeau lumineux qui fait le tour du caisson (joint du blindage).
      band: new THREE.BoxGeometry(VAULT_W + 0.04, 0.07, VAULT_D + 0.04),
      door: toZ(new THREE.CylinderGeometry(DOOR_R, DOOR_R, 0.22, seg)),
      rim: new THREE.TorusGeometry(DOOR_R + 0.05, 0.09, minimal ? 4 : 8, seg),
      // Joint lumineux autour de la porte.
      joint: new THREE.TorusGeometry(DOOR_R + 0.2, 0.035, 4, seg),
      hub: toZ(new THREE.CylinderGeometry(0.3, 0.3, 0.16, minimal ? 10 : 18)),
      spokes,
      // Repère lumineux du cadran : on le voit tourner.
      marker: new THREE.BoxGeometry(0.06, 0.22, 0.03),
      details,
      gauge: new THREE.RingGeometry(2.75, 3.0, VAULT_GAUGE_SEGMENTS, 1),
      gaugeBack: new THREE.RingGeometry(2.75, 3.0, VAULT_GAUGE_SEGMENTS, 1),
    };
  }

  build(): VaultParts {
    const g = this.geo;
    const group = new THREE.Group();
    group.add(place(new THREE.Mesh(g.body, this.steelMat), 0, BODY_Y, 0));
    if (g.plinth) group.add(place(new THREE.Mesh(g.plinth, this.trimMat), 0, PLINTH_H / 2, 0));
    group.add(place(new THREE.Mesh(g.band, this.glowMat), 0, PLINTH_H + 0.45, 0));
    group.add(place(new THREE.Mesh(g.band, this.glowMat), 0, PLINTH_H + VAULT_H - 0.4, 0));
    group.add(place(new THREE.Mesh(g.door, this.trimMat), 0, BODY_Y, FRONT_Z + 0.11));
    group.add(place(new THREE.Mesh(g.rim, this.trimMat), 0, BODY_Y, FRONT_Z + 0.2));
    group.add(place(new THREE.Mesh(g.joint, this.glowMat), 0, BODY_Y, FRONT_Z + 0.03));
    if (g.details) group.add(place(new THREE.Mesh(g.details, this.trimMat), 0, 0, 0));
    // Molette : moyeu, branches et repère, qui tournent ensemble.
    const dial = new THREE.Group();
    dial.position.set(0, BODY_Y, FRONT_Z + 0.3);
    dial.add(new THREE.Mesh(g.hub, this.hubMat));
    dial.add(place(new THREE.Mesh(g.spokes, this.trimMat), 0, 0, 0.06));
    dial.add(place(new THREE.Mesh(g.marker, this.glowMat), 0, 0.14, 0.09));
    group.add(dial);
    // Jauge des PV : un anneau plein (fond) et la part restante.
    const back = new THREE.Mesh(g.gaugeBack, this.gaugeBackMat);
    back.rotation.x = -Math.PI / 2;
    group.add(place(back, 0, 0.05, 0));
    const gauge = new THREE.Mesh(g.gauge, this.gaugeMat);
    gauge.rotation.x = -Math.PI / 2;
    gauge.position.y = 0.06;
    gauge.updateMatrix();
    gauge.matrixAutoUpdate = false;
    group.add(gauge);
    return { group, dial, gauge };
  }

  dispose(): void {
    for (const geo of Object.values(this.geo)) geo?.dispose();
    for (const m of [this.steelMat, this.hubMat, this.trimMat, this.glowMat, this.gaugeMat, this.gaugeBackMat]) m.dispose();
  }
}

// --- Puce (chute de processeurs) ------------------------------------------

// Boîtier carré à plat (x, z), broches sur les quatre côtés, capot
// métallique et cœur lumineux sur le dessus. Taille unité ~2 u broches
// comprises ; la puce restée au sol est agrandie (CHIP_HITBOX).
const CHIP_W = 1.6;
const CHIP_H = 0.22;

export interface ChipParts {
  group: THREE.Group;
}

export class ChipKit {
  readonly coreMat: THREE.MeshBasicMaterial;
  private readonly bodyMat: THREE.Material;
  private readonly pinsMat: THREE.Material;
  private readonly traceMat: THREE.MeshBasicMaterial | null;
  private readonly geo: {
    body: THREE.BufferGeometry;
    lid: THREE.BufferGeometry;
    core: THREE.BufferGeometry;
    pins: THREE.BufferGeometry;
    traces: THREE.BufferGeometry | null;
  };

  constructor(q: QualityConfig, palette: ThemePalette) {
    const detail: Detail = q.fx.detail;
    const c = palette.mapEvent;
    this.bodyMat = steelMaterial(q, c.chipBody, c.chipPins, 70, true);
    this.pinsMat = steelMaterial(q, c.chipPins, c.chipPins, 110);
    this.coreMat = glowMaterial(c.chipCore);
    // Pistes du circuit : la couleur du cœur, plus sourde.
    this.traceMat = detail === "rich" ? glowMaterial(new THREE.Color(c.chipCore).multiplyScalar(0.55).getHex()) : null;
    const perSide = detail === "rich" ? 7 : detail === "simple" ? 5 : 4;
    const pins: THREE.BufferGeometry[] = [];
    for (let side = 0; side < 4; side++) {
      for (let i = 0; i < perSide; i++) {
        const t = -CHIP_W / 2 + 0.2 + (i * (CHIP_W - 0.4)) / (perSide - 1);
        const pin = new THREE.BoxGeometry(0.08, 0.05, 0.3).translate(t, 0, CHIP_W / 2 + 0.12);
        pins.push(pin.rotateY((side * Math.PI) / 2));
      }
    }
    const pinsGeo = mergeGeometries(pins, false)!;
    for (const g of pins) g.dispose();
    let traces: THREE.BufferGeometry | null = null;
    if (this.traceMat) {
      const parts: THREE.BufferGeometry[] = [];
      for (let side = 0; side < 4; side++) {
        for (const t of [-0.3, 0.3]) {
          parts.push(new THREE.BoxGeometry(0.035, 0.012, 0.3).translate(t, CHIP_H / 2 + 0.006, 0.62).rotateY((side * Math.PI) / 2));
        }
      }
      traces = mergeGeometries(parts, false);
      for (const g of parts) g.dispose();
    }
    this.geo = {
      body: shadeFaces(new THREE.BoxGeometry(CHIP_W, CHIP_H, CHIP_W)),
      lid: new THREE.BoxGeometry(0.95, 0.08, 0.95),
      core: new THREE.BoxGeometry(0.46, 0.03, 0.46),
      pins: pinsGeo,
      traces,
    };
  }

  build(): ChipParts {
    const g = this.geo;
    const group = new THREE.Group();
    group.add(place(new THREE.Mesh(g.body, this.bodyMat), 0, 0, 0));
    group.add(place(new THREE.Mesh(g.pins, this.pinsMat), 0, -0.04, 0));
    group.add(place(new THREE.Mesh(g.lid, this.pinsMat), 0, CHIP_H / 2 + 0.04, 0));
    group.add(place(new THREE.Mesh(g.core, this.coreMat), 0, CHIP_H / 2 + 0.095, 0));
    if (g.traces && this.traceMat) group.add(place(new THREE.Mesh(g.traces, this.traceMat), 0, 0, 0));
    return { group };
  }

  dispose(): void {
    for (const geo of Object.values(this.geo)) geo?.dispose();
    for (const m of [this.bodyMat, this.pinsMat, this.coreMat, this.traceMat]) m?.dispose();
  }
}
