// Essais de la refonte graphique, activés par l'adresse de la page :
//   /v2       la version de test : rendu v2 et cadrage isométrique ;
//   ?gfx=v2   rendu v2 seul : décor modélisé (kit Blender), sol éclairé,
//             ombres portées ;
//   ?cam=iso  cadrage isométrique seul (caméra tournée de 45°, champ étroit) ;
//   ?cam=tps  essai de vue à la troisième personne : caméra basse derrière
//             le joueur, qui tourne avec lui.
// Sous /v2, ?cam=std garde le cadrage d'origine. Rien n'est enregistré :
// ailleurs que sous /v2 et sans ces paramètres, le jeu est celui d'avant.
// Ce module ne tire ni three.js ni le moteur : le lobby peut le lire.
//
// /v2 n'est pas un autre jeu : même page (le serveur renvoie index.html
// pour tout chemin sans extension, le serveur de dev aussi), mêmes fichiers,
// même serveur et mêmes parties que la version d'origine. Seul l'affichage
// change, donc les deux versions jouent ensemble.
const here = typeof location === "undefined" ? null : location;
const params = new URLSearchParams(here?.search ?? "");
const onTestPath = /\/v2\/?$/.test(here?.pathname ?? "");

export const GFX_V2_REQUESTED = onTestPath || params.get("gfx") === "v2";
export const CAM_ISO = params.has("cam") ? params.get("cam") === "iso" : onTestPath;
export const CAM_TPS = params.get("cam") === "tps";

// Vue à la troisième personne (essai) : caméra derrière le joueur, à
// TPS_DISTANCE, inclinée de TPS_PITCH_DEG, qui vise TPS_LOOK_AHEAD devant
// lui (il est dans le tiers bas de l'écran, la vue porte loin devant). Elle
// tourne du côté où il demande d'aller (son input : ni les chocs ni les
// murs ne la font pivoter, et reculer ne la retourne pas), à raison de
// TPS_TURN_TAU secondes pour rattraper un changement de
// direction : assez lentement pour qu'on puisse le diriger à la souris sans
// que la vue ne s'emballe. On y voit jusqu'à l'horizon : le serveur, lui,
// n'envoie toujours que la zone d'intérêt (viewRadiusLimit), les joueurs
// lointains apparaissent donc en s'approchant.
export const TPS_FOV_DEG = 62;
export const TPS_PITCH_DEG = 27;
export const TPS_DISTANCE = 12.5;
export const TPS_LOOK_AHEAD = 5;
export const TPS_TURN_TAU = 0.55;
// Vitesse de rotation maximale (rad/s) : une touche de côté tenue fait
// tourner la vue d'un quart de tour par seconde environ, pas d'un demi-tour
// (à 164°/s, on perdait le fil de la rue).
export const TPS_TURN_MAX = 1.6;

// Cadrage isométrique. Mêmes 50 u de sol en largeur au niveau du joueur que
// la caméra d'origine (CAMERA_* de shared/) : on ne voit pas plus loin sur
// les côtés, et moins loin devant soi (la vue n'est plus un trapèze), donc
// jamais plus que la zone d'intérêt accordée par le serveur. Inclinaison de
// 45° : en dessous, on perd la perception des menaces (cf. CLAUDE.md).
export const ISO_FOV_DEG = 14;
export const ISO_PITCH_DEG = 45;
export const ISO_YAW_DEG = 45;

// Direction à l'écran → direction au sol. Clavier et joystick donnent une
// direction dans le repère de l'écran (haut = -y) ; caméra tournée, le haut
// de l'écran n'est plus le nord de la carte.
// Le lacet de la caméra est fixe en cadrage isométrique, suivi à chaque
// frame à la troisième personne (setViewYaw, depuis CameraRig).
// Troisième personne en cours : demandée par l'adresse (?cam=tps), ou par
// la partie (mode « district », carte à murs : CameraRig.setThirdPerson).
let tpsOn = CAM_TPS;
export function thirdPerson(): boolean {
  return tpsOn;
}
export function setThirdPersonView(on: boolean): void {
  tpsOn = on;
}

// Lacet de la caméra hors troisième personne.
export const BASE_VIEW_YAW = CAM_ISO ? (ISO_YAW_DEG * Math.PI) / 180 : 0;
let viewYawRad = BASE_VIEW_YAW;
let viewCos = Math.cos(viewYawRad);
let viewSin = Math.sin(viewYawRad);
export function setViewYaw(yaw: number): void {
  viewYawRad = yaw;
  viewCos = Math.cos(yaw);
  viewSin = Math.sin(yaw);
}

export function viewYaw(): number {
  return viewYawRad;
}

export function screenToGround(x: number, y: number): { x: number; y: number } {
  if (viewYawRad === 0) return { x, y };
  return { x: x * viewCos + y * viewSin, y: -x * viewSin + y * viewCos };
}
