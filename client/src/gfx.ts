// Essais de la refonte graphique, activés par l'adresse de la page :
//   ?gfx=v2   décor modélisé (kit Blender), sol éclairé, ombres portées ;
//   ?cam=iso  cadrage isométrique (caméra tournée de 45°, champ étroit).
// Rien n'est enregistré : sans ces paramètres, le jeu est celui d'avant.
// Ce module ne tire ni three.js ni le moteur : le lobby peut le lire.
const params = new URLSearchParams(typeof location === "undefined" ? "" : location.search);

export const GFX_V2_REQUESTED = params.get("gfx") === "v2";
export const CAM_ISO = params.get("cam") === "iso";

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
const YAW = CAM_ISO ? (ISO_YAW_DEG * Math.PI) / 180 : 0;
const COS = Math.cos(YAW);
const SIN = Math.sin(YAW);
export function screenToGround(x: number, y: number): { x: number; y: number } {
  if (!CAM_ISO) return { x, y };
  return { x: x * COS + y * SIN, y: -x * SIN + y * COS };
}
