import * as THREE from "three";
import {
  BladeRarity,
  CLIENT_INPUT_RATE,
  ClashEvent,
  MAP_RADIUS,
  MAX_BLADES_PER_PLAYER,
  LOW_BLADE_WARNING,
  PLAYER_BOOST_MULT,
  PLAYER_BODY_RADIUS,
  PLAYER_SPEED,
  TIER_UP_SHAKE,
  TierUpEvent,
  WALL_KILL_THICKNESS,
  BladeDestroyedEvent,
  BladeThrownEvent,
  CrateDestroyedEvent,
  CrateHitEvent,
  PickupEvent,
  PlayerKilledEvent,
  ProjectileImpactEvent,
  POWERUP_COLOR,
  POWERUP_DURATION,
  PowerUpPickupEvent,
  PowerUpType,
  RARITY_COLOR,
  isInBush,
  resolveDecorCollision,
  tierClashShake,
} from "@bladeio/shared";
import { getStateCallbacks } from "colyseus.js";
import { Connection, resolveServerEndpoint } from "./net/Connection";
import { SceneStack } from "./scene/Scene";
import { createGround, createBoundaryWall } from "./scene/Ground";
import { createDecor } from "./scene/Decor";
import { PostFX } from "./scene/PostFX";
import { CameraRig } from "./scene/Camera";
import { PlayerView } from "./entities/PlayerView";
import { BladeRenderer, PlayerPositionProvider } from "./entities/BladeView";
import { CrateRenderer } from "./entities/CrateView";
import { PowerUpRenderer } from "./entities/PowerUpView";
import { ParticlePool } from "./fx/Particles";
import { InputManager } from "./input/InputManager";
import { Hud } from "./ui/Hud";
import { LoginScreen, LoginResult } from "./ui/LoginScreen";
import { DeathScreen } from "./ui/DeathScreen";
import { Leaderboard } from "./ui/Leaderboard";
import { Minimap } from "./ui/Minimap";
import { SettingsPanel } from "./ui/Settings";
import { SoundManager } from "./audio/SoundManager";
import { detectPreset, getPresetConfig, nextLowerPreset, QualityConfig, savePresetChoice } from "./quality";
import { auth } from "./auth/supabase";
import { ensureGuestToken, getGuestToken } from "./auth/guestToken";
import { wallet } from "./auth/wallet";

const RENDER_DELAY = 150;

class Game {
  private canvas: HTMLCanvasElement;
  private sceneStack: SceneStack;
  private postFx: PostFX;
  private camera: CameraRig;
  private ground: { mesh: THREE.Mesh; update: (t: number) => void };
  private wall: THREE.Object3D;
  private decor: { group: THREE.Object3D; update: (t: number) => void };
  private players = new Map<string, PlayerView>();
  private blades!: BladeRenderer;
  private crates!: CrateRenderer;
  private powerups!: PowerUpRenderer;
  // Durée max observée pour chaque effet actif local — sert à normaliser
  // la barre du badge dans le HUD (sinon on ne sait pas combien il restait
  // au départ).
  private effectDurations: Map<string, number> = new Map();
  private particles!: ParticlePool;
  // Moniteur FPS adaptatif : si fps reste sous le seuil pendant une fenêtre,
  // on baisse la résolution dynamiquement (resScale) ; si ça ne suffit pas,
  // on downgrade le preset (low → ultra). Si le fps remonte durablement, on
  // remonte le resScale.
  private dynResMonitorAccum = 0;
  private lowFpsAccum = 0;
  private highFpsAccum = 0;
  private lastDowngradeAt = 0;
  private input: InputManager;
  private hud: Hud;
  private login: LoginScreen;
  private death: DeathScreen;
  private leaderboard: Leaderboard;
  private minimap: Minimap;
  private settings: SettingsPanel;
  private sound = new SoundManager();
  private conn: Connection;
  private myId = "";
  private myName = "";
  private room: any = null;
  private running = true;
  private lastInputSent = 0;
  private elapsed = 0;
  private fps = 60;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private lastBladeCountShown = 0;
  private dead = false;
  private lastHudUpdate = 0;
  private quality: QualityConfig;
  private predX = 0;
  private predY = 0;
  private predPrevX = 0;
  private predPrevY = 0;
  private errX = 0;
  private errY = 0;
  private simAccum = 0;
  private readonly SIM_DT = 1 / 60;
  private readonly ERR_DECAY_TAU = 0.15;
  private predInit = false;
  private inputSeq = 0;
  private topPlayerId: string | null = null;
  // Edge-trigger throw : on stocke un appui détecté entre deux sendInput()
  // (input rate ~30 Hz, alors que la frame tourne à 60 Hz). Sans ça, un
  // appui dans la frame de gap entre deux sends se perd.
  private throwLatched = false;
  // Rayon d'audibilité des SFX spatialisés (clash, lancer, impact, pickup
  // distant…). En deçà de NEAR le son joue à plein volume, au-delà de FAR il
  // est muet, entre les deux on atténue linéairement. Sans ce gating, les
  // bruits de toute la map deviennent un brouhaha illisible.
  private readonly HEAR_NEAR = 22;
  private readonly HEAR_FAR = 55;

  constructor() {
    this.canvas = document.getElementById("game") as HTMLCanvasElement;
    this.quality = getPresetConfig(detectPreset());
    console.log(`[blade.io] quality preset: ${this.quality.preset}`);
    this.sceneStack = new SceneStack(this.canvas, this.quality);
    this.postFx = new PostFX(this.sceneStack.renderer, this.sceneStack.scene, this.sceneStack.camera, this.quality);
    this.camera = new CameraRig(this.sceneStack.camera);
    this.blades = new BladeRenderer(this.quality.simpleMaterials);
    this.crates = new CrateRenderer(this.quality);
    this.powerups = new PowerUpRenderer(this.quality);
    this.particles = new ParticlePool(this.quality.maxParticles, this.quality.particleScale);
    this.ground = createGround(this.quality);
    this.sceneStack.scene.add(this.ground.mesh);
    this.wall = createBoundaryWall(this.quality);
    this.sceneStack.scene.add(this.wall);
    this.decor = createDecor(this.quality);
    this.sceneStack.scene.add(this.decor.group);
    this.sceneStack.scene.add(this.blades.root);
    this.sceneStack.scene.add(this.crates.root);
    this.sceneStack.scene.add(this.powerups.root);
    this.sceneStack.scene.add(this.particles.object3d);
    this.hud = new Hud();
    this.leaderboard = new Leaderboard();
    this.minimap = new Minimap();
    this.settings = new SettingsPanel();
    this.login = new LoginScreen((res) => this.start(res));
    this.death = new DeathScreen(() => this.respawn(), () => this.returnToMenu());
    this.input = new InputManager(
      this.canvas,
      document.getElementById("joystick")!,
      document.getElementById("joystick-base")!,
      document.getElementById("joystick-thumb")!,
      document.getElementById("boost-btn")!,
      document.getElementById("throw-btn"),
    );
    if (this.input.isTouch) {
      document.getElementById("joystick")!.classList.remove("hidden");
      document.getElementById("boost-btn")!.classList.remove("hidden");
      document.getElementById("throw-btn")!.classList.remove("hidden");
    }
    this.settings.onChange((s) => {
      this.sound.setVolumes(s.master, s.music, s.sfx);
      this.input.setSensitivity(s.joystickSens);
    });
    this.settings.onQuit(() => {
      this.returnToMenu();
    });
    this.conn = new Connection(resolveServerEndpoint());
    window.addEventListener("beforeunload", () => { this.conn.leave(); });
    // Pré-provisionne un guest token en background dès le boot : le claim
    // au sign-in et le credit à la fin d'une partie en mode invité ont
    // besoin d'un token déjà valide. Fire-and-forget : si Supabase est
    // indisponible, on dégrade silencieusement.
    if (!auth.getAccessToken()) {
      void ensureGuestToken();
    }
    // Lobby music dès le boot. autoplay() peut être bloqué tant que l'user
    // n'a pas interagi : SoundManager arme un fallback pointerdown/keydown.
    void this.sound.playLobbyMusic();
    this.loop();
  }

  private async start(res: LoginResult): Promise<void> {
    this.myName = res.name;
    this.login.hide();
    this.hud.show();
    this.settings.setInGame(true);
    try { await this.sound.init(); } catch (e) { console.warn("audio init failed", e); }
    void this.sound.playBattleMusic();
    try {
      const joinOpts: { code?: string; bots?: boolean; token?: string; guestToken?: string | null } = {};
      if (res.mode === "create") {
        joinOpts.code = res.code;
        joinOpts.bots = res.bots;
      } else if (res.mode === "join") {
        joinOpts.code = res.code;
      }
      // Joueurs authentifiés → JWT passé au join, le serveur valide via
      // onAuth puis stocke userId sur le Player → score + wallet persistés.
      // Mode invité → token guest signé HMAC, le serveur credite
      // guest_wallets jusqu'au sign-in (où tout est transféré au compte).
      const token = auth.getAccessToken();
      if (token) {
        joinOpts.token = token;
      } else {
        joinOpts.guestToken = await ensureGuestToken();
      }
      this.room = await this.conn.join(res.name, joinOpts);
    } catch (e) {
      console.error("could not join", e);
      this.login.show();
      this.hud.hide();
      return;
    }
    this.myId = this.room.sessionId;
    // Si on a un code (create ou join), on met à jour l'URL pour que le lien
    // soit partageable.
    if (res.mode === "create" || res.mode === "join") {
      const u = new URL(window.location.href);
      u.searchParams.set("room", res.code!);
      window.history.replaceState({}, "", u.toString());
    } else {
      const u = new URL(window.location.href);
      if (u.searchParams.has("room")) {
        u.searchParams.delete("room");
        window.history.replaceState({}, "", u.toString());
      }
    }
    this.setupRoom();
  }

  // Atténue un son selon sa distance au joueur local : 1 si <= HEAR_NEAR,
  // 0 si >= HEAR_FAR, fade linéaire entre les deux. Si on ne connaît pas
  // encore notre position (juste avant le premier patch d'état), on retourne
  // 0 plutôt que 1 — mieux vaut un son raté qu'un brouhaha global.
  private audibleGain(x: number, y: number): number {
    const me = this.players.get(this.myId);
    if (!me) return 0;
    const dx = x - me.renderX;
    const dy = y - me.renderY;
    const d = Math.hypot(dx, dy);
    if (d <= this.HEAR_NEAR) return 1;
    if (d >= this.HEAR_FAR) return 0;
    return 1 - (d - this.HEAR_NEAR) / (this.HEAR_FAR - this.HEAR_NEAR);
  }

  private setupRoom(): void {
    const room = this.room;
    const $ = getStateCallbacks(room);
    const state = room.state;

    // Badge du code de room : affiché seulement pour les parties privées.
    const applyRoomInfo = () => {
      this.hud.setRoomCode(state.isPrivate ? (state.code ?? "") : "");
    };
    applyRoomInfo();
    $(state).listen("code", applyRoomInfo);
    $(state).listen("isPrivate", applyRoomInfo);

    const onPlayerAdd = (p: any, key: string) => {
      if (this.players.has(key)) return;
      const isLocal = key === this.myId;
      const view = new PlayerView(isLocal, this.quality);
      view.targetX = p.x; view.targetY = p.y;
      view.renderX = p.x; view.renderY = p.y;
      view.prevX = p.x; view.prevY = p.y;
      view.prevTime = performance.now();
      view.targetTime = performance.now();
      this.sceneStack.scene.add(view.root);
      this.sceneStack.scene.add(view.trail);
      this.players.set(key, view);
      if (isLocal) {
        this.predX = p.x; this.predY = p.y;
        this.predPrevX = p.x; this.predPrevY = p.y;
        this.errX = 0; this.errY = 0;
        this.simAccum = 0; this.predInit = true;
      }
      $(p).onChange(() => {
        const now = performance.now();
        view.setSnapshot(p.x, p.y, now);
        view.root.visible = p.alive;
        view.trail.visible = p.alive && isLocal;
        if (isLocal) this.reconcileLocal(p);
      });
    };
    $(state).players.onAdd(onPlayerAdd, true);

    $(state).players.onRemove((_p: any, key: string) => {
      const v = this.players.get(key);
      if (v) { v.dispose(); v.trail.parent?.remove(v.trail); }
      this.players.delete(key);
    });

    const onBladeAdd = (b: any, key: string) => {
      const now = performance.now();
      this.blades.upsert(
        key, b.rarity as BladeRarity, b.ownerId, b.ringIndex, b.slotIndex,
        b.x, b.y, now, !!b.isProjectile, b.vx ?? 0, b.vy ?? 0,
      );
      $(b).onChange(() => {
        const t = performance.now();
        this.blades.upsert(
          key, b.rarity as BladeRarity, b.ownerId, b.ringIndex, b.slotIndex,
          b.x, b.y, t, !!b.isProjectile, b.vx ?? 0, b.vy ?? 0,
        );
      });
    };
    $(state).blades.onAdd(onBladeAdd, true);
    $(state).blades.onRemove((_b: any, key: string) => { this.blades.remove(key); });

    $(state).crates.onAdd((c: any, key: string) => {
      this.crates.add(key, c.x, c.y, c.hp, c.maxHp);
    }, true);
    $(state).crates.onRemove((_c: any, key: string) => {
      this.crates.remove(key);
    });

    $(state).powerups.onAdd((pu: any, key: string) => {
      this.powerups.add(key, pu.type as PowerUpType, pu.rarity as BladeRarity, pu.x, pu.y);
    }, true);
    $(state).powerups.onRemove((_pu: any, key: string) => {
      this.powerups.remove(key);
    });

    room.onMessage("bladeDestroyed", (msg: BladeDestroyedEvent) => {
      this.particles.spawnSparks(msg.x, 0.9, msg.y, RARITY_COLOR[msg.rarity], 24, 7.5);
      if (msg.ownerId === this.myId) this.camera.shake.add(0.18);
      this.sound.hit(msg.rarity, this.audibleGain(msg.x, msg.y));
    });
    room.onMessage("pickup", (msg: PickupEvent) => {
      if (msg.playerId === this.myId) {
        this.sound.pickup(msg.rarity);
        const view = this.players.get(msg.playerId);
        if (view) this.particles.spawnSparks(view.renderX, 1.2, view.renderY, RARITY_COLOR[msg.rarity], 6, 2);
      }
    });
    room.onMessage("crateHit", (msg: CrateHitEvent) => {
      this.crates.hit(msg.crateId, msg.hp);
      this.particles.spawnSparks(msg.x, 1.0, msg.y, 0x00e5ff, 8, 4);
    });
    room.onMessage("crateDestroyed", (msg: CrateDestroyedEvent) => {
      this.particles.spawnExplosion(msg.x, 1.0, msg.y, 0xff2ea8, 28);
      this.sound.kill(this.audibleGain(msg.x, msg.y));
    });
    room.onMessage("powerupPickup", (msg: PowerUpPickupEvent) => {
      // Effet visuel coloré selon le type + son de pickup satisfaisant.
      const color = POWERUP_COLOR[msg.type as PowerUpType] ?? 0xffffff;
      this.particles.spawnExplosion(msg.x, 1.0, msg.y, color, 22);
      // Le son est plein volume si c'est moi qui ramasse, atténué sinon.
      const g = msg.playerId === this.myId ? 1 : this.audibleGain(msg.x, msg.y);
      this.sound.pickup(msg.rarity as BladeRarity, g);
      // Pour le joueur local, on retient la durée pour afficher la barre.
      if (msg.playerId === this.myId) {
        const durMs = POWERUP_DURATION[msg.rarity as BladeRarity] * 1000;
        const label = powerUpTypeLabel(msg.type as PowerUpType);
        this.effectDurations.set(label, Math.max(durMs, this.effectDurations.get(label) ?? 0));
        this.camera.shake.add(0.08);
      }
    });
    room.onMessage("playerKilled", (msg: PlayerKilledEvent) => {
      const victim = this.players.get(msg.victimId);
      if (victim) this.particles.spawnExplosion(victim.renderX, 1, victim.renderY, 0xff2ea8, 40);
      if (msg.killerId === this.myId) { this.camera.shake.add(0.5); this.sound.kill(); }
      if (msg.victimId === this.myId) this.handleLocalDeath(msg.killerName ?? null);
    });
    room.onMessage("clash", (msg: ClashEvent) => {
      // Sparks au point d'impact, tier-scaled. Couleur cyan/violet pour ne
      // pas confondre avec les drops (sparks couleur rareté).
      const count = 6 + msg.tier * 6;
      const speed = 4 + msg.tier * 2.5;
      this.particles.spawnSparks(msg.x, 0.95, msg.y, 0xb14bff, count, speed);
      const r: BladeRarity = msg.tier === 0 ? BladeRarity.Common
        : msg.tier === 1 ? BladeRarity.Rare
        : BladeRarity.Epic;
      // Screen shake : intensité tier-aware, mais SEULEMENT si le joueur
      // local est l'un des deux protagonistes (sinon l'écran tremble pour
      // chaque clash sur la map = nausée garantie).
      if (msg.aId === this.myId || msg.bId === this.myId) {
        this.camera.shake.add(tierClashShake(msg.tier));
        this.sound.hit(r);
      } else {
        // Clash distant : son atténué selon distance, et petit shake si
        // une lame a été cassée tout près de nous.
        const gain = this.audibleGain(msg.x, msg.y);
        if (msg.destroyed > 0 && gain > 0.6) {
          this.camera.shake.add(tierClashShake(msg.tier) * 0.25);
        }
        this.sound.hit(r, gain);
      }
    });
    room.onMessage("bladeThrown", (msg: BladeThrownEvent) => {
      // VFX au moment du lancer : burst de sparks à la rareté de la lame +
      // son court (basé sur le synth pickup pour rester satisfaisant).
      const color = RARITY_COLOR[msg.rarity];
      this.particles.spawnSparks(msg.x, 1.0, msg.y, color, 14, 6);
      // Plein volume pour mon propre lancer, atténué sinon.
      const gain = msg.thrownBy === this.myId ? 1 : this.audibleGain(msg.x, msg.y);
      this.sound.throwBlade(msg.rarity, gain);
      // Si c'est moi qui lance, petit shake et confirme audio.
      if (msg.thrownBy === this.myId) {
        this.camera.shake.add(0.12);
      }
    });
    room.onMessage("projectileImpact", (msg: ProjectileImpactEvent) => {
      // Impact : sparks+son. Si c'est la dernière vie de la lame
      // (destroyed=true), explosion plus dense pour signifier la fin.
      const color = RARITY_COLOR[msg.rarity];
      const count = msg.destroyed ? 22 : 10;
      const speed = msg.destroyed ? 7 : 4;
      this.particles.spawnSparks(msg.x, 0.95, msg.y, color, count, speed);
      this.sound.hit(msg.rarity, this.audibleGain(msg.x, msg.y));
    });
    room.onMessage("tierUp", (msg: TierUpEvent) => {
      // Tier-up VFX : ring d'étincelles autour du joueur + shake si local.
      // On utilise une explosion bien dense pour signaler le palier passé.
      const color = msg.tier >= 2 ? 0xff2ea8 : 0x00e5ff;
      this.particles.spawnExplosion(msg.x, 1.0, msg.y, color, 32 + msg.tier * 12);
      if (msg.playerId === this.myId) {
        const intensity = TIER_UP_SHAKE[Math.min(msg.tier, TIER_UP_SHAKE.length - 1)] ?? 0.3;
        this.camera.shake.add(intensity);
        this.sound.pickup(msg.tier >= 2 ? BladeRarity.Legendary : BladeRarity.Epic);
      }
    });
    room.onLeave((code: number) => {
      // Ignorer cet événement s'il provient d'une ancienne room (ex: on a 
      // cliqué sur "Back to menu" puis "Enter" très vite, et le onLeave de
      // l'ancienne arrive après qu'on ait rejoint la nouvelle).
      if (this.room !== room) return;

      // Code 1000 = leave volontaire (bouton menu, beforeunload). Tout
      // autre code = disconnect involontaire : on tente une reconnexion
      // discrète pendant la fenêtre allowReconnection du serveur (20 s)
      // avant de lâcher prise.
      // Race condition prod : si l'utilisateur a déjà quitté (returnToMenu
      // → this.room = null) ou rejoint une AUTRE room (start → this.room =
      // nouvelle), l'onLeave de cette room obsolète n'a plus aucune
      // pertinence. Sans ce garde-fou, attemptReconnect() s'exécute sur la
      // mauvaise room et le bouton "Enter the grid" après "Back to menu"
      // ne spawn pas (sticky session zombie).
      if (this.room !== room) return;
      if (code === 1000) { this.returnToMenu(); return; }
      this.attemptReconnect(room);
    });
  }

  private async attemptReconnect(staleRoom: any): Promise<void> {
    // Si this.room a changé entre l'appel asynchrone d'onLeave et maintenant,
    // c'est qu'un nouveau cycle de jeu a déjà démarré → on n'interfère pas.
    if (this.room !== staleRoom) return;
    const token = (staleRoom as any).reconnectionToken;
    if (!token) { this.returnToMenu(); return; }
    // On VIDE les renderers (clear) au lieu d'en créer des neufs : sans ça
    // les anciennes lames restent dans la scène (les InstancedMesh ne sont
    // jamais retirés), et le joueur voit des lames au sol qui n'existent
    // plus côté serveur, donc impossibles à ramasser.
    for (const v of this.players.values()) {
      v.dispose();
      v.trail.parent?.remove(v.trail);
    }
    this.players.clear();
    this.blades.clear();
    this.crates.clear();
    this.powerups.clear();
    this.predInit = false;
    try {
      const next = await this.conn.reconnect(token);
      // Re-vérifie après l'await : pendant la reconnexion l'utilisateur a
      // pu cliquer Back to menu (this.room = null) ou Enter (nouvelle room).
      // On ne réinstalle next QUE si on est encore "dans le contexte" de
      // staleRoom — sinon on disrupt un état utilisateur intentionnel.
      if (this.room !== staleRoom) {
        try { next.leave(); } catch { /* noop */ }
        return;
      }
      this.room = next;
      this.myId = next.sessionId;
      this.setupRoom();
    } catch {
      // Reconnect raté : retour menu uniquement si on est encore dans le
      // contexte staleRoom (sinon un nouveau cycle a démarré et est OK).
      if (this.room === staleRoom) this.returnToMenu();
    }
  }

  // Émet en continu une traînée néon derrière chaque projectile actif. Réuse
  // la pool de particules existante avec une vitesse nulle (gravité gérée
  // par particles.update) — ça suffit à donner un effet de comète clairement
  // lisible sans introduire un sous-système dédié. La couleur suit la
  // rareté de la lame.
  private trailEmitAccum = 0;
  private emitProjectileTrails(dt: number): void {
    if (!this.room?.state?.blades) return;
    // Émet 2 sparks tous les ~25 ms en moyenne. Suffisant pour une traînée
    // continue sans saturer la pool (max 800 particules).
    this.trailEmitAccum += dt;
    const interval = 0.025;
    if (this.trailEmitAccum < interval) return;
    const ticks = Math.floor(this.trailEmitAccum / interval);
    this.trailEmitAccum -= ticks * interval;
    this.room.state.blades.forEach((b: any) => {
      if (!b.isProjectile) return;
      const color = RARITY_COLOR[b.rarity as BladeRarity] ?? 0xffffff;
      this.particles.spawnSparks(b.x, 0.95, b.y, color, 2, 0.8);
    });
  }

  private playerPositions: PlayerPositionProvider = {
    getRenderPosition: (id: string) => {
      const v = this.players.get(id);
      if (!v) return undefined;
      const p = this.room?.state?.players?.get(id);
      const spinPhase = p?.spinPhase ?? 0;
      const spinScale = p?.spinScale ?? 1;
      const tier = p?.tier ?? 0;
      // orbitTimeOffset est exprimé en secondes côté serveur. Le client
      // utilise le même unit (elapsedSec) donc la soustraction directe
      // figera proprement la rotation pendant un hitlag.
      const orbitTimeOffset = p?.orbitTimeOffset ?? 0;
      // Joueur dans un buisson ET pas moi → invisible pour mon client.
      // Le local player se voit toujours (sinon impossible à jouer).
      const hidden = id !== this.myId && isInBush(v.renderX, v.renderY);
      const bladeCount = p?.bladeCount ?? 0;
      return { x: v.renderX, y: v.renderY, spinPhase, spinScale, tier, orbitTimeOffset, hidden, bladeCount };
    },
  };

  private handleLocalDeath(killerName: string | null): void {
    if (this.dead) return;
    this.dead = true;
    const me = this.room?.state?.players?.get(this.myId);
    if (!me) return;
    const lifeMs = Date.now() - me.spawnedAt;
    const rank = this.computeMyRank();
    this.sound.death();
    this.camera.shake.add(0.8);
    const earned = me.score;
    const isAuthed = auth.getAccessToken() !== null;
    // Solde local connu à l'instant de la mort, +ce qu'on vient de gagner.
    // Le vrai total côté serveur peut différer si plusieurs onglets
    // jouent en parallèle ; on rafraîchit en background pour reconverger.
    const cached = wallet.get();
    const optimisticTotal = isAuthed && cached ? cached.balance + earned : null;
    this.death.show({
      lifeSeconds: Math.max(0, lifeMs / 1000),
      maxBlades: me.maxBladeCount,
      kills: me.kills,
      rank,
      score: earned,
      cratesDestroyed: me.cratesDestroyed ?? 0,
      powerupsCollected: me.powerupsCollected ?? 0,
      killerName,
      // Le serveur persiste seulement si le joueur a fourni un token au
      // join. Côté client, le state d'auth au moment de la mort est la
      // meilleure approximation.
      scorePersisted: isAuthed,
      walletTotal: optimisticTotal,
    });
    // Refresh asynchrone du solde authoritative pour le prochain affichage
    // (login screen au retour menu, prochaine mort).
    if (isAuthed) void wallet.refresh();
  }

  private computeMyRank(): number {
    if (!this.room?.state?.players) return 0;
    const entries: Array<{ id: string; score: number }> = [];
    this.room.state.players.forEach((p: any, id: string) => {
      entries.push({ id, score: p.score });
    });
    entries.sort((a, b) => b.score - a.score);
    const idx = entries.findIndex((e) => e.id === this.myId);
    return idx >= 0 ? idx + 1 : entries.length;
  }

  private respawn(): void {
    this.death.hide();
    this.dead = false;
    this.predInit = false;
    this.room?.send("respawn", { name: this.myName });
  }

  private async returnToMenu(): Promise<void> {
    this.death.hide();
    this.hud.hide();
    this.hud.setRoomCode("");
    this.hud.clearEffects();
    this.effectDurations.clear();
    this.settings.setInGame(false);
    // Détache d'abord les listeners (élimine les callbacks fantômes), puis
    // AWAIT la fermeture effective de la WS. Sans l'await, en prod (proxy
    // Caddy) le close prend quelques 100ms et son callback fire après le
    // clic Enter suivant → race condition qui empêche le spawn.
    if (this.room) {
      try { (this.room as any).removeAllListeners?.(); } catch { /* noop */ }
    }
    this.room = null;
    this.myId = "";
    this.predInit = false;
    for (const v of this.players.values()) { v.dispose(); v.trail.parent?.remove(v.trail); }
    this.players.clear();
    // clear() au lieu de recréer : voir attemptReconnect pour le pourquoi
    // (sans ça, lames fantômes héritées de la session précédente).
    this.blades.clear();
    this.crates.clear();
    this.powerups.clear();
    this.dead = false;
    // Bloque ici jusqu'à confirmation de fermeture (timeout 1.5s pour ne
    // pas geler indéfiniment si la connexion est cassée). Le login n'est
    // affiché qu'APRÈS, garantissant que tout clic suivant sur Enter
    // démarre sur une ardoise propre.
    await this.conn.leave();
    this.login.show();
    void this.sound.playLobbyMusic();
  }

  private sendInput(): void {
    if (!this.room) return;
    const { dx, dy, boost, throwPressed } = this.input.getInput();
    if (throwPressed) this.throwLatched = true;
    this.inputSeq = (this.inputSeq + 1) >>> 0;
    const payload: { dx: number; dy: number; boost: boolean; seq: number; throw?: boolean } = {
      dx, dy, boost, seq: this.inputSeq,
    };
    if (this.throwLatched) {
      payload.throw = true;
      this.throwLatched = false;
    }
    this.room.send("input", payload);
    this.sound.setBoost(!!boost && (dx !== 0 || dy !== 0));
  }

  private simulateStep(
    x: number, y: number, dx: number, dy: number, boost: boolean, dt: number, bladeCount: number,
  ): { x: number; y: number } {
    let ndx = dx; let ndy = dy;
    const mag = Math.hypot(ndx, ndy);
    if (mag > 1) { ndx /= mag; ndy /= mag; }
    const moving = mag > 0.05;
    let speed = PLAYER_SPEED;
    if (boost && bladeCount > 0 && moving) speed *= PLAYER_BOOST_MULT;
    if (moving) { x += ndx * speed * dt; y += ndy * speed * dt; }
    const pushed = resolveDecorCollision(x, y, PLAYER_BODY_RADIUS);
    x = pushed.x; y = pushed.y;
    const r = Math.hypot(x, y);
    const maxR = MAP_RADIUS - WALL_KILL_THICKNESS;
    if (r > maxR) { x = (x / r) * maxR; y = (y / r) * maxR; }
    return { x, y };
  }

  private updateLocalPrediction(dt: number, view: PlayerView): void {
    if (!this.room || !this.predInit) { view.setLocalRender(view.targetX, view.targetY); return; }
    const me = this.room.state?.players?.get(this.myId);
    if (!me || !me.alive) { view.setLocalRender(view.targetX, view.targetY); return; }
    this.simAccum = Math.min(this.simAccum + dt, 0.2);
    while (this.simAccum >= this.SIM_DT) {
      this.simAccum -= this.SIM_DT;
      this.predPrevX = this.predX; this.predPrevY = this.predY;
      const { dx, dy, boost } = this.input.peekDirBoost();
      const next = this.simulateStep(this.predX, this.predY, dx, dy, boost, this.SIM_DT, me.bladeCount);
      this.predX = next.x; this.predY = next.y;
    }
    const alpha = Math.max(0, Math.min(1, this.simAccum / this.SIM_DT));
    const rx = this.predPrevX + (this.predX - this.predPrevX) * alpha;
    const ry = this.predPrevY + (this.predY - this.predPrevY) * alpha;
    const decay = Math.exp(-dt / this.ERR_DECAY_TAU);
    this.errX *= decay; this.errY *= decay;
    if (Math.abs(this.errX) < 0.001) this.errX = 0;
    if (Math.abs(this.errY) < 0.001) this.errY = 0;
    view.setLocalRender(rx - this.errX, ry - this.errY);
  }

  private reconcileLocal(me: any): void {
    if (!this.predInit || !me.alive) {
      this.predX = me.x; this.predY = me.y;
      this.predPrevX = me.x; this.predPrevY = me.y;
      this.errX = 0; this.errY = 0;
      this.simAccum = 0; this.predInit = true;
      return;
    }
    const dxErr = this.predX - me.x;
    const dyErr = this.predY - me.y;
    const d2 = dxErr * dxErr + dyErr * dyErr;
    if (d2 > 15 * 15) {
      this.predX = me.x; this.predY = me.y;
      this.predPrevX = me.x; this.predPrevY = me.y;
      this.errX = 0; this.errY = 0; this.simAccum = 0;
      return;
    }
    this.errX -= dxErr; this.errY -= dyErr;
    this.predX = me.x; this.predY = me.y;
    this.predPrevX = me.x; this.predPrevY = me.y;
    const maxErr = 5;
    const em2 = this.errX * this.errX + this.errY * this.errY;
    if (em2 > maxErr * maxErr) {
      const s = maxErr / Math.sqrt(em2);
      this.errX *= s; this.errY *= s;
    }
  }

  private updateHud(): void {
    if (!this.room || !this.room.state?.players) return;
    const me = this.room.state.players.get(this.myId);
    if (!me) return;
    if (me.bladeCount <= LOW_BLADE_WARNING && me.bladeCount > 0 && this.lastBladeCountShown > me.bladeCount) {
      this.sound.lowBlades();
    }
    this.lastBladeCountShown = me.bladeCount;
    this.hud.setBladeCount(me.bladeCount);
    this.hud.setBoost(me.bladeCount / MAX_BLADES_PER_PLAYER);
    // Effets actifs : on relit les *Until du joueur local et on met à jour
    // les badges HUD avec leur temps restant. Durée base conservée dans
    // effectDurations pour normaliser la barre.
    const dnow = Date.now();
    const updateFx = (label: string, color: number, until: number) => {
      if (until <= dnow) {
        this.hud.updateEffect(label, label, "#" + color.toString(16).padStart(6, "0"), 0, 1);
        this.effectDurations.delete(label);
      } else {
        let dur = this.effectDurations.get(label);
        if (dur === undefined) {
          dur = until - dnow;
          this.effectDurations.set(label, dur);
        }
        this.hud.updateEffect(
          label,
          label,
          "#" + color.toString(16).padStart(6, "0"),
          until,
          dur,
        );
      }
    };
    updateFx("SPEED", POWERUP_COLOR[PowerUpType.Speed], me.speedUntil ?? 0);
    updateFx("SPIN", POWERUP_COLOR[PowerUpType.Spin], me.spinUntil ?? 0);
    updateFx("MAGNET", POWERUP_COLOR[PowerUpType.Magnet], me.magnetUntil ?? 0);
    updateFx("SHIELD", POWERUP_COLOR[PowerUpType.Shield], me.shieldUntil ?? 0);

    const now = performance.now();
    if (now - this.lastHudUpdate < 100) return;
    this.lastHudUpdate = now;
    const others: Array<{ id: string; x: number; y: number; isMe: boolean }> = [];
    const entries: Array<{ id: string; name: string; score: number; kills: number; bladeCount: number }> = [];
    this.room.state.players.forEach((p: any, id: string) => {
      entries.push({ id, name: p.name, score: p.score, kills: p.kills, bladeCount: p.bladeCount });
      // Joueurs dans un buisson : pas affichés sur la minimap pour les autres.
      // (Le buisson cache aussi sur la carte, comme demandé.)
      if (id !== this.myId && p.alive && !isInBush(p.x, p.y)) {
        others.push({ id, x: p.x, y: p.y, isMe: false });
      }
    });
    this.leaderboard.update(entries, this.myId, now);
    // Rank badge live
    const sorted = [...entries].sort((a, b) => b.score - a.score);
    this.topPlayerId = sorted.length > 0 ? sorted[0].id : null;
    const myRankIdx = sorted.findIndex((e) => e.id === this.myId);
    this.hud.setRank(myRankIdx >= 0 ? myRankIdx + 1 : entries.length);
    const legendaries: Array<{ x: number; y: number; legendary: boolean }> = [];
    this.room.state.blades.forEach((b: any) => {
      if (!b.ownerId && b.rarity === BladeRarity.Legendary) {
        legendaries.push({ x: b.x, y: b.y, legendary: true });
      }
    });
    others.sort((a, b) => {
      const da = (a.x - me.x) ** 2 + (a.y - me.y) ** 2;
      const db = (b.x - me.x) ** 2 + (b.y - me.y) ** 2;
      return da - db;
    });
    this.minimap.draw({ id: this.myId, x: me.x, y: me.y, isMe: true }, others.slice(0, 10), legendaries);
  }

  // Pilote la résolution dynamique et le downgrade auto de preset.
  //
  // Logique :
  //  - Si fps < 50 pendant 2 s, on baisse le resScale de 0.1 (jusqu'au
  //    minimum du preset).
  //  - Si fps > 58 ET resScale < 1.0 pendant 5 s, on remonte de 0.05.
  //  - Si fps < 35 pendant 4 s ET resScale est déjà au minimum ET
  //    autoDowngrade est activé, on bascule au preset inférieur (recharge
  //    le jeu pour réinitialiser proprement les materials/shaders).
  //
  // Appelé une fois par fenêtre de mesure FPS (~0.5 s).
  private adaptiveQuality(_dt: number): void {
    if (!this.quality.dynamicResolution) return;
    const fps = this.fps;
    // Fenêtre = pas du moniteur (~0.5 s entre 2 appels).
    const tick = 0.5;
    // Hystérésis : on accumule du "bas" / "haut" pour décider, pour ne pas
    // osciller à chaque pic.
    if (fps < 50) {
      this.lowFpsAccum += tick;
      this.highFpsAccum = 0;
    } else if (fps > 58) {
      this.highFpsAccum += tick;
      this.lowFpsAccum = 0;
    } else {
      // Zone neutre : décay pour stabiliser.
      this.lowFpsAccum = Math.max(0, this.lowFpsAccum - tick * 0.5);
      this.highFpsAccum = Math.max(0, this.highFpsAccum - tick * 0.5);
    }

    const cur = this.sceneStack.getResScale();
    const minScale = this.quality.dynResMin;
    if (this.lowFpsAccum >= 2.0) {
      const next = Math.max(minScale, cur - 0.1);
      if (next < cur) {
        this.sceneStack.setResScale(next);
        this.lowFpsAccum = 0;
        console.log(`[blade.io] dynRes: ${cur.toFixed(2)} → ${next.toFixed(2)} (fps=${fps.toFixed(0)})`);
      } else if (
        this.quality.autoDowngrade &&
        fps < 35 &&
        Date.now() - this.lastDowngradeAt > 30000
      ) {
        // Resolution déjà au minimum mais ça rame encore : downgrade preset.
        const lower = nextLowerPreset(this.quality.preset);
        if (lower) {
          console.log(`[blade.io] auto-downgrade preset: ${this.quality.preset} → ${lower} (fps=${fps.toFixed(0)})`);
          savePresetChoice(lower);
          this.lastDowngradeAt = Date.now();
          // Reload : les matériaux/shaders sont construits au boot selon le
          // preset, on ne peut pas les muter à chaud.
          window.location.reload();
        }
      }
    } else if (this.highFpsAccum >= 5.0 && cur < 1.0) {
      const next = Math.min(1.0, cur + 0.05);
      if (next > cur) {
        this.sceneStack.setResScale(next);
        this.highFpsAccum = 0;
        console.log(`[blade.io] dynRes: ${cur.toFixed(2)} → ${next.toFixed(2)} (fps=${fps.toFixed(0)})`);
      }
    }
  }

  private loop(): void {
    let last = performance.now();
    const tick = () => {
      if (!this.running) return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.elapsed += dt * 1000;
      this.fpsAccum += dt;
      this.fpsFrames++;
      if (this.fpsAccum >= 0.5) {
        this.fps = this.fpsFrames / this.fpsAccum;
        this.fpsAccum = 0; this.fpsFrames = 0;
        this.hud.setFps(this.fps);
        this.adaptiveQuality(dt);
      }
      if (this.room && now - this.lastInputSent > 1000 / CLIENT_INPUT_RATE) {
        this.lastInputSent = now;
        this.sendInput();
      }
      const localView = this.players.get(this.myId);
      const nowMs = Date.now();
      for (const [id, v] of this.players) {
        if (id === this.myId) this.updateLocalPrediction(dt, v);
        else v.interpolate(now, RENDER_DELAY);
        // Spawn protection visuel : halo cyan pulsé tant que
        // spawnProtectionUntil est dans le futur. Lu directement du state
        // serveur ; la dérive d'horloge sur ~2.5s reste imperceptible.
        const ps = this.room?.state?.players?.get(id);
        v.setProtected(!!ps && ps.spawnProtectionUntil > nowMs);
        v.animate(dt);
        v.updateTrail(dt);
        // Hide remote players inside bushes. Le local player reste toujours
        // visible — sinon il ne peut plus se piloter.
        const isLocal = id === this.myId;
        const inBush = !isLocal && isInBush(v.renderX, v.renderY);
        // Le joueur local est toujours visible à moins d'être mort.
        // Les autres sont cachés s'ils sont dans un buisson ou morts.
        const p = this.room?.state?.players?.get(id);
        const shouldBeVisible = p?.alive ? !inBush : false;
        
        if (v.root.visible !== shouldBeVisible) v.root.visible = shouldBeVisible;
        if (v.trail.visible !== (shouldBeVisible && isLocal)) v.trail.visible = shouldBeVisible && isLocal;
      }
      this.blades.update(now, RENDER_DELAY, this.elapsed * 0.001, this.playerPositions);
      this.crates.update(dt, this.elapsed * 0.001);
      this.powerups.update(dt, this.elapsed * 0.001);
      this.emitProjectileTrails(dt);
      this.particles.update(dt);
      if (localView) this.camera.setTarget(localView.renderX, localView.renderY);
      this.camera.update(dt);
      this.ground.update(this.elapsed * 0.001);
      this.decor.update(this.elapsed * 0.001);
      this.updateHud();
      this.postFx.render(this.sceneStack.scene, this.sceneStack.camera);

      // Crown UI rendering
      const crownEl = document.getElementById("king-crown")!;
      let showCrown = false;
      // this.room.state.players peut être undefined dans la fenêtre courte
      // entre conn.join() résolu et la première sync de patches (plus visible
      // en prod à cause de la latence Caddy). Sans optional chaining, ça
      // throw au tick → freeze du render loop → "ça spawn pas".
      if (this.topPlayerId && this.room?.state?.players) {
        const topView = this.players.get(this.topPlayerId);
        const topState = this.room.state.players.get(this.topPlayerId);
        if (topView && topState && topState.alive) {
          const isMe = this.topPlayerId === this.myId;
          const inBush = !isMe && isInBush(topView.renderX, topView.renderY);
          if (!inBush) {
            const vec = new THREE.Vector3(topView.renderX, 3.5, topView.renderY);
            vec.project(this.sceneStack.camera);
            if (vec.z < 1) { // devant la caméra
              const x = (vec.x * 0.5 + 0.5) * window.innerWidth;
              const y = (-(vec.y * 0.5) + 0.5) * window.innerHeight;
              crownEl.style.left = `${x}px`;
              crownEl.style.top = `${y}px`;
              showCrown = true;
            }
          }
        }
      }
      if (showCrown) crownEl.classList.remove("hidden");
      else crownEl.classList.add("hidden");

      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

new Game();

function powerUpTypeLabel(t: PowerUpType): string {
  switch (t) {
    case PowerUpType.Speed: return "SPEED";
    case PowerUpType.Spin: return "SPIN";
    case PowerUpType.Magnet: return "MAGNET";
    case PowerUpType.Shield: return "SHIELD";
    case PowerUpType.Blades: return "BLADES";
  }
}
