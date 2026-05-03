import * as THREE from "three";
import { ScreenShake } from "../fx/ScreenShake";
import { getActiveTheme } from "../themes";

export class CameraRig {
  private target = new THREE.Vector3();
  private cameraOffset: THREE.Vector3;
  public shake = new ScreenShake();

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
    const shake = this.shake.update(dt);
    this.cam.position.x += shake.x;
    this.cam.position.y += shake.y;
    this.cam.lookAt(this.target.x, 0.5, this.target.z);
  }
}
