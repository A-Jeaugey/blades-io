import * as THREE from "three";

// Part de la cible de rendu courante réellement dessinée. Avec post-FX, la
// résolution dynamique rend la scène dans une partie de sa cible (PostFX) :
// ce qui se mesure en pixels (taille des points) s'y règle, sans quoi les
// points grossiraient d'autant quand la résolution baisse.
export function viewportScale(renderer: THREE.WebGLRenderer): number {
  const target = renderer.getRenderTarget();
  return target ? target.viewport.w / target.height : 1;
}

// Points de three.js (PointsMaterial, taille en pixels calculée sur le
// canvas) : taille ramenée à la partie dessinée, à chaque rendu.
export function scalePointsWithViewport(points: THREE.Points, material: THREE.PointsMaterial): void {
  const base = material.size;
  points.onBeforeRender = (renderer) => {
    material.size = base * viewportScale(renderer);
  };
}
