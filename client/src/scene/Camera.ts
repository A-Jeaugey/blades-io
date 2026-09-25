import * as THREE from "three";
import { ScreenShake } from "../fx/ScreenShake";
import { getActiveTheme } from "../themes";

export class CameraRig {
  private target = new THREE.Vector3();
  private cameraOffset: THREE.Vector3;
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

  constructor(private cam: THREE.PerspectiveCamera) {
    // Offset (et donc l'angle de plongée) défini par le thème actif. Permet
    // à chaque ambiance d'avoir son point de vue (neon plus zoom-out, spirit
    // un peu plus penché pour le décor vertical).
    const t = getActiveTheme();
    this.cameraOffset = new THREE.Vector3(t.cameraOffset.x, t.cameraOffset.y, t.cameraOffset.z);
  }

  setTarget(x: number, y: number): void {
    this.target.set(x, 0, y);
  }

  update(dt: number): void {
    // Caméra rigide : position = target + offset, pas de lerp. Un lerp sur
    // la position avec un lookAt direct crée un wobble visuel quand la
    // caméra "rattrape" la cible, surtout à framerate élevé avec dt variable.
    this.cam.position.set(
      this.target.x + this.cameraOffset.x,
      this.cameraOffset.y,
      this.target.z + this.cameraOffset.z,
    );
    this.steady.position.copy(this.cam.position);
    this.steady.lookAt(this.target.x, 0.5, this.target.z);
    this.steady.updateMatrixWorld();
    // Projection recopiée à chaque frame : le redimensionnement la change.
    this.steady.projectionMatrix.copy(this.cam.projectionMatrix);
    this.steady.projectionMatrixInverse.copy(this.cam.projectionMatrixInverse);
    const shake = this.shake.update(dt);
    this.cam.position.x += shake.x;
    this.cam.position.y += shake.y;
    this.cam.lookAt(this.target.x, 0.5, this.target.z);
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
