import * as THREE from "three";
import { CAMERA_FOV_DEG } from "@bladeio/shared";

// Part de la cible de rendu courante réellement dessinée. Avec post-FX, la
// résolution dynamique rend la scène dans une partie de sa cible (PostFX) :
// ce qui se mesure en pixels (taille des points) s'y règle, sans quoi les
// points grossiraient d'autant quand la résolution baisse.
export function viewportScale(renderer: THREE.WebGLRenderer): number {
  const target = renderer.getRenderTarget();
  return target ? target.viewport.w / target.height : 1;
}

// Champ de la caméra rapporté à celui du cadrage partagé. La taille d'un
// point se calcule en « pixels à 1 u de distance », sans le champ : avec le
// cadrage isométrique (?cam=iso : champ étroit, caméra quatre fois plus
// loin pour la même vue), les points seraient quatre fois plus petits.
// 1 avec le cadrage partagé.
const BASE_FOV_TERM = 1 / Math.tan((CAMERA_FOV_DEG * Math.PI) / 360);
export function fovScale(camera: THREE.Camera): number {
  return camera.projectionMatrix.elements[5] / BASE_FOV_TERM;
}

// Points de three.js (PointsMaterial, taille en pixels calculée sur le
// canvas) : taille ramenée à la partie dessinée et au champ de la caméra,
// à chaque rendu.
export function scalePointsWithViewport(points: THREE.Points, material: THREE.PointsMaterial): void {
  const base = material.size;
  points.onBeforeRender = (renderer, _scene, camera) => {
    material.size = base * viewportScale(renderer) * fovScale(camera);
  };
}
