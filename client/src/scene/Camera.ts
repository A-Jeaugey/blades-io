import * as THREE from "three";
import {
  CAMERA_DISTANCE,
  CAMERA_FOV_DEG,
  CAMERA_MIN_VIEW_WIDTH,
  CAMERA_PITCH_DEG,
  cameraZoom,
} from "@bladeio/shared";
import { ScreenShake } from "../fx/ScreenShake";
import {
  CAM_ISO,
  CAM_TPS,
  ISO_FOV_DEG,
  ISO_PITCH_DEG,
  ISO_YAW_DEG,
  TPS_DISTANCE,
  TPS_FOV_DEG,
  TPS_LOOK_AHEAD,
  TPS_PITCH_DEG,
  TPS_TURN_TAU,
  setThirdPersonView,
  setViewYaw,
} from "../gfx";

// Hauteur du point visé au-dessus du sol (centre du corps, à peu près).
const LOOK_HEIGHT = 0.5;
// Constante de temps du recul (s) : l'orbite grandit par paliers (un anneau
// de plus), la caméra suit sans à-coup.
const ZOOM_TAU = 0.45;
// Essai du cadrage isométrique (?cam=iso, gfx.ts) : caméra tournée autour
// de la verticale, champ étroit et donc bien plus loin, pour la même
// largeur de sol au niveau du joueur que le cadrage partagé.
// Essai de la troisième personne (?cam=tps) : caméra basse derrière le
// joueur, dont le lacet le suit (cf. gfx.ts).
// Un cadrage : inclinaison, lacet de départ, champ, distance de base. Celui
// de l'adresse (d'origine ou isométrique) et celui de la troisième
// personne ; la caméra passe de l'un à l'autre en entrant dans une partie
// sur une carte à murs (setThirdPerson).
interface Framing {
  tps: boolean;
  pitch: number;
  yaw: number;
  fovDeg: number;
  halfFovTan: number;
  base: number;
}

function framing(tps: boolean): Framing {
  const fovDeg = tps ? TPS_FOV_DEG : CAM_ISO ? ISO_FOV_DEG : CAMERA_FOV_DEG;
  const halfFovTan = Math.tan((fovDeg * Math.PI) / 360);
  return {
    tps,
    pitch: ((tps ? TPS_PITCH_DEG : CAM_ISO ? ISO_PITCH_DEG : CAMERA_PITCH_DEG) * Math.PI) / 180,
    yaw: !tps && CAM_ISO ? (ISO_YAW_DEG * Math.PI) / 180 : 0,
    fovDeg,
    halfFovTan,
    base: tps
      ? TPS_DISTANCE
      : CAM_ISO
        ? (CAMERA_DISTANCE * Math.tan((CAMERA_FOV_DEG * Math.PI) / 360)) / halfFovTan
        : CAMERA_DISTANCE,
  };
}

// Vitesse (u/s) sous laquelle la caméra ne cherche plus le dos du joueur :
// à l'arrêt ou presque, sa direction ne veut rien dire.
const TPS_FOLLOW_SPEED = 2.5;
// Caméra tirée devant un mur (troisième personne) : distance minimale au
// joueur, marge devant le mur, et temps de retour une fois la vue dégagée
// (elle avance tout de suite, recule doucement).
const PULL_MIN = 3.2;
const PULL_MARGIN = 0.8;
const PULL_RELEASE_TAU = 0.35;
// Tirée tout près, elle se redresse d'autant (rad) : sinon, basse et collée
// au joueur, elle ne montrerait que son dos.
const PULL_PITCH = 0.45;

// Part libre du segment au sol (x0, z0) → (x1, z1) avant un obstacle qui
// cache la vue : 1 si rien ne gêne.
export type ViewOccluder = (x0: number, z0: number, x1: number, z1: number) => number;

// Cadrage : constantes de gameplay partagées (shared/), identiques pour tous
// les thèmes. Distance = base × format d'écran × orbite.
export class CameraRig {
  private target = new THREE.Vector3();
  private zoom = 1;
  private zoomTarget = 1;
  // 0 jusqu'à la première frame : le premier calcul prévient toujours
  // onDistance (en cadrage isométrique, le brouillard part de loin).
  private distance = 0;
  // Troisième personne : lacet courant (0 : caméra au sud, regard au nord)
  // et dernière cible, pour en tirer la direction de course du joueur.
  private frame: Framing = framing(CAM_TPS);
  private yaw = this.frame.yaw;
  private occluder: ViewOccluder | null = null;
  // Part de la distance gardée devant un mur (1 : rien ne gêne).
  private pull = 1;
  private lastX = 0;
  private lastZ = 0;
  private hasLast = false;
  private readonly look = new THREE.Vector3();
  public shake = new ScreenShake();
  // Même pose que la caméra, sans le tremblement : sert à projeter le
  // curseur sur le sol. Un screen shake ne doit pas faire trembler la
  // direction de marche ni la visée.
  private steady = new THREE.PerspectiveCamera();
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private hit = new THREE.Vector3();
  private projected = new THREE.Vector3();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  // onDistance : appelé quand la distance change (brouillard et plan
  // lointain la suivent).
  constructor(private cam: THREE.PerspectiveCamera, private onDistance?: (distance: number) => void) {}

  // Passe à la troisième personne ou revient au cadrage de l'adresse
  // (?cam=tps la garde). Le champ de la caméra change avec le cadrage.
  setThirdPerson(on: boolean): void {
    const tps = on || CAM_TPS;
    if (tps === this.frame.tps) return;
    this.frame = framing(tps);
    this.yaw = this.frame.yaw;
    this.hasLast = false;
    this.pull = 1;
    this.distance = 0;
    setThirdPersonView(tps);
    setViewYaw(this.yaw);
    this.cam.fov = this.frame.fovDeg;
    this.cam.updateProjectionMatrix();
  }

  // Ce qui cache la vue à la troisième personne (immeubles d'une carte à
  // murs) ; null : rien.
  setOccluder(occluder: ViewOccluder | null): void {
    this.occluder = occluder;
    this.pull = 1;
  }

  // Recul sur un écran étroit : largeur de sol visible au niveau du joueur
  // d'au moins CAMERA_MIN_VIEW_WIDTH, quel que soit le format. Pas à la
  // troisième personne, où l'on voit jusqu'à l'horizon.
  private aspectFactor(): number {
    if (this.frame.tps) return 1;
    const width = 2 * this.frame.base * this.frame.halfFovTan * this.cam.aspect;
    return Math.max(1, CAMERA_MIN_VIEW_WIDTH / width);
  }

  setTarget(x: number, y: number): void {
    this.target.set(x, 0, y);
  }

  // Rayon de l'orbite extérieure du joueur suivi (0 hors partie).
  setOrbitRadius(outerRadius: number): void {
    this.zoomTarget = cameraZoom(outerRadius);
  }

  // Point du sol suivi (joueur local, ou tueur pendant la caméra de mort).
  get focusX(): number {
    return this.target.x;
  }

  get focusZ(): number {
    return this.target.z;
  }

  get viewDistance(): number {
    return this.distance;
  }

  update(dt: number): void {
    this.zoom += (this.zoomTarget - this.zoom) * (1 - Math.exp(-dt / ZOOM_TAU));
    const f = this.frame;
    const full = f.base * this.aspectFactor() * this.zoom;
    if (Math.abs(full - this.distance) > 1e-3) {
      this.distance = full;
      this.onDistance?.(full);
    }
    // Caméra rigide : position = cible + décalage, pas de lerp. Un lerp sur
    // la position avec un lookAt direct crée un wobble visuel quand la
    // caméra "rattrape" la cible, surtout à framerate élevé avec dt variable.
    if (f.tps) this.followBehind(dt);
    const yaw = this.yaw;
    let d = full;
    let pitch = f.pitch;
    // Un immeuble entre le joueur et la caméra : elle vient devant lui.
    if (f.tps && this.occluder) {
      const reach = Math.cos(pitch) * full;
      const free = this.occluder(
        this.target.x,
        this.target.z,
        this.target.x + Math.sin(yaw) * reach,
        this.target.z + Math.cos(yaw) * reach,
      );
      const want = free >= 1 ? 1 : Math.max(PULL_MIN / full, free - PULL_MARGIN / reach);
      if (want < this.pull) this.pull = want;
      else this.pull += (want - this.pull) * (1 - Math.exp(-dt / PULL_RELEASE_TAU));
      d = full * this.pull;
      pitch += (1 - this.pull) * PULL_PITCH;
    }
    this.cam.position.set(
      this.target.x + Math.sin(yaw) * Math.cos(pitch) * d,
      Math.sin(pitch) * d,
      this.target.z + Math.cos(yaw) * Math.cos(pitch) * d,
    );
    // Point visé : le joueur, ou un peu devant lui à la troisième personne.
    const ahead = f.tps ? TPS_LOOK_AHEAD : 0;
    this.look.set(this.target.x - Math.sin(yaw) * ahead, f.tps ? 1 : LOOK_HEIGHT, this.target.z - Math.cos(yaw) * ahead);
    this.steady.position.copy(this.cam.position);
    this.steady.lookAt(this.look);
    this.steady.updateMatrixWorld();
    // Projection recopiée à chaque frame : le redimensionnement la change.
    this.steady.projectionMatrix.copy(this.cam.projectionMatrix);
    this.steady.projectionMatrixInverse.copy(this.cam.projectionMatrixInverse);
    // Secousse proportionnelle à la distance : même amplitude à l'écran
    // quand la caméra recule.
    const shake = this.shake.update(dt);
    const k = d / f.base;
    this.cam.position.x += shake.x * k;
    this.cam.position.y += shake.y * k;
    this.cam.lookAt(this.look);
  }

  // Troisième personne : la caméra tourne vers le dos du joueur, d'après le
  // déplacement de sa cible. Un saut (apparition, caméra de mort) ne compte
  // pas pour une course.
  private followBehind(dt: number): void {
    const dx = this.target.x - this.lastX;
    const dz = this.target.z - this.lastZ;
    this.lastX = this.target.x;
    this.lastZ = this.target.z;
    if (!this.hasLast) {
      this.hasLast = true;
      return;
    }
    const step = Math.hypot(dx, dz);
    if (dt <= 0 || step > 4 || step / dt < TPS_FOLLOW_SPEED) return;
    // Regard de la caméra = (-sin lacet, -cos lacet) : derrière un joueur
    // qui court vers (dx, dz).
    let delta = Math.atan2(-dx, -dz) - this.yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.yaw += delta * (1 - Math.exp(-dt / TPS_TURN_TAU));
    setViewYaw(this.yaw);
  }

  // Point du sol (plan y = 0) sous un point de l'écran, en pixels client.
  // Le canvas couvre toute la fenêtre. null si le rayon ne coupe pas le sol
  // (au-dessus de l'horizon).
  groundAt(clientX: number, clientY: number): { x: number; y: number } | null {
    this.ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.steady);
    const p = this.raycaster.ray.intersectPlane(this.ground, this.hit);
    return p ? { x: p.x, y: p.z } : null;
  }

  // Distance entre le point suivi et le point du sol visible le plus
  // éloigné (coins et milieux des bords de l'écran) : rayon de la zone
  // d'intérêt demandée au serveur (tâche 2.4). Infinity si un bord de
  // l'écran passe au-dessus de l'horizon.
  visibleExtent(): number {
    const w = window.innerWidth;
    const h = window.innerHeight;
    let max = 0;
    for (const [sx, sy] of [[0, 0], [w / 2, 0], [w, 0], [0, h / 2], [w, h / 2], [0, h], [w / 2, h], [w, h]]) {
      const p = this.groundAt(sx, sy);
      if (!p) return Infinity;
      max = Math.max(max, Math.hypot(p.x - this.target.x, p.y - this.target.z));
    }
    return max;
  }

  // Position à l'écran (pixels client) d'un point du sol.
  screenOf(x: number, y: number): { x: number; y: number } {
    this.projected.set(x, 0, y).project(this.steady);
    return {
      x: (this.projected.x * 0.5 + 0.5) * window.innerWidth,
      y: (-this.projected.y * 0.5 + 0.5) * window.innerHeight,
    };
  }
}
