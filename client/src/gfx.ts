// Essais de la refonte graphique, activés par l'adresse de la page :
//   /v2       la version de test : rendu v2 et cadrage isométrique ;
//   ?gfx=v2   rendu v2 seul : décor modélisé (kit Blender), sol éclairé,
//             ombres portées ;
//   ?cam=iso  cadrage isométrique seul (caméra tournée de 45°, champ étroit).
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
