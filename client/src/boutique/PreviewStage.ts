import * as THREE from "three";
import { BladeRarity, CosmeticSlot, Loadout } from "@bladeio/shared";
import { QualityConfig } from "../quality";
import { getActiveTheme } from "../themes";
import { PlayerView } from "../entities/PlayerView";
import { BladeRenderer, PlayerPositionProvider } from "../entities/BladeView";
import { ParticlePool } from "../fx/Particles";
import { BLADE_STYLES, KILL_FX_LOOKS, lookOf } from "../cosmetics/looks";
import { cosmeticName, t } from "../i18n";

// Aperçu 3D de la boutique (tâche 6.4) : le personnage avec l'équipement
// essayé (skin, style de lames, traînée, effet d'élimination), avec les vrais
// modules de rendu du jeu, aux couleurs du thème actif. Un seul canvas,
// déplacé dans l'onglet affiché ; la boucle ne tourne que boutique ouverte
// et page visible. Pas de post-FX : un second rendu léger, mobiles compris.

const OWNER = "stage";
const RARITIES = [BladeRarity.Common, BladeRarity.Rare, BladeRarity.Epic, BladeRarity.Legendary];
// Le personnage tourne en rond, assez vite pour tirer sa traînée.
const WALK_RADIUS = 1.4;
const WALK_SPEED = 2.1;
const BURST_EVERY = 2.6;

export class PreviewStage {
  readonly el: HTMLElement;
  private readonly caption: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(36, 2, 0.5, 60);
  private readonly player: PlayerView;
  private readonly blades: BladeRenderer;
  private readonly particles: ParticlePool;
  // Dague (palier 0) : des lames plus grandes masqueraient le personnage.
  private readonly pose = { x: 0, y: 0, spinPhase: 0, theta: 0, tier: 0, bladeCount: RARITIES.length * 2, bladeStyle: 0 };
  private readonly provider: PlayerPositionProvider = { getRenderPosition: (id) => (id === OWNER ? this.pose : undefined) };
  private loadout: Loadout = { skin: "", bladeSkin: "", trail: "", killFx: "" };
  private raf = 0;
  private sized = false;
  private last = 0;
  private clock = 0;
  private nextBurst = 1;

  // null si WebGL manque : la boutique garde ses aperçus CSS.
  static create(q: QualityConfig): PreviewStage | null {
    try {
      return new PreviewStage(q);
    } catch {
      return null;
    }
  }

  private constructor(q: QualityConfig) {
    this.el = document.createElement("div");
    this.el.className = "cos-stage";
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    this.caption = document.createElement("p");
    this.caption.className = "cos-stage-caption";
    this.el.append(canvas, this.caption);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: q.antialias, alpha: true, powerPreference: "low-power" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio, 2));

    const theme = getActiveTheme();
    this.scene.add(new THREE.AmbientLight(theme.lighting.ambient.color, theme.lighting.ambient.intensity));
    if (!q.simpleMaterials) {
      const key = new THREE.DirectionalLight(theme.lighting.key.color, theme.lighting.key.intensity);
      key.position.set(20, 40, 20);
      const rim = new THREE.DirectionalLight(theme.lighting.rim.color, theme.lighting.rim.intensity);
      rim.position.set(-30, 20, -20);
      this.scene.add(key, rim);
    }
    // Socle : le sol du thème, et son anneau. Opaque : dessiné avant les
    // objets transparents, il ne recouvre pas la traînée.
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(3.4, 48),
      new THREE.MeshBasicMaterial({ color: theme.ground.colors.base }),
    );
    disc.rotation.x = -Math.PI / 2;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3.3, 3.4, 64),
      new THREE.MeshBasicMaterial({ color: theme.palette.playerLocal.accent, transparent: true, opacity: 0.35 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    this.scene.add(disc, ring);

    this.player = new PlayerView(true, q);
    this.scene.add(this.player.root, this.player.trail);
    this.blades = new BladeRenderer(q.simpleMaterials);
    this.scene.add(this.blades.root);
    RARITIES.forEach((r, i) => {
      this.blades.upsert(`stage-${i}`, r, OWNER, 0, i, 0, 0, 0);
      this.blades.upsert(`stage-${i + 4}`, r, OWNER, 0, i + 4, 0, 0, 0);
    });
    this.particles = new ParticlePool(400, q.particleScale);
    this.scene.add(this.particles.object3d);

    // Plus près et moins plongeante que la caméra de jeu : on regarde un
    // objet, sa traînée au sol comprise.
    this.camera.position.set(0, 4.6, 7.8);
    this.camera.lookAt(0, 0.6, 0);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && this.raf) this.last = performance.now();
    });
    window.addEventListener("resize", () => { this.sized = false; });
  }

  // Équipement essayé : celui du joueur, avec les cartes choisies par-dessus.
  setLoadout(lo: Loadout): void {
    this.loadout = { ...lo };
    this.player.applyCosmetics(lo.skin, lo.trail);
    this.pose.bladeStyle = lookOf(BLADE_STYLES, lo.bladeSkin) ?? 0;
    const names = (Object.keys(lo) as CosmeticSlot[]).filter((s) => lo[s]).map((s) => cosmeticName(s, lo[s]));
    this.caption.textContent = names.length ? names.join(" · ") : t("shop.stageBase");
  }

  // Place le canvas dans l'emplacement de l'onglet affiché et lance la boucle.
  show(slot: HTMLElement): void {
    if (this.el.parentElement !== slot) slot.appendChild(this.el);
    this.sized = false;
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  // Taille de l'emplacement : lue à la première image où il est affiché
  // (largeur nulle tant que l'onglet est caché).
  private resize(): void {
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    if (w === 0 || h === 0) return;
    this.sized = true;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Écran étroit : la caméra recule pour garder le personnage et ses
    // lames en entier.
    const back = Math.max(1, 1.6 / this.camera.aspect);
    this.camera.position.set(0, 4.6 * back, 7.8 * back);
    this.camera.lookAt(0, 0.6, 0);
    this.camera.updateProjectionMatrix();
  }

  // performance.now() plutôt que l'horodatage de requestAnimationFrame, qui
  // peut précéder l'instant où la boucle a démarré : un pas négatif faisait
  // reculer l'horloge (ni traînée, ni salve). Pas borné à [0, 50 ms].
  private frame = (): void => {
    this.raf = requestAnimationFrame(this.frame);
    if (document.hidden) return;
    const now = performance.now();
    const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000));
    this.last = now;
    this.clock += dt;
    if (!this.sized) this.resize();
    if (!this.sized) return;

    const a = this.clock * WALK_SPEED;
    const x = Math.cos(a) * WALK_RADIUS;
    const z = Math.sin(a) * WALK_RADIUS;
    this.player.setLocalRender(x, z);
    this.player.animate(dt);
    this.player.updateTrail(dt);
    this.pose.x = x;
    this.pose.y = z;
    this.pose.theta = this.clock * 2.4;
    this.blades.update(now, 0, this.clock, this.provider);

    // Effet d'élimination à côté du personnage, à intervalle régulier.
    if (this.clock >= this.nextBurst) {
      this.nextBurst = this.clock + BURST_EVERY;
      const fx = lookOf(KILL_FX_LOOKS, this.loadout.killFx);
      const bx = Math.cos(a + 2.4) * 2.2;
      const bz = Math.sin(a + 2.4) * 2.2;
      if (fx) this.particles.spawnBurst(bx, 1, bz, fx);
      else this.particles.spawnExplosion(bx, 1, bz, getActiveTheme().palette.fx.deathExplosion, 40);
    }
    this.particles.update(dt);
    this.renderer.render(this.scene, this.camera);
  };
}
