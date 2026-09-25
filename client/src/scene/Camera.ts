import * as THREE from "three";
import {
  CAMERA_DISTANCE,
  CAMERA_FOV_DEG,
  CAMERA_MIN_VIEW_WIDTH,
  CAMERA_PITCH_DEG,
  CAMERA_ZOOM_MAX,
  CAMERA_ZOOM_ORBIT_BASE,
  CAMERA_ZOOM_PER_UNIT,
} from "@bladeio/shared";
import { ScreenShake } from "../fx/ScreenShake";

// Hauteur du point visé au-dessus du sol (centre du corps, à peu près).
const LOOK_HEIGHT = 0.5;
// Constante de temps du recul (s) : l'orbite grandit par paliers (un anneau
// de plus), la caméra suit sans à-coup.
const ZOOM_TAU = 0.45;
const PITCH = (CAMERA_PITCH_DEG * Math.PI) / 180;
const HALF_FOV_TAN = Math.tan((CAMERA_FOV_DEG * Math.PI) / 360);

// Recul sur un écran étroit : largeur de sol visible au niveau du joueur
// d'au moins CAMERA_MIN_VIEW_WIDTH, quel que soit le format.
export function aspectDistanceFactor(aspect: number): number {
  const width = 2 * CAMERA_DISTANCE * HALF_FOV_TAN * aspect;
  return Math.max(1, CAMERA_MIN_VIEW_WIDTH / width);
}

// Recul selon le rayon de l'orbite extérieure du joueur suivi.
export function orbitZoom(outerRadius: number): number {
  return Math.min(CAMERA_ZOOM_MAX, 1 + Math.max(0, outerRadius - CAMERA_ZOOM_ORBIT_BASE) * CAMERA_ZOOM_PER_UNIT);
}

// Cadrage : constantes de gameplay partagées (shared/), identiques pour tous
// les thèmes. Distance = base × format d'écran × orbite.
export class CameraRig {
  private target = new THREE.Vector3();
  private zoom = 1;
  private zoomTarget = 1;
  private distance = CAMERA_DISTANCE;
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

  setTarget(x: number, y: number): void {
    this.target.set(x, 0, y);
  }

  // Rayon de l'orbite extérieure du joueur suivi (0 hors partie).
  setOrbitRadius(outerRadius: number): void {
    this.zoomTarget = orbitZoom(outerRadius);
  }

  get viewDistance(): number {
    return this.distance;
  }

  update(dt: number): void {
    this.zoom += (this.zoomTarget - this.zoom) * (1 - Math.exp(-dt / ZOOM_TAU));
    const d = CAMERA_DISTANCE * aspectDistanceFactor(this.cam.aspect) * this.zoom;
    if (Math.abs(d - this.distance) > 1e-3) {
      this.distance = d;
      this.onDistance?.(d);
    }
    // Caméra rigide : position = cible + décalage, pas de lerp. Un lerp sur
    // la position avec un lookAt direct crée un wobble visuel quand la
    // caméra "rattrape" la cible, surtout à framerate élevé avec dt variable.
    this.cam.position.set(
      this.target.x,
      Math.sin(PITCH) * d,
      this.target.z + Math.cos(PITCH) * d,
    );
    this.steady.position.copy(this.cam.position);
    this.steady.lookAt(this.target.x, LOOK_HEIGHT, this.target.z);
    this.steady.updateMatrixWorld();
    // Projection recopiée à chaque frame : le redimensionnement la change.
    this.steady.projectionMatrix.copy(this.cam.projectionMatrix);
    this.steady.projectionMatrixInverse.copy(this.cam.projectionMatrixInverse);
    // Secousse proportionnelle à la distance : même amplitude à l'écran
    // quand la caméra recule.
    const shake = this.shake.update(dt);
    const k = d / CAMERA_DISTANCE;
    this.cam.position.x += shake.x * k;
    this.cam.position.y += shake.y * k;
    this.cam.lookAt(this.target.x, LOOK_HEIGHT, this.target.z);
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

  // Position à l'écran (pixels client) d'un point du sol.
  screenOf(x: number, y: number): { x: number; y: number } {
    this.projected.set(x, 0, y).project(this.steady);
    return {
      x: (this.projected.x * 0.5 + 0.5) * window.innerWidth,
      y: (-this.projected.y * 0.5 + 0.5) * window.innerHeight,
    };
  }
}
