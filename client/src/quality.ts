import * as THREE from "three";

export type QualityPreset = "ultra" | "low" | "medium" | "high";

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
  bloomResScale: number;
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
}

const PRESETS: Record<QualityPreset, QualityConfig> = {
  high: {
    preset: "high",
    // 2.0 = on exploite pleinement les écrans Retina/4K — DPR système
    // jusqu'à 2x. Avec resScale 1.0, c'est l'équivalent rendering full
    // native. Désactive le syndrome "everything is mushy" sur écran HiDPI.
    pixelRatio: 2.0,
    resScale: 1.0,
    antialias: true,
    postFx: true,
    bloomEnabled: true,
    // Bloom plus discret : strength 0.5 (vs 0.9), radius 0.35 (vs 0.7
    // hardcoded avant), threshold 0.85 (vs 0.65). Conséquence : seuls les
    // vrais highlights émissifs bloom, et leur halo reste serré au lieu
    // de baver sur tous les edges. Identité "néon glow" préservée mais
    // sans wash.
    bloomStrength: 0.5,
    // bloomResScale 0.5 (et pas 0.75) : avec threshold 0.85 + radius 0.35,
    // les halos sont déjà petits et précis, donc 0.5 ne se voit plus comme
    // blocky. ~3x moins cher que 0.75 sur les passes bloom.
    bloomResScale: 0.5,
    bloomThreshold: 0.85,
    bloomRadius: 0.35,
    // MSAA 2x : Three.js l'expose via WebGLRenderTarget({ samples }) sur le
    // composer. Donne un vrai anti-aliasing hardware sur les arêtes des
    // géométries. 2x au lieu de 4x : 4x plus cher pour un gain marginal vs
    // 2x, et le coût ne peut pas être downscale dynamiquement (contrairement
    // à resScale). 2x est safe sur GPU de génération 1060+, et le système
    // auto-downgrade vers medium si même 2x est trop pour la machine.
    samples: 2,
    // Chroma + film grain : DÉSACTIVÉS par défaut en high. Ces deux
    // effets ajoutent volontairement du blur RGB et du bruit, ce qui
    // lit comme "low qualité" sur les écrans modernes. L'utilisateur
    // peut les rallumer individuellement plus tard si besoin (champ
    // Settings dédié).
    chroma: false,
    filmGrain: false,
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
    dynResMin: 0.75,
    autoDowngrade: true,
  },
  medium: {
    preset: "medium",
    pixelRatio: 1.0,
    resScale: 1.0,
    antialias: true,
    postFx: true,
    bloomEnabled: true,
    bloomStrength: 0.5,
    bloomResScale: 0.5,
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
    dynResMin: 0.65,
    autoDowngrade: true,
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
    bloomResScale: 0.25,
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
    bloomResScale: 0.2,
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

// Détection plus stricte : on part du principe que sans GPU dédié OU sans
// info GPU disponible, on doit défaut sur low/medium (jamais high). High
// est réservé aux GPU dédiés (NVIDIA/AMD desktop, Apple Silicon).
export function detectPreset(): QualityPreset {
  const saved = localStorage.getItem("blade.quality") as QualityPreset | null;
  if (saved && saved in PRESETS) return saved;

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
  // Intel intégrés récents (Iris, Iris Xe, Arc) → low (postfx off, suffisant
  // pour rester à 60 fps).
  if (gpu.includes("intel")) {
    if (/iris xe|arc/.test(gpu)) return "low";
    return "ultra";
  }
  // Apple Silicon : très bon GPU, mais on reste prudent → medium par défaut,
  // l'utilisateur peut monter à high.
  if (gpu.includes("apple")) return "medium";

  // Mobile : medium par défaut, écran petit, GPU peu puissant.
  if (isMobile) {
    if (cores <= 4 || (mem !== undefined && mem <= 3)) return "low";
    return "medium";
  }

  // GPU AMD : on distingue iGPU (intégré aux APU Ryzen) et dGPU (cartes
  // Radeon RX). Avant : tout "radeon" finissait en high — faux pour les
  // Radeon 780M/880M/890M des Ryzen AI 7000/8000/9000+ qui sont de bons
  // iGPU mais pas un niveau dGPU. Identifie le dGPU au pattern "RX <nb>".
  const isAmdDiscrete = /\brx\s*\d/.test(gpu);
  const isAmdIntegrated = !isAmdDiscrete && /\bamd\b|\bradeon\b|\bvega\b/.test(gpu);
  // GPU NVIDIA : pas d'iGPU NVIDIA en pratique (tous dédiés). Traités en
  // bloc côté dédié.
  const hasNvidia = /nvidia|geforce|gtx|rtx|quadro/.test(gpu);
  if (hasNvidia || isAmdDiscrete) {
    if (mem !== undefined && mem <= 3) return "medium";
    if (cores >= 6) return "high";
    return "medium";
  }
  // iGPU AMD moderne (Radeon Graphics, Vega Mobile, Radeon 7xxM/8xxM/9xxM) :
  // bon pour medium mais pas pour high. Le high (avec MSAA + bloom + pixel
  // ratio 2x) tank une iGPU même quand le CPU autour est un Ryzen 9.
  if (isAmdIntegrated) return "medium";

  // Sans info GPU et CPU faible → low. Sans info GPU mais CPU costaud →
  // medium (pari raisonnable).
  if (cores <= 4) return "low";
  return "medium";
}

export function getPresetConfig(preset: QualityPreset): QualityConfig {
  return { ...PRESETS[preset] };
}

export function savePresetChoice(preset: QualityPreset): void {
  localStorage.setItem("blade.quality", preset);
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
