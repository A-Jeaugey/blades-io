export type QualityPreset = "ultra" | "low" | "medium" | "high";

// Budget des effets de combat (tâche 4.9) : combien peuvent coexister et
// avec quel détail. Chaque effet a une version à chaque niveau ; au-delà
// du plafond, le plus ancien laisse sa place au nouveau.
export interface FxBudget {
  // "rich" : détails animés (stries de la colonne de lumière, double onde à
  // l'élimination, lignes de vitesse des autres joueurs) ; "simple" : les
  // mêmes formes, sans ces détails ; "minimal" : la version la plus légère
  // (moins de facettes, colonne sans cœur, dissolution en blocs).
  detail: "rich" | "simple" | "minimal";
  // Ondes de choc simultanées et facettes de leur anneau.
  shockwaves: number;
  ringSegments: number;
  // Éclats de lame simultanés, et par lame brisée.
  shards: number;
  shardsPerBlade: number;
  // Colonnes de lumière simultanées (passage de palier).
  columns: number;
  // Traînées de lames simultanées (projectiles, aspiration au ramassage) et
  // points de chacune.
  trails: number;
  trailSamples: number;
  // Lignes de vitesse simultanées (boost).
  speedLines: number;
  // Braises qui montent d'un corps qui se dissout.
  dissolveEmbers: number;
}

export interface QualityConfig {
  preset: QualityPreset;
  // Pixel ratio max (multiplié par devicePixelRatio puis clampé).
  pixelRatio: number;
  // Resolution scale appliqué EN PLUS au-dessus du pixelRatio. Permet de
  // sous-résolutionner agressivement (ex: 0.75 = ~56 % des pixels) sans
  // toucher au DPR système.
  resScale: number;
  antialias: boolean;
  // Si false, on bypasse complètement EffectComposer (rendu direct, le moins
  // de surcoût possible).
  postFx: boolean;
  bloomEnabled: boolean;
  bloomStrength: number;
  // Threshold UnrealBloom : pixels au-dessus de cette luminance bloomeront.
  // 0.85 = seuls les vrais highlights → image nette. 0.65 = tout glow → wash.
  bloomThreshold: number;
  // Radius du bloom : taille du halo autour des bright pixels. 0.35 = serré,
  // 0.7 = très diffus. Petit + threshold haut = bloom subtil et précis.
  bloomRadius: number;
  // Samples MSAA pour le RT du composer (0 = off, 4 = standard, 8 = max).
  // Activable seulement quand postFx = true (sinon on rend en direct, l'AA
  // par defaut du WebGLRenderer suffit).
  samples: number;
  chroma: boolean;
  filmGrain: boolean;
  vignette: boolean;
  // Détail du sol shader : "rich" (grilles 4u + 20u, pulse), "simple" (grille
  // 20u), "flat" (couleur unie + edge fade — ultra-léger).
  groundDetail: "rich" | "simple" | "flat";
  // Multiplie les distances de brouillard. Plus petit = brouillard plus
  // proche = moins de géométrie visible (cull naturel).
  fogDensity: number;
  // Toutes les lames/joueurs/caisses utilisent MeshBasic (pas de lighting).
  simpleMaterials: boolean;
  // Nombre de segments du mur frontière (Torus + Cylinder). 128 = high, 64 =
  // medium, 32 = low, 24 = ultra.
  wallSegments: number;
  // Détail des décors : "rich" (tout), "simple" (bushes simplifiés, pas de
  // pads ni d'anneaux), "minimal" (pas de cubes flottants, bushes minimaux,
  // pas d'anneaux). Permet de supprimer les éléments non-collidables sur
  // les machines très faibles.
  decorDetail: "rich" | "simple" | "minimal";
  // Détail des persos : "rich" (corps complet), "low" (capsules simplifiées),
  // "minimal" (un seul mesh corps + tête).
  playerDetail: "rich" | "low" | "minimal";
  // Trail de joueur visible. Off en ultra pour économiser un draw call.
  playerTrail: boolean;
  // Halo de spawn protection. Off en ultra (juste le ring d'ancrage).
  playerHalo: boolean;
  // Wireframe néon des caisses. Off en ultra (juste la box).
  crateWireframe: boolean;
  // Pilier vertical des power-ups (cylindre tall). Off en ultra (orbe seule).
  powerupPillar: boolean;
  // Plafond de particules vivantes simultanément. La pool est dimensionnée
  // ici, donc baisser ce chiffre économise mémoire ET CPU/GPU.
  maxParticles: number;
  // Multiplicateur appliqué au count des bursts (sparks/explosion). 1.0 =
  // normal, 0.5 = moitié des particules par effet.
  particleScale: number;
  // Active la résolution dynamique : si fps < dynResMinFps, on réduit le
  // resScale jusqu'à dynResMin. Si fps > dynResMaxFps, on remonte vers 1.0.
  dynamicResolution: boolean;
  dynResMin: number;
  // Si vrai, on autorise le système à descendre AUTOMATIQUEMENT le preset
  // quand le fps reste trop bas (ex: high → medium → low). Indispensable
  // sur les bécanes incertaines : on démarre haut puis on adapte.
  autoDowngrade: boolean;
  fx: FxBudget;
}

const PRESETS: Record<QualityPreset, QualityConfig> = {
  high: {
    preset: "high",
    // 1.5 (et pas 2.0) : à 2.0 sur 4K, chaque imperfection sub-pixel
    // saute aux yeux et le rendu lit comme "clinique". 1.5 garde la
    // netteté sans révéler chaque défaut. dynamicResolution remonte à
    // 1.0 effectif si fps tient, baisse vers 0.75 sinon.
    pixelRatio: 1.5,
    resScale: 1.0,
    antialias: true,
    postFx: true,
    bloomEnabled: true,
    // Bloom intermediaire : strength 0.65 (entre 0.9 wash et 0.5 cru),
    // mais avec radius 0.35 + threshold 0.85 → les halos restent serrés.
    // L'image garde la chaleur émissive sans baver sur les edges.
    bloomStrength: 0.65,
    bloomThreshold: 0.85,
    bloomRadius: 0.35,
    samples: 2,
    // Chroma + filmGrain RÉACTIVÉS mais à très faible intensité. Sans
    // eux, l'image lit comme un viewport DCC (rendu CGI brut). Ces deux
    // effets ajoutent une "matière" filmique qui masque la sterilité du
    // rendu temps réel et lisse la perception du mouvement à haut fps.
    // Valeurs précises tunées dans PostFX.ts (chroma 0.0006, grain 0.025).
    chroma: true,
    filmGrain: true,
    vignette: true,
    groundDetail: "rich",
    fogDensity: 1,
    simpleMaterials: false,
    wallSegments: 128,
    decorDetail: "rich",
    playerDetail: "rich",
    playerTrail: true,
    playerHalo: true,
    crateWireframe: true,
    powerupPillar: true,
    maxParticles: 800,
    particleScale: 1.0,
    dynamicResolution: true,
    // La résolution absorbe d'abord ce qui manque (même rendu, un peu plus
    // doux) : la baisse de preset, elle, retire des effets.
    dynResMin: 0.6,
    autoDowngrade: true,
    fx: { detail: "rich", shockwaves: 24, ringSegments: 64, shards: 96, shardsPerBlade: 6, columns: 6, trails: 40, trailSamples: 14, speedLines: 48, dissolveEmbers: 36 },
  },
  medium: {
    preset: "medium",
    pixelRatio: 1.0,
    resScale: 1.0,
    antialias: true,
    postFx: true,
    bloomEnabled: true,
    bloomStrength: 0.5,
    bloomThreshold: 0.85,
    bloomRadius: 0.35,
    samples: 0, // pas de MSAA en medium pour économiser le coût GPU
    chroma: false,
    filmGrain: false,
    vignette: true,
    groundDetail: "rich",
    fogDensity: 1,
    simpleMaterials: false,
    wallSegments: 64,
    decorDetail: "simple",
    playerDetail: "rich",
    playerTrail: true,
    playerHalo: true,
    crateWireframe: true,
    powerupPillar: true,
    maxParticles: 500,
    particleScale: 0.8,
    dynamicResolution: true,
    dynResMin: 0.55,
    autoDowngrade: true,
    fx: { detail: "rich", shockwaves: 16, ringSegments: 48, shards: 64, shardsPerBlade: 5, columns: 4, trails: 28, trailSamples: 11, speedLines: 32, dissolveEmbers: 24 },
  },
  low: {
    preset: "low",
    pixelRatio: 1.0,
    resScale: 0.85,
    antialias: false,
    // PostFX OFF en low : on bypasse complètement EffectComposer (rendu
    // direct via renderer.render). Économise le RenderPass + OutputPass +
    // tout le ping-pong des framebuffers, ce qui est le plus gros gain
    // sur GPU intégré.
    postFx: false,
    bloomEnabled: false,
    bloomStrength: 0,
    bloomThreshold: 0.85,
    bloomRadius: 0.35,
    samples: 0,
    chroma: false,
    filmGrain: false,
    vignette: false,
    groundDetail: "simple",
    fogDensity: 0.7,
    simpleMaterials: true,
    wallSegments: 32,
    decorDetail: "simple",
    playerDetail: "low",
    playerTrail: true,
    playerHalo: false,
    crateWireframe: false,
    powerupPillar: true,
    maxParticles: 250,
    particleScale: 0.5,
    dynamicResolution: true,
    dynResMin: 0.5,
    autoDowngrade: true,
    fx: { detail: "simple", shockwaves: 10, ringSegments: 32, shards: 40, shardsPerBlade: 4, columns: 3, trails: 18, trailSamples: 9, speedLines: 16, dissolveEmbers: 12 },
  },
  // "Potato mode" : tout désactivé. Cible : Intel HD anciens, SwiftShader,
  // PCs sans GPU dédié. Objectif : 60 fps stable même sur ces machines.
  ultra: {
    preset: "ultra",
    pixelRatio: 1.0,
    resScale: 0.6,
    antialias: false,
    postFx: false,
    bloomEnabled: false,
    bloomStrength: 0,
    bloomThreshold: 0.85,
    bloomRadius: 0.35,
    samples: 0,
    chroma: false,
    filmGrain: false,
    vignette: false,
    groundDetail: "flat",
    fogDensity: 0.55,
    simpleMaterials: true,
    wallSegments: 24,
    decorDetail: "minimal",
    playerDetail: "minimal",
    playerTrail: false,
    playerHalo: false,
    crateWireframe: false,
    powerupPillar: false,
    maxParticles: 120,
    particleScale: 0.35,
    dynamicResolution: true,
    dynResMin: 0.4,
    autoDowngrade: false,
    fx: { detail: "minimal", shockwaves: 6, ringSegments: 24, shards: 18, shardsPerBlade: 2, columns: 2, trails: 10, trailSamples: 6, speedLines: 8, dissolveEmbers: 0 },
  },
};

// Détection heuristique du GPU via WEBGL_debug_renderer_info.
function readGpuRenderer(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      (canvas.getContext("webgl2") as WebGL2RenderingContext | null) ||
      (canvas.getContext("webgl") as WebGLRenderingContext | null);
    if (!gl) return "";
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    if (!dbg) return "";
    const r = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string | undefined;
    return (r ?? "").toLowerCase();
  } catch {
    return "";
  }
}

declare const __BUILD_ID__: string;

// Qualité retenue au démarrage, dans l'ordre :
//  1. le choix du joueur dans les réglages (autre que « Auto ») ;
//  2. la baisse automatique décidée pendant une partie de cette version
//     (saveAutoDowngrade) ;
//  3. la détection du matériel.
// Avant, une baisse automatique s'enregistrait comme un choix du joueur, et
// pour toujours : un ralentissement passager (les compilations de shaders
// d'avant la tâche 2.9) laissait une machine en qualité moyenne ou basse,
// sans retour. Ces anciennes valeurs (« blade.quality » sans choix dans les
// réglages) sont ignorées et effacées.
export function detectPreset(): QualityPreset {
  const chosen = chosenPreset();
  if (chosen) return chosen;
  if (localStorage.getItem(LEGACY_KEY) !== null) localStorage.removeItem(LEGACY_KEY);
  return autoDowngraded() ?? detectHardwarePreset();
}

const LEGACY_KEY = "blade.quality";
const AUTO_KEY = "blade.quality.auto";

function isPreset(v: unknown): v is QualityPreset {
  return typeof v === "string" && v in PRESETS;
}

// Le joueur a-t-il choisi sa qualité dans les réglages ? Le moniteur de
// fluidité ne baisse alors jamais le preset (seulement la résolution).
export function hasChosenPreset(): boolean {
  return chosenPreset() !== null;
}

// Choix explicite des réglages (Settings.ts : qualityChoice).
function chosenPreset(): QualityPreset | null {
  try {
    const settings = JSON.parse(localStorage.getItem("blade.settings") ?? "null") as { qualityChoice?: unknown } | null;
    const choice = settings?.qualityChoice;
    return isPreset(choice) ? choice : null;
  } catch {
    return null;
  }
}

function autoDowngraded(): QualityPreset | null {
  try {
    const saved = JSON.parse(localStorage.getItem(AUTO_KEY) ?? "null") as { preset?: unknown; build?: unknown } | null;
    if (!saved || saved.build !== __BUILD_ID__ || !isPreset(saved.preset)) return null;
    return saved.preset;
  } catch {
    return null;
  }
}

// Baisse automatique (moniteur de fluidité de main.ts) : gardée jusqu'à la
// prochaine version du jeu, qui retente la qualité détectée (chaque version
// peut alléger le rendu), et jamais au-dessus d'un choix du joueur.
export function saveAutoDowngrade(preset: QualityPreset): void {
  localStorage.setItem(AUTO_KEY, JSON.stringify({ preset, build: __BUILD_ID__ }));
}

// Détection heuristique d'après le GPU. Toute carte dédiée démarre en
// qualité haute, même d'entrée de gamme : sous la haute qualité, le néon
// perd son bloom et le jeu paraît terne, et la résolution dynamique adapte
// la charge sans toucher au rendu (cf. adaptiveQuality, main.ts). Les
// presets plus bas restent pour les GPU intégrés anciens, le rendu
// logiciel et les téléphones.
function detectHardwarePreset(): QualityPreset {
  const gpu = readGpuRenderer();
  const ua = navigator.userAgent.toLowerCase();
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as any).deviceMemory as number | undefined;
  const isMobile = /android|iphone|ipad|mobile/.test(ua);

  // Software renderer = catastrophique pour 3D temps réel → ultra.
  if (gpu.includes("swiftshader") || gpu.includes("llvmpipe") || gpu.includes("software")) {
    return "ultra";
  }
  // Très peu de cœurs ou très peu de RAM → ultra.
  if (cores <= 2) return "ultra";
  if (mem !== undefined && mem <= 2) return "ultra";

  // Intel HD/UHD anciens (HD 2000–6000, UHD 6xx) → ultra.
  if (
    gpu.includes("intel") &&
    /hd (2|3|4|5|6)000|hd graphics (2|3|4|5|6)|uhd (6|6[0-3]0)|hd 4000/.test(gpu)
  ) {
    return "ultra";
  }
  // Intel : Arc (carte dédiée, ou intégrée des Core Ultra, du niveau d'une
  // GTX 1650) → haute ; Iris Xe → moyenne (bloom gardé) ; le reste → ultra.
  // ANGLE écrit « Iris(R) Xe » : le motif « iris xe » d'avant ne le
  // reconnaissait pas, et ces portables démarraient en potato.
  if (gpu.includes("intel")) {
    if (/\barc\b/.test(gpu)) return "high";
    if (/iris(\(r\))?\s*xe/.test(gpu)) return "medium";
    return "ultra";
  }
  // Apple Silicon : GPU du niveau d'une carte dédiée.
  if (gpu.includes("apple")) return "high";

  // Mobile : medium par défaut, écran petit, GPU peu puissant.
  if (isMobile) {
    if (cores <= 4 || (mem !== undefined && mem <= 3)) return "low";
    return "medium";
  }

  // GPU AMD : on distingue iGPU (intégré aux APU Ryzen) et dGPU (cartes
  // Radeon RX), au motif « RX <nb> ».
  const isAmdDiscrete = /\brx\s*\d/.test(gpu);
  const isAmdIntegrated = !isAmdDiscrete && /\bamd\b|\bradeon\b|\bvega\b/.test(gpu);
  // GPU NVIDIA : pas d'iGPU NVIDIA en pratique (tous dédiés).
  const hasNvidia = /nvidia|geforce|gtx|rtx|quadro/.test(gpu);
  if (hasNvidia || isAmdDiscrete) return "high";
  // iGPU AMD : les RDNA 2 et 3 des Ryzen 6000 et suivants (660M à 890M) sont
  // du niveau d'une petite carte dédiée → haute ; les Vega d'avant → moyenne.
  if (isAmdIntegrated) return /\b(6[6-8]0|7[4-8]0|8[4-9]0)m\b/.test(gpu) ? "high" : "medium";

  // Sans info GPU et CPU faible → low. Sans info GPU mais CPU costaud →
  // medium (pari raisonnable).
  if (cores <= 4) return "low";
  return "medium";
}

export function getPresetConfig(preset: QualityPreset): QualityConfig {
  return { ...PRESETS[preset] };
}

// Choix du joueur dans les réglages (il prime sur toute baisse
// automatique) ; « Auto » efface les deux.
export function savePresetChoice(preset: QualityPreset | "auto"): void {
  localStorage.removeItem(AUTO_KEY);
  if (preset === "auto") localStorage.removeItem(LEGACY_KEY);
  else localStorage.setItem(LEGACY_KEY, preset);
}

// Renvoie l'ordre de downgrade : high → medium → low → ultra. Utilisé par
// le moniteur FPS pour basculer automatiquement quand on rame.
export function nextLowerPreset(p: QualityPreset): QualityPreset | null {
  switch (p) {
    case "high": return "medium";
    case "medium": return "low";
    case "low": return "ultra";
    case "ultra": return null;
  }
}
