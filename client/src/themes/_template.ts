import * as THREE from "three";
import { BladeRarity, PowerUpType } from "@bladeio/shared";
import { Theme, computeRarityGlowComp } from "./Theme";

// ─────────────────────────────────────────────────────────────────────────────
// Theme template — base de départ pour créer un nouveau thème.
//
// MODE D'EMPLOI :
//   1. Copier ce fichier vers `themes/<your-id>.ts`
//   2. Renommer `TEMPLATE_THEME` en `<YOURID>_THEME`
//   3. Changer `id`, `displayName`, et toutes les couleurs/shaders/musiques
//   4. Enregistrer le nouveau thème dans `themes/index.ts` :
//        import { YOURID_THEME } from "./<your-id>";
//        export const THEMES = { ..., [YOURID_THEME.id]: YOURID_THEME };
//   5. (Optionnel) Si tu veux un visuel de décor radicalement différent
//      (cristaux, machines, plantes carnivores…), ajoute un nouveau `kind`
//      dans `DecorVariant` (Theme.ts) et une fonction `create<Kind>Decor()`
//      dans `Decor.ts`. Sinon, réutilise `cyber` ou `spirit` en changeant
//      juste les couleurs.
//
// IMPORTANT : ce fichier n'est PAS enregistré dans `themes/index.ts` — il ne
// figure pas dans le dropdown Settings. C'est volontaire : il sert de modèle,
// pas de thème jouable.
//
// Toutes les valeurs ci-dessous sont des placeholders. Les couleurs magenta
// `0xff00ff` et cyan `0x00ffff` sont là EXPRÈS pour que tout champ oublié se
// voie immédiatement à l'œil (un truc tout magenta dans le rendu = j'ai oublié
// de remplir ce champ-là).
// ─────────────────────────────────────────────────────────────────────────────

// ─── 1) Couleurs des 4 raretés ───────────────────────────────────────────────
// Convention recommandée : chaque rareté doit être visuellement distincte au
// premier coup d'œil (palette resserrée mais contraste élevé entre les 4).
// La compensation de bloom est calculée auto via computeRarityGlowComp().
const TEMPLATE_RARITY_COLOR: Record<BladeRarity, number> = {
  [BladeRarity.Common]:    0xff00ff, // ← TODO : ta couleur Common (la + fréquente, doit rester discrète)
  [BladeRarity.Rare]:      0xff00ff, // ← TODO
  [BladeRarity.Epic]:      0xff00ff, // ← TODO
  [BladeRarity.Legendary]: 0xff00ff, // ← TODO : doit ressortir IMMÉDIATEMENT (souvent une teinte chaude dans une mer froide, ou inversement)
};

// ─── 2) Shaders du sol (3 niveaux de qualité obligatoires) ───────────────────
// `uTime` (rich seulement) et `uRadius` sont fournis par Ground.ts.
// Tout autre uniform doit être déclaré ET rempli par `buildExtraUniforms()`.
//
// Les 3 versions ci-dessous ne font qu'un fond plat avec edge fade — assez
// pour que le jeu compile et tourne, mais visuellement vide. Remplace par ce
// que tu veux (grille, brume FBM, lave animée, glace cristalline, etc.).

const TEMPLATE_FRAG_RICH = /* glsl */ `
  precision highp float;
  varying vec2 vWorld;
  uniform float uTime;
  uniform float uRadius;
  uniform vec3 uBase;

  // TODO : ton effet de sol "rich" ici. Référence : sanctuaire.ts pour FBM
  // organique, neon.ts pour grille double échelle.
  void main() {
    float r = length(vWorld);
    float edgeFade = smoothstep(uRadius, uRadius - 60.0, r);
    gl_FragColor = vec4(uBase * edgeFade, 1.0);
  }
`;

const TEMPLATE_FRAG_SIMPLE = /* glsl */ `
  precision highp float;
  varying vec2 vWorld;
  uniform float uRadius;
  uniform vec3 uBase;

  // TODO : version simplifiée du shader rich (1-2 octaves de bruit max,
  // pas d'animation lourde). Cible : Iris Xe / Apple M1 / GPU mobiles.
  void main() {
    float r = length(vWorld);
    float edgeFade = smoothstep(uRadius, uRadius - 40.0, r);
    gl_FragColor = vec4(uBase * edgeFade, 1.0);
  }
`;

const TEMPLATE_FRAG_FLAT = /* glsl */ `
  precision lowp float;
  varying vec2 vWorld;
  uniform float uRadius;
  uniform vec3 uBase;

  // Niveau "ultra" / Potato Mode. Reste dans le minimum vital : couleur unie
  // + edge fade. Pas d'uniforms additionnels nécessaires en général.
  void main() {
    float r = length(vWorld);
    float edgeFade = smoothstep(uRadius, uRadius - 30.0, r);
    gl_FragColor = vec4(uBase * edgeFade, 1.0);
  }
`;

// ─── 3) Uniforms additionnels du shader ──────────────────────────────────────
// Si tes shaders utilisent des uniforms en plus de uTime/uRadius (typiquement
// des couleurs vec3), déclare-les ici. La fonction est appelée une fois à
// l'init du Ground, pas par frame.
function buildTemplateUniforms(detail: "rich" | "simple" | "flat"): Record<string, THREE.IUniform> {
  // TODO : si tu as plusieurs couleurs, calcule-les ici depuis tes constantes
  // hex (utilise `new THREE.Color(0x...)` puis `new THREE.Vector3(c.r, c.g, c.b)`).
  // Le shader template ci-dessus n'utilise que `uBase`.
  const baseColor = new THREE.Color(0xff00ff); // ← TODO : ta couleur de base
  return {
    uBase: { value: new THREE.Vector3(baseColor.r, baseColor.g, baseColor.b) },
  };
}

// ─── 4) Theme objet final ────────────────────────────────────────────────────
export const TEMPLATE_THEME: Theme = {
  // ID stable utilisé en localStorage et dans le registre. Lowercase, court,
  // sans espaces. Doit être unique parmi tous les thèmes enregistrés.
  id: "template",
  // Nom affiché à l'utilisateur dans le dropdown Settings et la future
  // boutique. Garde-le court (s'affiche dans une <option>).
  displayName: "Thème vierge",

  // ─── Palette monde + entités + FX ───
  palette: {
    // Couleur de fond du renderer (ce qu'on voit aux bords/au-dessus du sol).
    clearColor: 0xff00ff,
    // Couleur du brouillard de distance — souvent très proche du clearColor
    // pour que les objets lointains se "fondent" au lieu de pop.
    fogColor: 0xff00ff,
    // Couleur du mur frontière (zone fatale). Doit attirer l'œil → souvent
    // une teinte chaude ou saturée différente du reste.
    boundary: 0xff00ff,
    // Joueur local (toi) : 3 teintes (corps, ring, halo subtil).
    playerLocal: {
      primary: 0xff00ff,    // ← TODO : couleur du corps
      accent: 0x00ffff,     // ← TODO : couleur du ring au sol + halo
      accentDim: 0xff00ff,  // ← TODO : version sombre pour l'emissive subtil
    },
    // Joueur distant (les autres) : doit se distinguer du local au premier
    // regard pour la lisibilité .io.
    playerRemote: {
      primary: 0xff00ff,
      accent: 0x00ffff,
      accentDim: 0xff00ff,
    },
    // Caisses de loot : 3 teintes (matériau interne, glow émissif, edges).
    crate: {
      primary: 0xff00ff,
      emissive: 0x00ffff,
      edge: 0xff00ff,
    },
    // Couleurs des 4 raretés (cf. constante en haut du fichier).
    rarityColor: TEMPLATE_RARITY_COLOR,
    // Compensation de bloom calculée auto — n'y touche pas sauf raison précise.
    rarityGlowComp: computeRarityGlowComp(TEMPLATE_RARITY_COLOR),
    // Couleurs des power-ups par TYPE (pas par rareté). 5 types distincts.
    // Choisis 5 teintes lisibles à 50% de zoom — c'est l'élément le plus
    // sensible visuellement au moment du pickup.
    powerUpColor: {
      [PowerUpType.Speed]:   0xff00ff, // ← TODO
      [PowerUpType.Spin]:    0xff00ff, // ← TODO
      [PowerUpType.Magnet]:  0xff00ff, // ← TODO
      [PowerUpType.Shield]:  0xff00ff, // ← TODO
      [PowerUpType.Blades]:  0xff00ff, // ← TODO
    },
    // Couleurs des bursts de particules pour les événements de jeu. Souvent
    // dérivées de la palette principale pour la cohérence.
    fx: {
      crateHitSpark:           0xff00ff,
      crateDestroyExplosion:   0xff00ff,
      deathExplosion:          0xff00ff,
      clashSpark:              0xff00ff,
      tierUpHi:                0xff00ff, // tier >= 2 (legendary tier-up)
      tierUpLo:                0x00ffff, // tier 0/1 (common/rare tier-up)
      // Fallbacks utilisés quand la couleur principale n'est pas disponible
      // (cas de figure rare mais nécessaire pour ne pas crasher).
      powerUpFallback:         0xff00ff,
      bladeFallback:           0xff00ff,
    },
  },

  // ─── Lumières ───
  // Trois sources : ambient (toute la scène), key (lumière principale, comme
  // le soleil), rim (contre-jour qui découpe les silhouettes).
  // En quality "low"/"ultra" (simpleMaterials = true), seul l'ambient est
  // utilisé — les key/rim sont skippées par Scene.ts. Garde-les quand même.
  lighting: {
    ambient: { color: 0xff00ff, intensity: 0.55 }, // ← TODO : teinte globale, intensité 0.4-0.7
    key:     { color: 0xff00ff, intensity: 0.4 },  // ← TODO : "soleil"
    rim:     { color: 0x00ffff, intensity: 0.3 },  // ← TODO : contre-jour
  },

  // ─── Style des lames ───
  // Trois leviers pour faire passer les lames d'épées métalliques (shininess
  // élevée + spec blanc) à des shards éthérés (shininess basse + spec teinté).
  blades: {
    shininess: 50,           // 0 (mat) → 100 (très brillant). Néon = 80, sanctuaire = 30.
    specularColor: 0xffffff, // teinte du highlight spéculaire (souvent 0xffffff pour réaliste, teinté pour stylisé)
    emissiveBoost: 1.0,      // multiplier global sur l'emissive intensity. >1.0 = lames plus brillantes
  },

  // ─── Variant de décor ───
  // Choisis le `kind` qui correspond à ton ambiance :
  //   - "cyber"  : pilier émissif + obélisques cônes + cubes flottants + bushes cylindre+sphères
  //   - "spirit" : pilier doré + pierres dressées + lanternes 3 couches + bosquets de champignons
  //
  // Pour un kind ENTIÈREMENT NOUVEAU (ex : cristaux de glace), ajoute-le
  // dans DecorVariant (Theme.ts) + crée createGlacialDecor() dans Decor.ts.
  //
  // L'exemple ci-dessous utilise `cyber` — change si besoin.
  decor: {
    kind: "cyber",
    shrineCore:    0xff00ff, // ← TODO : pilier central émissif
    shrineHalo:    0x00ffff, // ← TODO : torus au sol autour du pilier
    obeliskInner:  0x00ffff, // ← TODO : couleur des 10 cônes proches du centre
    obeliskOuter:  0xff00ff, // ← TODO : couleur des cônes extérieurs
    cubeColor:     0xff00ff, // ← TODO : cubes flottants émissifs
    bushFoliage:   0xff00ff, // ← TODO : tronc des bushes (mauve/vert/etc.)
    bushAccent:    0x00ffff, // ← TODO : sphères halo des bushes
    groundPad:     0x00ffff, // ← TODO : sceaux ronds au sol
    ringHint:      0xff00ff, // ← TODO : anneaux concentriques très diffus
  },
  // Variante alternative — décommenter et commenter le bloc ci-dessus si tu
  // préfères le décor spirit (champignons + lanternes). Il a 4 champs en plus :
  //
  // decor: {
  //   kind: "spirit",
  //   shrineCore:        0xff00ff,
  //   shrineHalo:        0x00ffff,
  //   obeliskInner:      0xff00ff,
  //   obeliskOuter:      0x00ffff,
  //   lanternCoreColor:  0xff00ff,  // crème de la "flamme" du cœur octaèdrique
  //   lanternEmissive:   0xff00ff,  // glow émissif du cœur
  //   lanternCage:       0xff00ff,  // anneau équatorial
  //   lanternHalo:       0xff00ff,  // halo additif autour
  //   mushroomStem:      0xff00ff,  // pied (clair/crème)
  //   mushroomCap:       0x00ffff,  // chapeau translucide
  //   mushroomUnderglow: 0xff00ff,  // glow rose sous le chapeau
  //   mossColor:         0xff00ff,  // mousse au sol entre les champis
  //   groundPad:         0x00ffff,
  //   ringHint:          0xff00ff,
  // },

  // ─── Particules ambient ───
  // Set à `null` si ton thème n'a pas besoin de particules d'arrière-plan
  // (cas neon — la grille fait déjà le boulot d'ambiance).
  ambient: {
    wisps: null, // ← TODO : null si pas de particules, ou bien :
    // wisps: {
    //   counts: { high: 80, medium: 50, low: 30, ultra: 18 },
    //   colors: [0xff00ff, 0x00ffff],         // pool piochée au spawn
    //   drifSpeedMin: 0.6,                     // u/s
    //   drifSpeedMax: 1.2,
    // },
  },

  // ─── Musique ───
  // Chemins relatifs au BASE_URL Vite (= servis depuis `client/public/`).
  // Pour intégrer tes fichiers : déposer les .mp3 source à la racine du repo,
  // puis ajouter une ligne dans `client/package.json` → script `sync-music`.
  music: {
    lobby:  "lobby-template.mp3",   // ← TODO : ton MP3 ambient/lounge
    battle: "battle-template.mp3",  // ← TODO : ton MP3 action
  },

  // ─── Ground (shader) ───
  ground: {
    fragRich:   TEMPLATE_FRAG_RICH,
    fragSimple: TEMPLATE_FRAG_SIMPLE,
    fragFlat:   TEMPLATE_FRAG_FLAT,
    buildExtraUniforms: buildTemplateUniforms,
  },

  // ─── Palette UI (CSS variables) ───
  // Injectées au boot par applyThemeCss() dans :root. Toutes les règles CSS
  // utilisent var(--cyan), var(--pink), etc. donc aucun fichier CSS à toucher.
  // Format : strings hex pour les couleurs, rgba(...) pour les semi-transparents.
  ui: {
    accentCool:    "#ff00ff",                    // → --cyan (accent froid principal du UI)
    accentWarm:    "#00ffff",                    // → --pink (accent chaud, hover, glows)
    purple:        "#ff00ff",                    // → --purple (accents secondaires)
    dark:          "#000000",                    // → --dark (background principal du UI)
    panelBg:       "rgba(255, 0, 255, 0.82)",    // → --panel (background des cartes/panels)
    panelBorder:   "rgba(0, 255, 255, 0.35)",    // → --panel-border (bordures fines)
    fgBright:      "#ffffff",                    // → --fg-bright (texte principal)
    fgMuted:       "#888888",                    // → --fg-muted (texte secondaire/labels)
    // Composantes RGB des accents (pour les box-shadow rgba). Doit matcher
    // accentCool / accentWarm en hex → composantes RGB en string.
    accentCoolRgb: "255, 0, 255",                // = accentCool
    accentWarmRgb: "0, 255, 255",                // = accentWarm
  },

  // ─── Position de la caméra ───
  // Point de vue ABSOLU par rapport au joueur (offset). Y = hauteur, Z = recul.
  // L'angle d'inclinaison = atan(Y/Z) depuis l'horizontale. Recommandations :
  //   - Top-down strict (Y >> Z) : laid mais ultra-lisible
  //   - 45° (Y ≈ Z)              : isométrique, beau mais occlusion problématique en .io
  //   - 50-55° (Y > Z légèrement) : sweet spot pour la plupart des thèmes
  //
  // Néon = (0, 22, 16) ≈ 54°. Sanctuaire = (0, 19, 17) ≈ 48°.
  cameraOffset: { x: 0, y: 22, z: 16 }, // ← TODO : ajuste selon le mood (plus penché = plus immersif, plus plat = plus lisible)
};
