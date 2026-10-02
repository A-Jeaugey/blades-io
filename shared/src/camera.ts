import {
  CAMERA_ZOOM_MAX,
  CAMERA_ZOOM_ORBIT_BASE,
  CAMERA_ZOOM_PER_UNIT,
  VIEW_RADIUS_MAX,
  VIEW_RADIUS_MAX_ZOOM,
} from "./constants";
import { outerOrbitRadius } from "./orbits";

// Recul de la caméra (multiplicateur de distance) selon le rayon de
// l'orbite extérieure du joueur suivi. Partagé : le serveur en déduit la
// zone d'intérêt à laquelle un joueur a droit (viewRadiusLimit).
export function cameraZoom(outerRadius: number): number {
  return Math.min(CAMERA_ZOOM_MAX, 1 + Math.max(0, outerRadius - CAMERA_ZOOM_ORBIT_BASE) * CAMERA_ZOOM_PER_UNIT);
}

// Plus grande zone d'intérêt accordée à un joueur de bladeCount lames :
// VIEW_RADIUS_MAX (un téléphone en portrait) jusqu'au recul
// VIEW_RADIUS_MAX_ZOOM, puis en proportion du recul. Un géant reçoit ce que
// montre son écran ; un client modifié n'obtient pas plus.
export function viewRadiusLimit(bladeCount: number): number {
  return VIEW_RADIUS_MAX * Math.max(1, cameraZoom(outerOrbitRadius(bladeCount)) / VIEW_RADIUS_MAX_ZOOM);
}
