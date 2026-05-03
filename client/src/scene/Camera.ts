import * as THREE from "three";
import { ScreenShake } from "../fx/ScreenShake";

export class CameraRig {
  private target = new THREE.Vector3();
  // Offset (0, 19, 17) ≈ 48° d'inclinaison depuis l'horizontale. Plus
  // plongeant que le 54° d'origine (était (0, 22, 16)) pour donner plus de
  // présence aux décors verticaux (sanctuaires, reliques flottantes) tout
  // en restant lisible pour un .io où la menace vient de toutes directions.
  private cameraOffset = new THREE.Vector3(0, 19, 17);
  public shake = new ScreenShake();

  constructor(private cam: THREE.PerspectiveCamera) {}

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
