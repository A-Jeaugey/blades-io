import * as THREE from "three";
import {
  BladeRarity,
  AckState,
  InputPredictor,
  CLOSE_CODE_INPUT_FLOOD,
  ClashEvent,
  MAP_RADIUS,
  LOW_BLADE_WARNING,
  SERVER_DT,
  THROW_COOLDOWN_MS,
  SCORE_CRATE,
  SCORE_KILL,
  SCORE_UNDERDOG,
  SCORE_POWERUP,
  THROW_PROJECTILE_MAX_RANGE,
  TIER_UP_SHAKE,
  ChallengeDoneEvent,
  MatchEndEvent,
  MatchPhase,
  ChatEvent,
  ChatMutedEvent,
  CheatMessage,
  CheatResult,
  ReportAck,
  InputMessage,
  TierUpEvent,
  WALL_KILL_THICKNESS,
  orbitSlotAngle,
  orbitThetaAt,
  outerOrbitRadius,
  ringRadius,
  BladeDestroyedEvent,
  BladeThrownEvent,
  CrateDestroyedEvent,
  CrateHitEvent,
  PickupEvent,
  PlayerKilledEvent,
  RoomSummary,
  viewRadiusLimit,
  ProjectileImpactEvent,
  POWERUP_DURATION,
  PowerUpPickupEvent,
  PowerUpType,
  CTF_BASE_RADIUS,
  FlagEvent,
  MapEventKind,
  TEAM_NONE,
  bushAt,
  isInBush,
  isTeamMode,
  modeRespawns,
  modeShrinks,
  ROUND_SHRINK_MS,
  sameTeam,
  teamBase,
  tierClashShake,
} from "@bladeio/shared";
import { Callbacks } from "@colyseus/sdk";
import { Connection, JoinOptions, resolveServerEndpoint, RoomNotFoundError } from "./net/Connection";
import { ServerClock } from "./net/ServerClock";
import { DebugHitboxes, DebugOrbitFrame } from "./scene/DebugHitboxes";
import { SceneStack } from "./scene/Scene";
import { BoundaryWall, GroundSurface, createGround, createBoundaryWall } from "./scene/Ground";
import { DecorHandle, createDecor } from "./scene/Decor";
import { PostFX } from "./scene/PostFX";
import { CameraRig } from "./scene/Camera";
import { PlayerView } from "./entities/PlayerView";
import { AimIndicator } from "./entities/AimIndicator";
import { BladeRenderer, PlayerPositionProvider } from "./entities/BladeView";
import { CrateRenderer } from "./entities/CrateView";
import { PowerUpRenderer } from "./entities/PowerUpView";
import { FlagRenderer, FlagSnapshot } from "./entities/FlagView";
import { MapEventSnapshot, MapEventView } from "./scene/MapEventView";
import { ParticlePool } from "./fx/Particles";
import { CombatFx } from "./fx/CombatFx";
import { fxIntensity } from "./fx/flash";
import { Haptics } from "./fx/Haptics";
import { AmbientWisps } from "./scene/AmbientWisps";
import { InputManager } from "./input/InputManager";
import { Hud } from "./ui/Hud";
import { LoginScreen, LoginResult } from "./ui/LoginScreen";
import { DeathScreen } from "./ui/DeathScreen";
import { Leaderboard, LeaderboardEntry } from "./ui/Leaderboard";
import { Minimap, MinimapEvent, MinimapFlag, MinimapPlayer } from "./ui/Minimap";
import { FLAG_FEED_KEYS, FlagHud, FlagStatus } from "./ui/FlagHud";
import { BORDER_WARNING_DISTANCE, BorderWarning } from "./ui/BorderWarning";
import { CombatFeedback } from "./ui/CombatFeedback";
import { KillFeed, KillFeedEntry } from "./ui/KillFeed";
import { MatchHud, MatchUi } from "./ui/MatchUi";
import { getBest, submitScore } from "./ui/personalBest";
import { recordLocalLife } from "./ui/localStats";
import { ProfilePanel } from "./ui/ProfilePanel";
import { challengeById, challengeText } from "./ui/challenges";
import { DeathStats } from "./ui/DeathScreen";
import { HintId, Onboarding } from "./ui/Onboarding";
import { SettingsPanel, shakeIntensity } from "./ui/Settings";
import { ChatPanel } from "./ui/ChatPanel";
import { NAMETAG_ANCHOR_Y, NametagOverlay } from "./scene/NametagOverlay";
import { SoundManager } from "./audio/SoundManager";
import { detectPreset, getPresetConfig, nextLowerPreset, QualityConfig, savePresetChoice } from "./quality";
import { applyThemeCss, getActiveTheme } from "./themes";
import { I18nKey, applyI18n, formatNumber, t } from "./i18n";
import { showAlert } from "./ui/Dialog";
import { RoomRef, ShareResult, inviteUrl, share } from "./ui/share";
import { BLADE_STYLES, KILL_FX_LOOKS, lookOf } from "./cosmetics/looks";
import { getLoadout } from "./cosmetics/loadout";
import { isReloadPending, reloadAtMenu } from "./ui/pendingReload";
import { Boutique, isBoutiqueOpen } from "./boutique/Boutique";
import { auth } from "./auth/supabase";
import { ensureGuestToken, fetchGuestWallet, getGuestToken } from "./auth/guestToken";
import { wallet } from "./auth/wallet";

// Buffer d'interpolation : on rend la simu serveur avec ce délai pour
// que les snapshots à interpoler soient déjà en mémoire (sinon
// extrapolation, plus jittery sur jitter réseau). 80ms = ~5 ticks à
// 60Hz, suffisant pour absorber 30-50ms de jitter normal sans bourrer
// le buffer. Avant : 150ms, sentait le lag à chaque direction change
// (le perso continue d'avancer "dans le passé" 150ms après l'input).
const RENDER_DELAY = 80;
// Au-delà de ce rayon (moins celui de l'arène du moment), une lame
// détruite l'a été par le mur (orbite qui dépasse la zone mortelle,
// projectile qui l'atteint).
const WALL_ZAP_MARGIN = WALL_KILL_THICKNESS + 0.5;
// Après la mort (tâche 3.5) : durée de la caméra sur le tueur avant la
// carte récapitulative, pause plus courte pour une mort à la bordure, et
// constante de temps du glissement de la caméra vers le tueur (s).
const KILLCAM_MS = 2500;
const WALL_DEATH_MS = 1200;
const KILLCAM_PAN_TAU = 0.25;

type OrbitInfo = { ownerId: string; ring: number; slot: number; inRing: number };
interface ClashCheck {
  x: number;
  y: number;
  a: OrbitInfo | null;
  b: OrbitInfo | null;
}

// Segment de l'horloge d'orbite d'un joueur (cf. Player.orbitPhase côté
// serveur) : θ = phase au tick donné, puis + rate par seconde de jeu.
interface OrbitSegment {
  tick: number;
  phase: number;
  rate: number;
}

// Champs de l'état reçu que suivent les rappels d'état (setupRoom). Le
// client n'a pas les classes du serveur, le SDK les reflète à la connexion :
// ce type les décrit pour les rappels, que le compilateur vérifie ainsi.
interface SyncedState {
  code: string;
  isPrivate: boolean;
  mode: string;
  phase: number;
  tick: number;
  serverTime: number;
  players: Map<string, any>;
  blades: Map<string, any>;
  crates: Map<string, any>;
  powerups: Map<string, any>;
}

// Première partie sur cet appareil : envoyé au serveur pour la télémétrie
// (tâche 4.8), qui distingue ainsi les toutes premières vies. Repli sur
// l'onboarding pour les joueurs d'avant ce drapeau ; stockage indisponible :
// compté comme déjà joué, plutôt que de gonfler les débutants.
const PLAYED_KEY = "blade.played";
function playedBefore(): boolean {
  try {
    if (localStorage.getItem(PLAYED_KEY) === "1") return true;
    const onboarding = JSON.parse(localStorage.getItem("blade.onboarding") ?? "null");
    return !!onboarding?.controls;
  } catch {
    return true;
  }
}
function markPlayed(): void {
  try {
    localStorage.setItem(PLAYED_KEY, "1");
  } catch {
    // Stockage indisponible.
  }
}

class Game {
  private canvas: HTMLCanvasElement;
  private sceneStack: SceneStack;
  private postFx: PostFX;
  private camera: CameraRig;
  private ground: GroundSurface;
  private wall: BoundaryWall;
  private decor: DecorHandle;
  // Buisson où se trouve le joueur local (-1 : aucun), tâche 4.7.
  private localBush = -1;
  private players = new Map<string, PlayerView>();
  private blades!: BladeRenderer;
  private crates!: CrateRenderer;
  private powerups!: PowerUpRenderer;
  // Capture du drapeau (tâche 7.2) : drapeaux, bases, état sous la minuterie.
  private flagsView!: FlagRenderer;
  private flagHud = new FlagHud();
  private flagStates: Array<FlagSnapshot & FlagStatus> = [];
  private flagCarrierPos = { x: 0, y: 0 };
  // « Ton drapeau doit être à ta base » : une fois par drapeau emporté.
  private needHomeShown = false;
  // Évènements de carte (tâche 4.4) : zone au sol, type annoncé en dernier.
  private mapEventView!: MapEventView;
  private mapEventSnap: MapEventSnapshot = { kind: MapEventKind.None, x: 0, y: 0, radius: 0, startsAt: 0, endsAt: 0 };
  private lastEventKind: number = MapEventKind.None;
  // Resserrement de l'arène annoncé (tâche 4.5) : échéance déjà signalée,
  // et rayon où le mur s'arrêtera, montré au sol et sur la minimap (0 :
  // aucun).
  private lastShrinkAt = 0;
  private shownArenaTarget = 0;
  // Durée max observée pour chaque effet actif local — sert à normaliser
  // la barre du badge dans le HUD (sinon on ne sait pas combien il restait
  // au départ).
  private effectDurations: Map<string, number> = new Map();
  private particles!: ParticlePool;
  // Effets de combat (tâche 4.9) : ondes de choc, éclats de lame, colonnes
  // de lumière, traînées des lames, lignes de vitesse.
  private combatFx!: CombatFx;
  // Réglage des flashs courant (teinte des corps qui se dissolvent).
  private flashK = 1;
  // Joueurs retirés de l'état dont le rendu (80 ms dans le passé) n'a pas
  // encore atteint le retrait : leur dernier état, pour les placer jusque-là.
  private departing = new Map<string, any>();
  // Corps qui finissent de se dissoudre après leur retrait (un mort n'est
  // plus envoyé aux autres clients).
  private corpses: PlayerView[] = [];
  // Joueur local qui boost, d'après le dernier input envoyé (les lignes de
  // vitesse n'attendent pas le serveur).
  private localBoosting = false;
  // Position de rendu d'un joueur (colonnes de lumière qui le suivent).
  private tmpAt = { x: 0, z: 0 };
  private renderPosOf = (id: string): { x: number; z: number } | undefined => {
    const v = this.players.get(id);
    if (!v) return undefined;
    this.tmpAt.x = v.renderX;
    this.tmpAt.z = v.renderY;
    return this.tmpAt;
  };
  private wisps!: AmbientWisps;
  // Moniteur FPS adaptatif : si fps reste sous le seuil pendant une fenêtre,
  // on baisse la résolution dynamiquement (resScale) ; si ça ne suffit pas,
  // on downgrade le preset (low → ultra). Si le fps remonte durablement, on
  // remonte le resScale.
  private dynResMonitorAccum = 0;
  private lowFpsAccum = 0;
  private highFpsAccum = 0;
  private lastDowngradeAt = 0;
  // Baisse de preset décidée pendant une partie : appliquée (reload) au
  // prochain retour au menu, jamais en plein match.
  private input: InputManager;
  private hud: Hud;
  private login: LoginScreen;
  private death: DeathScreen;
  private leaderboard: Leaderboard;
  private minimap: Minimap;
  private borderWarning: BorderWarning;
  private nextBorderBeepAt = 0;
  private tmpNdcA = new THREE.Vector3();
  private tmpNdcB = new THREE.Vector3();
  // Tick serveur estimé et tick de rendu de la frame : les joueurs distants
  // sont affichés RENDER_DELAY dans le passé, leurs lames au même instant.
  private serverClock = new ServerClock();
  private renderTick = 0;
  // Derniers segments d'horloge d'orbite reçus par joueur : le tick de
  // rendu est 80 ms dans le passé, un nouveau segment a pu commencer depuis.
  private orbitSegments = new Map<string, OrbitSegment[]>();
  private debugHitboxes: DebugHitboxes | null = null;
  // Ligne de temps du rendu : ce qui est reçu ~80 ms avant que le rendu
  // n'atteigne son tick (évènements de combat, changements des lames en
  // orbite, morts) y attend ce tick. Joué tout de suite, l'étincelle d'un
  // clash apparaissait avant le contact et la lame cassée disparaissait
  // avant d'atteindre l'impact.
  private timeline: Array<{ tick: number; seq: number; run: () => void; fx: boolean }> = [];
  private timelineSeq = 0;
  private timelineSorted = true;
  // Tick du dernier patch reçu : estampille des changements d'état.
  private lastPatchTick = 0;
  // Lames avec un changement en attente : les suivants attendent aussi,
  // pour rester dans l'ordre (orbite → lancer, sol → orbite…).
  private pendingBlades = new Map<string, number>();
  // « Vivant » tel qu'affiché : un kill ne fait disparaître la victime
  // qu'au tick du kill sur la ligne de temps.
  private renderAlive = new Map<string, boolean>();
  // Mode debug : clashes joués cette frame (et, pour comparaison, reçus
  // cette frame), mesurés une fois les joueurs placés. La place des lames
  // est relevée au moment du clash : une lame cassée disparaît au même tick.
  private clashChecks: ClashCheck[] = [];
  private clashChecksImmediate: ClashCheck[] = [];
  private settings: SettingsPanel;
  private profile!: ProfilePanel;
  // Bandeaux d'information en jeu, l'un après l'autre : défis réussis
  // (tâche 5.3), arène d'un ami indisponible (5.5).
  private toasts: string[] = [];
  private toastUntil = 0;
  private chat!: ChatPanel;
  private nametags = new NametagOverlay();
  private sound = new SoundManager();
  private conn: Connection;
  // Thème actif — résolu une fois à l'init (le système ne supporte pas le
  // hot-swap, l'utilisateur reload pour changer de thème depuis le lobby).
  private readonly theme = getActiveTheme();
  private myId = "";
  private myName = "";
  private room: any = null;
  private running = true;
  private elapsed = 0;
  private fps = 60;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private lastBladeCountShown = 0;
  private dead = false;
  private lastHudUpdate = 0;
  private quality: QualityConfig;
  // Prédiction du joueur local avec rejeu des inputs non acquittés (tâche
  // 1.2), même pas de mouvement que le serveur.
  private predictor = new InputPredictor();
  // Horloge d'inputs : temps réel accumulé depuis le dernier input envoyé
  // (ms). Un input par SERVER_DT, comme le serveur applique un pas par input.
  private inputAccumMs = 0;
  // Patch reçu pour le joueur local : réconciliation à la frame suivante,
  // une fois tout le patch appliqué (serverTime compris).
  private needReconcile = false;
  // Correction absorbée en douceur par le rendu (u), et corrections
  // mesurées (mode debug).
  private errX = 0;
  private errY = 0;
  private readonly ERR_DECAY_TAU = 0.1;
  private corrections: number[] = [];
  private inputSeq = 0;
  private topPlayerId: string | null = null;
  // Prime sur le leader, affichée sur sa couronne (tâche 4.2).
  private leaderBounty = 0;
  private shownBounty = -1;
  private crownVec = new THREE.Vector3();
  // Edge-trigger throw : on stocke un appui détecté entre deux sendInput()
  // (un par SERVER_DT, pas forcément chaque frame). Sans ça, un appui dans
  // la frame de gap entre deux sends se perd.
  private throwLatched = false;
  private aimIndicator = new AimIndicator();
  private combatFeedback = new CombatFeedback();
  private killFeed = new KillFeed();
  // Partie à fin (manches, tâche 7.1) : minuterie et podium.
  private match = new MatchUi(() => void this.returnToMenu());
  // Spectateur (dernière équipe en vie, tâche 7.2) : éliminé ou arrivé en
  // cours de manche, on suit un coéquipier jusqu'à la manche suivante. Le
  // serveur place notre joueur hors jeu sur lui : la caméra suit notre
  // position, interpolée comme celle des autres.
  private spectating = false;
  // Aller-retour réseau mesuré par ping/pong : médiane des dernières
  // mesures (ms), null tant qu'aucune réponse n'est arrivée. La médiane
  // écarte une mesure prise pendant un chargement ou une pause du GC.
  private pingMs: number | null = null;
  private pingSamples: number[] = [];
  private pingSeq = 0;
  private pingSentAt = new Map<number, number>();
  private nextPingAt = 0;
  // Score de la vie en cours déjà versé au record personnel (évite de le
  // compter deux fois : mort puis retour au menu).
  private bestSubmitted = false;
  // Caméra sur le tueur (tâche 3.5) : après la mort, la caméra glisse vers
  // lui, puis la carte récapitulative s'affiche (cardAt) ; la caméra le
  // suit encore derrière la carte, jusqu'au respawn.
  private killCam: { killerId: string | null; x: number; y: number; cardAt: number } | null = null;
  private pendingDeath: DeathStats | null = null;
  // Solde du portefeuille invité, lu à l'entrée en jeu : total affiché à la
  // mort d'un invité.
  private guestBalance: number | null = null;
  // Résumé de la room (classement, minimap), reçu toutes les 500 ms : la
  // zone d'intérêt ne nous envoie que les joueurs proches (tâche 2.4).
  private summary: RoomSummary | null = null;
  // Redémarrage annoncé par le serveur (tâche T.3) : heure du serveur à
  // laquelle il ferme, 0 sinon.
  private restartAt = 0;
  private nextRestartBannerAt = 0;
  // Partie fermée par le redémarrage, en attente de la nouvelle version.
  private restartWaiting = false;
  // Étendue de sol visible annoncée au serveur (rayon de notre zone).
  private sentViewRadius = 0;
  private nextViewCheckAt = 0;
  private onboarding!: Onboarding;
  private haptics!: Haptics;
  // Intensité de l'alerte de bordure à la dernière frame (0..1).
  private borderIntensity = 0;
  private nextHintCheckAt = 0;
  // Dernière secousse de clash du joueur local (performance.now()).
  private lastClashShakeAt = 0;
  // Dernière direction montrée par l'indicateur : gardée pendant son fondu
  // de sortie.
  private aimDirX = 0;
  private aimDirY = 1;
  private throwBtn: HTMLElement | null = null;
  private throwBtnCooldown = false;
  // Fin du cooldown prédite au dernier lancer envoyé (heure du serveur) :
  // indicateur et bouton THROW réagissent sans attendre l'aller-retour,
  // l'échéance du serveur prend le relais à la réception.
  private predictedThrowReadyAt = 0;
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
    this.camera = new CameraRig(this.sceneStack.camera, (d) => this.sceneStack.setViewDistance(d));
    this.blades = new BladeRenderer(this.quality.simpleMaterials);
    this.crates = new CrateRenderer(this.quality);
    this.powerups = new PowerUpRenderer(this.quality);
    this.flagsView = new FlagRenderer(this.sceneStack.scene, this.quality);
    this.mapEventView = new MapEventView(this.quality);
    this.sceneStack.scene.add(this.mapEventView.root);
    this.particles = new ParticlePool(this.quality.maxParticles, this.quality.particleScale);
    this.combatFx = new CombatFx(this.quality);
    this.blades.setTrailSink(this.combatFx.trails);
    this.wisps = new AmbientWisps(this.quality);
    this.ground = createGround(this.quality);
    this.sceneStack.scene.add(this.ground.mesh);
    this.wall = createBoundaryWall(this.quality);
    this.sceneStack.scene.add(this.wall.object);
    this.decor = createDecor(this.quality);
    this.sceneStack.scene.add(this.decor.group);
    this.sceneStack.scene.add(this.blades.root);
    this.sceneStack.scene.add(this.crates.root);
    this.sceneStack.scene.add(this.powerups.root);
    this.sceneStack.scene.add(this.particles.object3d);
    this.sceneStack.scene.add(this.combatFx.object);
    this.sceneStack.scene.add(this.wisps.object3d);
    this.sceneStack.scene.add(this.aimIndicator.object);
    this.hud = new Hud();
    this.leaderboard = new Leaderboard();
    this.minimap = new Minimap();
    this.borderWarning = new BorderWarning();
    if (new URLSearchParams(window.location.search).get("debug") === "hitbox") {
      this.debugHitboxes = new DebugHitboxes(this.sceneStack.scene);
      (window as any).__bladeDebug = {
        stats: this.debugHitboxes.stats,
        thetaAt: (id: string, tick: number) => this.orbitThetaFor(id, tick),
        tick: () => this.room?.state?.tick ?? 0,
        ids: () => [...this.orbitSegments.keys()],
        frames: () => ({ count: this.debugHitboxes?.frameCount ?? 0, lastTick: this.debugHitboxes?.lastFrameTick ?? -1, renderTick: this.renderTick }),
        reset: () => this.debugHitboxes?.resetStats(),
        serverNow: () => this.serverNow(),
        protectedShown: () => !!this.players.get(this.myId)?.isProtectedShown,
        // Visée (tâches 1.3 et 1.4) : direction de marche et de visée
        // calculées, position dessinée du joueur local, projection d'un
        // point du sol à l'écran, projectiles lancés par le joueur local.
        input: () => this.input.peekDirBoost(),
        aim: () => this.input.aim(),
        me: () => {
          const v = this.players.get(this.myId);
          const p = this.room?.state?.players?.get(this.myId);
          return v && p ? { x: v.renderX, y: v.renderY, blades: p.bladeCount, dirX: p.dirX, dirY: p.dirY, alive: p.alive } : null;
        },
        screenOf: (x: number, y: number) => this.camera.screenOf(x, y),
        state: () => this.room?.state,
        myId: () => this.myId,
        myProjectiles: () => {
          const out: Array<{ id: string; vx: number; vy: number }> = [];
          this.room?.state?.blades?.forEach((b: any, id: string) => {
            if (b.isProjectile && b.thrownBy === this.myId) out.push({ id, vx: b.vx, vy: b.vy });
          });
          return out;
        },
        indicator: () => ({
          visible: this.aimIndicator.object.visible,
          rotationY: this.aimIndicator.object.rotation.y,
        }),
        // Retours de combat (tâche 1.5) : sons (pour les espionner), lames
        // en flash.
        sound: this.sound,
        flashing: () => this.blades.flashingCount(performance.now()),
        // Cadrage (tâche 1.7) : distance caméra courante.
        cameraDistance: () => this.camera.viewDistance,
        // Prédiction (tâche 1.2) : corrections de la position prédite à
        // chaque état reçu (u), inputs en attente d'acquittement.
        prediction: () => {
          const c = this.corrections;
          const mean = c.length ? c.reduce((a, b) => a + b, 0) / c.length : 0;
          return { mean, max: c.length ? Math.max(...c) : 0, count: c.length, pending: this.predictor.pendingCount };
        },
        resetPredictionStats: () => { this.corrections.length = 0; },
        groundAt: (x: number, y: number) => this.camera.groundAt(x, y),
        // Onboarding (tâche 3.1) : déclenche une indication.
        hint: (id: HintId) => this.onboarding.hint(id),
        // HUD (tâche 3.4) : ligne du fil des éliminations, ping mesuré.
        feed: (e: KillFeedEntry) => this.killFeed.push(e, performance.now()),
        ping: () => this.pingMs,
        // Zone d'intérêt (tâche 2.4) : résumé de la room (minimap, classement).
        summary: () => this.summary,
      };
    }
    this.settings = new SettingsPanel();
    this.chat = new ChatPanel();
    this.chat.setSendCallback((text, action) => {
      // L'envoi traverse Colyseus comme tous les autres messages. Le
      // serveur valide longueur + rate limit, masque les insultes (tâche
      // 5.6), puis rebroadcaste un ChatEvent à toute la room.
      try { this.room?.send("chat", action ? { text, action: true } : { text }); } catch { /* noop */ }
    });
    // Commandes /mute et /report : tous les joueurs de la room, d'après le
    // résumé du serveur (la vue locale ne voit que les proches).
    this.chat.setPlayerSource(() => (this.summary?.board ?? []).map(([id, name, , , bot]) => ({ id, name, bot })));
    this.chat.setReportCallback((targetId, reason) => {
      try { this.room?.send("report", { targetId, reason }); } catch { /* noop */ }
    });
    // Triche de test (/blades) : le serveur décide (salon privé, CHEATS=1).
    this.chat.setCheatCallback((blades, rarity) => {
      const msg: CheatMessage = {};
      if (blades !== undefined) msg.blades = blades;
      if (rarity !== undefined) msg.rarity = rarity;
      try { this.room?.send("cheat", msg); } catch { /* noop */ }
    });
    this.login = new LoginScreen((res) => this.start(res));
    this.death = new DeathScreen(
      () => this.respawn(),
      () => this.spectate(),
      () => this.returnToMenu(),
      () => void this.shareScore(),
    );
    document.getElementById("spectate-menu")?.addEventListener("click", () => void this.returnToMenu());
    // Caméra sur le tueur : un clic sur le jeu ou Espace, Entrée, Échap
    // passent directement à la carte (Échap la ferme ensuite, cf.
    // DeathScreen). L'écouteur de la carte, sur document, passe avant
    // celui-ci : le premier Échap ne quitte pas la partie.
    window.addEventListener("keydown", (e) => {
      if (e.repeat || !this.pendingDeath) return;
      if (e.key === " " || e.key === "Enter" || e.key === "Escape") this.showDeathCard();
    });
    this.canvas.addEventListener("pointerdown", () => {
      if (this.pendingDeath) this.showDeathCard();
    });
    this.input = new InputManager(
      this.canvas,
      document.getElementById("joystick")!,
      document.getElementById("joystick-base")!,
      document.getElementById("joystick-thumb")!,
      document.getElementById("boost-btn")!,
      document.getElementById("throw-btn"),
    );
    // Souris et glisser de visée projetés sur le sol depuis le joueur local
    // tel qu'il est dessiné (celui que suit la caméra).
    this.input.setProjector({
      groundAt: (x, y) => this.camera.groundAt(x, y),
      screenOf: (x, y) => this.camera.screenOf(x, y),
      player: () => {
        const v = this.players.get(this.myId);
        return v && !this.dead ? { x: v.renderX, y: v.renderY } : null;
      },
    });
    this.throwBtn = document.getElementById("throw-btn");
    this.onboarding = new Onboarding(() => this.input.isTouch);
    this.profile = new ProfilePanel();
    void this.profile.refreshBadge();
    this.haptics = new Haptics(() => this.input.isTouch);
    // Contrôles tactiles et bouton de chat suivent le mode d'entrée courant
    // (un PC à écran tactile bascule selon le dernier périphérique utilisé).
    this.input.onModeChange((touch) => {
      for (const id of ["joystick", "boost-btn", "throw-btn"]) {
        document.getElementById(id)?.classList.toggle("hidden", !touch);
      }
      this.chat.setTouchMode(touch);
    });
    this.settings.onChange((s) => {
      this.sound.setVolumes(s.master, s.music, s.sfx);
      this.input.setSensitivity(s.joystickSens);
      this.nametags.setEnabled(s.showNametags);
      this.haptics.enabled = s.vibration;
      this.camera.shake.intensity = shakeIntensity(s);
      this.blades.setFlashIntensity(s.flashes);
      this.mapEventView.setFlashIntensity(s.flashes);
      this.particles.setFlashIntensity(s.flashes);
      this.combatFx.setFlashIntensity(s.flashes);
      this.flashK = s.flashes;
      this.borderWarning.setFlashIntensity(s.flashes);
      this.wall.setFlashIntensity(s.flashes);
      this.decor.setFlashIntensity(s.flashes);
    });
    this.settings.onQuit(() => {
      this.returnToMenu();
    });
    this.settings.onInvite(() => void this.invite((r) => this.settings.inviteFeedback(r)));
    this.hud.onInvite(() => void this.invite((r) => { if (r === "copied") this.hud.flashCopied(); }));
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
    this.chat.show();
    this.settings.setInGame(true);
    try { await this.sound.init(); } catch (e) { console.warn("audio init failed", e); }
    void this.sound.playBattleMusic();
    try {
      const joinOpts: JoinOptions = {};
      joinOpts.newcomer = !playedBefore();
      // Cosmétiques choisis sur cet appareil ; le serveur garde ce qui
      // appartient au joueur (tâche 6.1).
      joinOpts.loadout = getLoadout();
      if (res.mode === "create") {
        joinOpts.code = res.code;
        joinOpts.bots = res.bots;
      } else if (res.mode === "join") {
        joinOpts.code = res.code;
        // En JOIN CODE, on REFUSE la création de nouvelle room : si le code
        // tapé n'existe pas, on l'apprend tout de suite (RoomNotFoundError)
        // au lieu de spawn une room neuve où l'user serait seul en pensant
        // avoir rejoint quelqu'un.
        joinOpts.mustExist = true;
      }
      // Mode de jeu (tâche 7.3) : sa file publique, ou le mode du salon créé.
      if (res.gameMode) joinOpts.mode = res.gameMode;
      // Joueurs authentifiés → JWT passé au join, le serveur valide via
      // onAuth puis stocke userId sur le Player → score + wallet persistés.
      // Mode invité → token guest signé HMAC, le serveur credite
      // guest_wallets jusqu'au sign-in (où tout est transféré au compte).
      const token = auth.getAccessToken();
      if (token) {
        joinOpts.token = token;
      } else {
        joinOpts.guestToken = await ensureGuestToken();
        this.guestBalance = null;
        if (joinOpts.guestToken) void fetchGuestWallet().then((w) => { this.guestBalance = w ? w.balance : null; });
      }
      // Lien « rejoins-moi » (tâche 5.5) : l'arène de l'ami si elle existe
      // encore et a de la place, sinon une autre, annoncée en jeu.
      let room: any = null;
      if (res.roomId) {
        try {
          room = await this.conn.joinById(res.roomId, res.name, joinOpts);
        } catch (e) {
          console.warn("[blade.io] friend arena unavailable", e);
        }
      }
      this.room = room ?? await this.conn.join(res.name, joinOpts);
      if (res.roomId) {
        this.login.clearInvite();
        if (!room) this.toasts.push(t("net.friendArenaGone"));
      }
      markPlayed();
    } catch (e) {
      console.error("could not join", e);
      if (e instanceof RoomNotFoundError) {
        void showAlert(t("net.noRoom", { code: e.code }));
      } else if (String((e as any)?.message ?? e).includes("server_restarting")) {
        void showAlert(t("net.restarting"));
      }
      this.login.show();
      this.hud.hide();
      this.chat.hide();
      this.settings.setInGame(false);
      void this.sound.playLobbyMusic();
      return;
    }
    this.myId = this.room.sessionId;
    this.chat.setLocalPlayerId(this.myId);
    // Si on a un code (create ou join), on met à jour l'URL pour que le lien
    // soit partageable.
    if (res.mode === "create" || res.mode === "join") {
      const u = new URL(window.location.href);
      u.searchParams.set("room", res.code!);
      window.history.replaceState({}, "", u.toString());
    } else {
      // Partie publique : l'adresse ne garde ni code ni invitation (un
      // rechargement ne doit pas viser une arène peut-être fermée).
      const u = new URL(window.location.href);
      if (u.searchParams.has("room") || u.searchParams.has("join")) {
        u.searchParams.delete("room");
        u.searchParams.delete("join");
        window.history.replaceState({}, "", u.toString());
      }
    }
    this.setupRoom();
    // Carte des contrôles à la toute première partie.
    this.onboarding.enterGame(performance.now());
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
    const callbacks = Callbacks.get(room);
    const state: SyncedState = room.state;

    // Badge du code de room : affiché seulement pour les parties privées.
    const applyRoomInfo = () => {
      this.hud.setRoomCode(state.isPrivate ? (state.code ?? "") : "");
    };
    applyRoomInfo();
    callbacks.listen(state, "code", applyRoomInfo);
    callbacks.listen(state, "isPrivate", applyRoomInfo);

    // Horloge serveur : chaque patch apporte le tick courant.
    this.serverClock.reset();
    this.predictedThrowReadyAt = 0;
    this.orbitSegments.clear();
    this.timeline.length = 0;
    this.combatFeedback.clear();
    this.killFeed.clear();
    this.pendingBlades.clear();
    this.renderAlive.clear();
    this.departing.clear();
    this.summary = null;
    this.sentViewRadius = 0;
    this.nextViewCheckAt = 0;
    room.onMessage("summary", (summary: RoomSummary) => { this.summary = summary; });
    // Fin de partie (manches) puis partie suivante, que le serveur lance
    // seul : tout le monde réapparaît.
    this.match.reset();
    room.onMessage("matchEnd", (ev: MatchEndEvent) => this.onMatchEnd(ev));
    // Capture du drapeau : prises, chutes, retours, captures, au tick.
    room.onMessage("flag", (ev: FlagEvent & { tick?: number }) => this.atTick(ev.tick, () => this.onFlagEvent(ev), false));
    callbacks.listen(state, "phase", (phase, previous: number | undefined) => {
      if (phase === MatchPhase.Playing && previous === MatchPhase.Over) this.onMatchStart();
    });
    this.restartAt = 0;
    room.onMessage("restart", (msg: { at: number }) => {
      this.restartAt = typeof msg?.at === "number" ? msg.at : 0;
      this.nextRestartBannerAt = 0;
    });
    this.pingMs = null;
    this.pingSamples.length = 0;
    this.pingSentAt.clear();
    this.nextPingAt = 0;
    this.bestSubmitted = false;
    // Ping (tâche 3.4) : le serveur renvoie le numéro tel quel.
    room.onMessage("pong", (n: number) => {
      const sent = this.pingSentAt.get(n);
      if (sent === undefined) return;
      this.pingSentAt.delete(n);
      this.pingSamples.push(performance.now() - sent);
      if (this.pingSamples.length > 5) this.pingSamples.shift();
      const sorted = [...this.pingSamples].sort((a, b) => a - b);
      this.pingMs = sorted[Math.floor(sorted.length / 2)];
    });
    callbacks.listen(state, "tick", (tick) => {
      this.lastPatchTick = tick;
      this.serverClock.onTick(tick, performance.now());
    });
    callbacks.listen(state, "serverTime", (t) => this.serverClock.onServerTime(t, performance.now()));
    if (this.debugHitboxes) {
      const debug = this.debugHitboxes;
      room.onMessage("debugOrbits", (frame: DebugOrbitFrame) => debug.push(frame));
      room.send("debugOrbits", { on: true });
    }

    const onPlayerAdd = (p: any, key: string) => {
      const old = this.players.get(key);
      if (old) {
        if (!this.departing.has(key)) return;
        // Revenu (zone d'intérêt) avant que son retrait n'ait été rendu :
        // l'ancienne vue part tout de suite, une neuve suit le nouvel état.
        this.departing.delete(key);
        this.players.delete(key);
        if (old.dissolving) this.corpses.push(old);
        else this.disposePlayerView(old);
      }
      const isLocal = key === this.myId;
      const view = new PlayerView(isLocal, this.quality);
      view.applyCosmetics(p.skin ?? "", p.trail ?? "");
      view.targetX = p.x; view.targetY = p.y;
      view.renderX = p.x; view.renderY = p.y;
      view.prevX = p.x; view.prevY = p.y;
      view.prevTime = performance.now();
      view.targetTime = performance.now();
      this.sceneStack.scene.add(view.root);
      this.sceneStack.scene.add(view.trail);
      this.players.set(key, view);
      if (isLocal) {
        this.resetPrediction();
        this.needReconcile = true;
        // Arrivé en pleine manche sans réapparition (dernière équipe en
        // vie) : spectateur jusqu'à la suivante.
        if (!p.alive && state.phase === MatchPhase.Playing && !modeRespawns(state.mode ?? "ffa")) this.setSpectating(true);
      }
      this.recordOrbitSegment(key, p);
      this.renderAlive.set(key, !!p.alive);
      let aliveSeen = !!p.alive;
      callbacks.onChange(p, () => {
        const now = performance.now();
        this.recordOrbitSegment(key, p);
        view.setSnapshot(p.x, p.y, now);
        view.applyCosmetics(p.skin ?? "", p.trail ?? "");
        if (!!p.alive !== aliveSeen) {
          aliveSeen = !!p.alive;
          const alive = aliveSeen;
          // Mort au tick du kill ; mon propre respawn tout de suite.
          if (isLocal && alive) {
            this.renderAlive.set(key, true);
            view.resetTrail();
            view.resetDissolve();
          } else {
            this.atTick(this.lastPatchTick, () => {
              this.renderAlive.set(key, alive);
              if (alive) view.resetDissolve();
            }, false);
          }
        }
        if (isLocal) this.needReconcile = true;
      });
    };
    callbacks.onAdd(state, "players", onPlayerAdd, true);

    // Retrait d'un joueur (mort, sorti de la zone d'intérêt, caché dans un
    // buisson, parti) : au tick du patch sur la ligne de temps, comme ses
    // positions. Le serveur retire un mort de la vue des autres au tick
    // même du kill : retiré dès réception, il disparaissait ~80 ms avant le
    // coup fatal à l'écran, et l'élimination, jouée à son tick, ne le
    // trouvait plus (ni explosion, ni effet d'élimination, ni gain affiché
    // au tueur). L'élimination, reçue avant, passe la première au même tick.
    callbacks.onRemove(state, "players", (p, key) => {
      const v = this.players.get(key);
      if (!v) return;
      this.departing.set(key, p);
      this.atTick(state.tick, () => this.removePlayerView(key, v), false);
    });

    // Les lames en orbite (ou qui l'étaient) changent sur la ligne de temps,
    // au tick du patch, comme les positions de leurs propriétaires ; les
    // lames au sol et en vol restent immédiates (interpolées ou extrapolées
    // à partir de l'instant de réception).
    const bladeChanged = (b: any, key: string) => {
      const t = performance.now();
      const rarity = b.rarity as BladeRarity;
      const ownerId: string = b.ownerId;
      const ring: number = b.ringIndex;
      const slot: number = b.slotIndex;
      const x: number = b.x;
      const y: number = b.y;
      const proj = !!b.isProjectile;
      const vx: number = b.vx ?? 0;
      const vy: number = b.vy ?? 0;
      const expiring = !!b.expiring;
      const apply = () => this.blades.upsert(key, rarity, ownerId, ring, slot, x, y, t, proj, vx, vy, expiring);
      if (ownerId || this.blades.isOrbiting(key) || this.pendingBlades.has(key)) this.deferBlade(key, apply);
      else apply();
    };
    callbacks.onAdd(state, "blades", (b, key) => {
      bladeChanged(b, key);
      callbacks.onChange(b, () => bladeChanged(b, key));
      // Pluie de lames : chaque lame qui tombe dans la zone jette des
      // étincelles à sa couleur.
      if (!b.ownerId && !b.isProjectile) this.rainSpark(b.x, b.y, b.rarity as BladeRarity);
    }, true);
    callbacks.onRemove(state, "blades", (_b, key) => {
      if (this.blades.isOrbiting(key) || this.pendingBlades.has(key)) this.deferBlade(key, () => this.blades.remove(key));
      else this.blades.remove(key);
    });

    callbacks.onAdd(state, "crates", (c, key) => {
      this.crates.add(key, c.x, c.y, c.hp, c.maxHp, !!c.legendary);
    }, true);
    callbacks.onRemove(state, "crates", (_c, key) => {
      this.crates.remove(key);
    });

    callbacks.onAdd(state, "powerups", (pu, key) => {
      this.powerups.add(key, pu.type as PowerUpType, pu.rarity as BladeRarity, pu.x, pu.y);
    }, true);
    callbacks.onRemove(state, "powerups", (_pu, key) => {
      this.powerups.remove(key);
    });

    room.onMessage("bladeDestroyed", (msg: BladeDestroyedEvent) => this.atTick(msg.tick, () => {
      // Lame désintégrée par le mur : position au-delà du bord de l'arène
      // (orbite ou projectile entré dans la zone mortelle). Effet dédié,
      // pour qu'on comprenne d'où vient la perte.
      if (Math.hypot(msg.x, msg.y) >= this.arenaRadius() - WALL_ZAP_MARGIN) {
        this.particles.spawnSparks(msg.x, 1.4, msg.y, this.theme.palette.boundary, 30, 9);
        this.particles.spawnSparks(msg.x, 0.9, msg.y, this.theme.palette.rarityColor[msg.rarity], 10, 4);
        if (msg.ownerId === this.myId) {
          this.camera.shake.add(0.3);
          this.haptics.play("hitTaken");
        }
        this.sound.wallZap(msg.ownerId === this.myId ? 1 : this.audibleGain(msg.x, msg.y));
        return;
      }
      this.particles.spawnSparks(msg.x, 0.9, msg.y, this.theme.palette.rarityColor[msg.rarity], 24, 7.5);
      // Éclats projetés vers l'extérieur de l'orbite du porteur (pour un
      // projectile, son lanceur : ils poursuivent sa course).
      const owner = msg.ownerId ? this.players.get(msg.ownerId) : undefined;
      this.combatFx.shatter(msg.x, msg.y, this.theme.palette.rarityColor[msg.rarity],
        owner ? msg.x - owner.renderX : 0, owner ? msg.y - owner.renderY : 0);
      if (msg.ownerId === this.myId) {
        this.camera.shake.add(0.18);
        this.sound.bladeLost();
        this.haptics.play("hitTaken");
        // Repère au bord de l'écran, du côté de l'attaquant (lame adverse ou
        // lanceur du projectile) ; à défaut, du point de rupture. Le point de
        // rupture seul trompe quand les orbites se chevauchent : il peut être
        // à 90° de l'adversaire.
        const me = this.players.get(this.myId);
        if (me) {
          const by = msg.byId ? this.players.get(msg.byId) : undefined;
          const from = this.camera.screenOf(me.renderX, me.renderY);
          const at = by ? this.camera.screenOf(by.renderX, by.renderY) : this.camera.screenOf(msg.x, msg.y);
          this.combatFeedback.bladeLost(Math.atan2(at.y - from.y, at.x - from.x), performance.now());
        }
      } else {
        this.sound.bladeBreak(msg.rarity, this.audibleGain(msg.x, msg.y));
      }
    }));
    room.onMessage("pickup", (msg: PickupEvent) => {
      if (msg.playerId === this.myId) {
        this.sound.pickup(msg.rarity);
        const view = this.players.get(msg.playerId);
        if (view) this.particles.spawnSparks(view.renderX, 1.2, view.renderY, this.theme.palette.rarityColor[msg.rarity], 6, 2);
      }
    });
    // Caisses : sur la ligne de temps du rendu, comme les autres coups (la
    // lame qui frappe est dessinée 80 ms dans le passé).
    room.onMessage("crateHit", (msg: CrateHitEvent) => this.atTick(msg.tick, () => {
      this.crates.hit(msg.crateId, msg.hp);
      this.particles.spawnSparks(msg.x, 1.0, msg.y, this.theme.palette.fx.crateHitSpark, 8, 4);
    }));
    room.onMessage("crateDestroyed", (msg: CrateDestroyedEvent) => this.atTick(msg.tick, () => {
      this.particles.spawnExplosion(msg.x, 1.0, msg.y, this.theme.palette.fx.crateDestroyExplosion, 28);
      this.sound.crateBreak(this.audibleGain(msg.x, msg.y));
      if (msg.byId === this.myId) this.scorePop(msg.x, msg.y, SCORE_CRATE, "small");
    }));
    room.onMessage("powerupPickup", (msg: PowerUpPickupEvent) => {
      // Effet visuel coloré selon le type, et son propre au type.
      const color = this.theme.palette.powerUpColor[msg.type as PowerUpType] ?? this.theme.palette.fx.powerUpFallback;
      this.particles.spawnExplosion(msg.x, 1.0, msg.y, color, 22);
      // Le son est plein volume si c'est moi qui ramasse, atténué sinon.
      const g = msg.playerId === this.myId ? 1 : this.audibleGain(msg.x, msg.y);
      this.sound.powerUp(msg.type as PowerUpType, msg.rarity as BladeRarity, g);
      // Pour le joueur local, on retient la durée pour afficher la barre.
      if (msg.playerId === this.myId) {
        this.scorePop(msg.x, msg.y, SCORE_POWERUP, "small");
        const durMs = POWERUP_DURATION[msg.rarity as BladeRarity] * 1000;
        const key = powerUpEffectKey(msg.type as PowerUpType);
        if (key) this.effectDurations.set(key, Math.max(durMs, this.effectDurations.get(key) ?? 0));
        this.camera.shake.add(0.08);
      }
    });
    room.onMessage("playerKilled", (msg: PlayerKilledEvent) => this.atTick(msg.tick, () => {
      const victim = this.players.get(msg.victimId);
      // Effet d'élimination du tueur (tâche 6.1), sinon l'explosion du thème.
      const fx = lookOf(KILL_FX_LOOKS, msg.killFx ?? "");
      if (victim && fx) this.particles.spawnBurst(victim.renderX, 1, victim.renderY, fx);
      else if (victim) this.particles.spawnExplosion(victim.renderX, 1, victim.renderY, this.theme.palette.fx.deathExplosion, 40);
      if (victim) {
        // Onde de choc au sol et dissolution du corps (tâche 4.9), à la
        // couleur de l'effet d'élimination du tueur s'il en a un.
        const color = fx ? fx.colors[0] : this.theme.palette.fx.deathExplosion;
        this.combatFx.kill(victim.renderX, victim.renderY, this.theme.palette.fx.deathExplosion);
        victim.startDissolve(color, fxIntensity(this.flashK));
        this.particles.spawnRising(victim.renderX, victim.renderY, color, this.quality.fx.dissolveEmbers);
      }
      this.killFeed.push({
        killerName: msg.killerId ? msg.killerName : null,
        victimName: msg.victimName,
        cause: msg.cause ?? "blades",
        mine: msg.killerId === this.myId ? "killer" : msg.victimId === this.myId ? "victim" : null,
        bounty: msg.bounty ?? 0,
        underdog: !!msg.underdog,
      }, performance.now());
      if (msg.killerId === this.myId) {
        this.camera.shake.add(0.5);
        this.sound.killConfirm();
        this.haptics.play("kill");
        // Le gain affiché inclut la prime et le bonus underdog (tâche 4.2).
        const gain = SCORE_KILL + (msg.bounty ?? 0) + (msg.underdog ? SCORE_UNDERDOG : 0);
        if (victim) this.scorePop(victim.renderX, victim.renderY, gain, "big");
      }
      if (msg.victimId === this.myId) this.handleLocalDeath(msg);
    }, false));
    room.onMessage("clash", (msg: ClashEvent) => {
      // Mode debug : mesure aussi l'écart qu'aurait une étincelle jouée dès
      // réception (comportement d'avant la ligne de temps).
      if (this.debugHitboxes) this.clashChecksImmediate.push(this.clashCheckOf(msg));
      this.atTick(msg.tick, () => {
        if (this.debugHitboxes) this.clashChecks.push(this.clashCheckOf(msg));
        // Sparks au point d'impact, tier-scaled. Couleur cyan/violet pour ne
        // pas confondre avec les drops (sparks couleur rareté).
        const count = 6 + msg.tier * 6;
        const speed = 4 + msg.tier * 2.5;
        this.particles.spawnSparks(msg.x, 0.95, msg.y, this.theme.palette.fx.clashSpark, count, speed);
        this.combatFx.clash(msg.x, msg.y, msg.tier, msg.destroyed, this.theme.palette.fx.clashSpark);
        // Flash blanc des deux lames au contact (une lame brisée disparaît
        // dans la foulée, son retrait arrive après ce message).
        const flashAt = performance.now();
        this.blades.flash(msg.aId, flashAt);
        this.blades.flash(msg.bId, flashAt);
        const r: BladeRarity = msg.tier === 0 ? BladeRarity.Common
          : msg.tier === 1 ? BladeRarity.Rare
          : BladeRarity.Epic;
        // Screen shake : intensité tier-aware, mais SEULEMENT si le joueur
        // local est l'un des deux protagonistes (sinon l'écran tremble pour
        // chaque clash sur la map = nausée garantie). Au plus une secousse
        // toutes les 200 ms, plafonnée : en combat, plusieurs clashs par
        // seconde la saturaient. (Jusqu'à la tâche 1.5, ce test comparait
        // des ids de lame à l'id du joueur et ne passait jamais.)
        if (msg.aOwnerId === this.myId || msg.bOwnerId === this.myId) {
          const t = performance.now();
          if (t - this.lastClashShakeAt >= 200) {
            this.lastClashShakeAt = t;
            this.camera.shake.addCapped(tierClashShake(msg.tier), 0.5);
          }
          this.sound.hit(r);
          this.haptics.play("clash");
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
    });
    room.onMessage("bladeThrown", (msg: BladeThrownEvent) => {
      // Mon lancer : son et secousse tout de suite (retour de l'input). Le
      // burst visuel part au tick du lancer, quand la lame quitte l'orbite
      // à l'écran.
      if (msg.thrownBy === this.myId) {
        this.sound.throwBlade(msg.rarity, 1);
        this.camera.shake.add(0.12);
      }
      this.atTick(msg.tick, () => {
        const color = this.theme.palette.rarityColor[msg.rarity];
        this.particles.spawnSparks(msg.x, 1.0, msg.y, color, 14, 6);
        if (msg.thrownBy !== this.myId) this.sound.throwBlade(msg.rarity, this.audibleGain(msg.x, msg.y));
      });
    });
    room.onMessage("projectileImpact", (msg: ProjectileImpactEvent) => this.atTick(msg.tick, () => {
      // Impact : sparks+son. Si c'est la dernière vie de la lame
      // (destroyed=true), explosion plus dense pour signifier la fin.
      const color = this.theme.palette.rarityColor[msg.rarity];
      const count = msg.destroyed ? 22 : 10;
      const speed = msg.destroyed ? 7 : 4;
      this.particles.spawnSparks(msg.x, 0.95, msg.y, color, count, speed);
      this.sound.hit(msg.rarity, this.audibleGain(msg.x, msg.y));
    }));
    room.onMessage("tierUp", (msg: TierUpEvent) => this.atTick(msg.tick, () => {
      // Tier-up VFX : ring d'étincelles autour du joueur + shake si local.
      // On utilise une explosion bien dense pour signaler le palier passé.
      const color = msg.tier >= 2 ? this.theme.palette.fx.tierUpHi : this.theme.palette.fx.tierUpLo;
      this.particles.spawnExplosion(msg.x, 1.0, msg.y, color, 32 + msg.tier * 12);
      // Colonne de lumière qui suit le joueur (tâche 4.9).
      this.combatFx.tierUp(msg.playerId, msg.x, msg.y, msg.tier, color);
      if (msg.playerId === this.myId) {
        const intensity = TIER_UP_SHAKE[Math.min(msg.tier, TIER_UP_SHAKE.length - 1)] ?? 0.3;
        this.camera.shake.add(intensity);
        this.sound.tierUp(msg.tier);
      }
    }));
    room.onMessage("challengeDone", (msg: ChallengeDoneEvent) => {
      for (const done of msg.challenges ?? []) {
        const def = challengeById(done.challenge);
        if (!def) continue;
        this.toasts.push(t("challenge.toast", { name: challengeText(def), reward: done.reward }));
        // Récompense créditée par le serveur : solde et niveau à jour.
        if (this.guestBalance !== null && !auth.getAccessToken()) this.guestBalance += done.reward;
      }
      if (auth.getAccessToken()) void wallet.refresh();
      this.sound.challengeDone();
    });
    room.onMessage("chat", (msg: ChatEvent) => {
      this.chat.onChatEvent(msg);
    });
    room.onMessage("reportAck", (msg: ReportAck) => this.chat.onReportAck(msg.status));
    room.onMessage("chatMuted", (msg: ChatMutedEvent) => this.chat.onMuted(msg.seconds));
    room.onMessage("cheat", (msg: CheatResult) => this.chat.onCheat(msg));
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
      // Fermeture après le compte à rebours de redémarrage : pas de
      // reconnexion (la room n'existe plus), retour au menu expliqué.
      if (this.restartAt > 0) {
        void this.backToMenuAfterRestart(room);
        return;
      }
      // Expulsion pour flood : pas de reconnexion (le serveur la refuserait
      // de toute façon), et on dit pourquoi. L'alerte passe avant le retour
      // au menu, qui peut recharger la page (preset abaissé en partie).
      if (code === CLOSE_CODE_INPUT_FLOOD) {
        void showAlert(t("net.inputFlood"));
        this.returnToMenu();
        return;
      }
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
    this.clearPlayerViews();
    this.blades.clear();
    this.crates.clear();
    this.powerups.clear();
    this.flagsView.clear();
    this.resetPrediction();
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

  // Retire la vue d'un joueur au tick de son retrait sur la ligne de temps
  // (cf. players.onRemove). Un corps en pleine dissolution la termine à part.
  private removePlayerView(key: string, v: PlayerView): void {
    // Revenu entre-temps : l'ancienne vue a déjà été retirée (onPlayerAdd).
    if (this.players.get(key) !== v) return;
    this.departing.delete(key);
    this.players.delete(key);
    this.orbitSegments.delete(key);
    this.renderAlive.delete(key);
    if (v.dissolving) {
      this.corpses.push(v);
      return;
    }
    // Un joueur qui disparaît dans un buisson (le serveur ne l'envoie
    // plus) : rafale de pixels là où il est entré (tâche 4.7).
    if (key !== this.myId && bushAt(v.renderX, v.renderY) >= 0) {
      this.particles.spawnSparks(v.renderX, 1.2, v.renderY, this.decor.bushBurstColor, 12, 3);
    }
    this.disposePlayerView(v);
  }

  private disposePlayerView(v: PlayerView): void {
    v.dispose();
    v.trail.parent?.remove(v.trail);
  }

  // Vues des joueurs, corps en dissolution et effets de combat : tout part
  // (retour au menu, reconnexion).
  private clearPlayerViews(): void {
    for (const v of this.players.values()) this.disposePlayerView(v);
    this.players.clear();
    for (const c of this.corpses) this.disposePlayerView(c);
    this.corpses.length = 0;
    this.departing.clear();
    this.combatFx.clear();
  }

  // État d'un joueur affiché : celui de la room ou, pendant son retrait
  // différé, le dernier reçu.
  private playerState(id: string): any {
    return this.room?.state?.players?.get(id) ?? this.departing.get(id);
  }

  private playerPositions: PlayerPositionProvider = {
    getRenderPosition: (id: string) => {
      const v = this.players.get(id);
      if (!v) return undefined;
      const p = this.playerState(id);
      const spinPhase = p?.spinPhase ?? 0;
      const tier = p?.tier ?? 0;
      const theta = this.orbitThetaFor(id, this.renderTick);
      const bladeCount = p?.bladeCount ?? 0;
      const bladeStyle = lookOf(BLADE_STYLES, p?.bladeSkin ?? "") ?? 0;
      return { x: v.renderX, y: v.renderY, spinPhase, theta, tier, bladeCount, bladeStyle };
    },
  };

  private clashCheckOf(msg: ClashEvent): ClashCheck {
    return { x: msg.x, y: msg.y, a: this.blades.orbitInfo(msg.aId), b: this.blades.orbitInfo(msg.bId) };
  }

  // Distance entre le point d'un clash et le milieu des deux lames telles
  // que dessinées à cette frame (tick de rendu courant).
  private clashDistance(c: ClashCheck): number | null {
    const pa = c.a && this.drawnOrbitPosition(c.a);
    const pb = c.b && this.drawnOrbitPosition(c.b);
    if (!pa || !pb) return null;
    return Math.hypot((pa.x + pb.x) / 2 - c.x, (pa.y + pb.y) / 2 - c.y);
  }

  private drawnOrbitPosition(o: OrbitInfo): { x: number; y: number } | null {
    const owner = this.playerPositions.getRenderPosition(o.ownerId);
    if (!owner) return null;
    const a = orbitSlotAngle(o.ring, o.slot, o.inRing, owner.theta, owner.spinPhase);
    const r = ringRadius(o.ring);
    return { x: owner.x + Math.cos(a) * r, y: owner.y + Math.sin(a) * r };
  }

  // Heure du serveur estimée (Date.now() du serveur), pour comparer ses
  // échéances. Avant la première synchro : horloge locale, faute de mieux.
  private serverNow(): number {
    return this.serverClock.isEpochReady ? this.serverClock.epochAt(performance.now()) : Date.now();
  }

  // Joue `run` quand le tick de rendu atteint `tick` (tout de suite si
  // l'horloge n'est pas encore calée ou sans tick). fx : effet visuel ou
  // sonore, sauté s'il est en retard de plus de 0,5 s (onglet revenu de
  // l'arrière-plan) ; sinon (changement d'état), toujours appliqué.
  private atTick(tick: number | undefined, run: () => void, fx = true): void {
    if (tick === undefined || !this.serverClock.isReady) {
      run();
      return;
    }
    const last = this.timeline[this.timeline.length - 1];
    if (last && tick < last.tick) this.timelineSorted = false;
    this.timeline.push({ tick, seq: this.timelineSeq++, run, fx });
  }

  private flushTimeline(): void {
    if (this.timeline.length === 0) return;
    if (!this.timelineSorted) {
      this.timeline.sort((a, b) => a.tick - b.tick || a.seq - b.seq);
      this.timelineSorted = true;
    }
    const staleBefore = this.renderTick - 30;
    let i = 0;
    for (; i < this.timeline.length; i++) {
      const item = this.timeline[i];
      if (item.tick > this.renderTick) break;
      if (!item.fx || item.tick >= staleBefore) item.run();
    }
    if (i > 0) this.timeline.splice(0, i);
  }

  // Change une lame au tick du patch courant, après ceux déjà en attente.
  private deferBlade(key: string, run: () => void): void {
    this.pendingBlades.set(key, (this.pendingBlades.get(key) ?? 0) + 1);
    this.atTick(this.lastPatchTick, () => {
      run();
      const left = (this.pendingBlades.get(key) ?? 1) - 1;
      if (left <= 0) this.pendingBlades.delete(key);
      else this.pendingBlades.set(key, left);
    }, false);
  }

  // Enregistre le segment d'horloge d'orbite courant d'un joueur s'il est
  // nouveau. Appelé à chaque changement du joueur (donc à chaque patch où
  // il bouge) : trois lectures de champ, négligeable.
  private recordOrbitSegment(id: string, p: any): void {
    let segs = this.orbitSegments.get(id);
    if (!segs) {
      segs = [];
      this.orbitSegments.set(id, segs);
    }
    const tick: number = p.orbitTick ?? 0;
    const phase: number = p.orbitPhase ?? 0;
    const rate: number = p.orbitRate ?? 0;
    const last = segs[segs.length - 1];
    if (last && last.tick === tick) {
      last.phase = phase;
      last.rate = rate;
      return;
    }
    // Tick antérieur au dernier segment : nouvel état (reconnexion) → on repart de zéro.
    if (last && tick < last.tick) segs.length = 0;
    segs.push({ tick, phase, rate });
    if (segs.length > 16) segs.splice(0, segs.length - 16);
  }

  // Horloge d'orbite d'un joueur à un tick (fractionnaire) : segment le plus
  // récent déjà commencé à ce tick ; à défaut, le plus ancien connu.
  private orbitThetaFor(id: string, tick: number): number {
    const segs = this.orbitSegments.get(id);
    if (!segs || segs.length === 0) return 0;
    let seg = segs[0];
    for (let i = segs.length - 1; i >= 0; i--) {
      if (segs[i].tick <= tick) {
        seg = segs[i];
        break;
      }
    }
    return orbitThetaAt(seg.phase, seg.rate, seg.tick, tick);
  }

  private handleLocalDeath(msg: PlayerKilledEvent): void {
    if (this.dead) return;
    this.dead = true;
    this.onboarding.leaveGame();
    const me = this.room?.state?.players?.get(this.myId);
    if (!me) return;
    const lifeMs = this.serverNow() - me.spawnedAt;
    const rank = this.computeMyRank();
    const best = this.submitLife(me);
    this.sound.death();
    this.haptics.play("death");
    this.camera.shake.add(0.8);
    const earned = me.score;
    const isAuthed = auth.getAccessToken() !== null;
    // Room privée : le serveur ne crédite rien (cf. persistMatchIfAuthed).
    const isPrivate = !!this.room?.state?.isPrivate;
    // Invité avec un jeton : le serveur crédite son portefeuille invité.
    const guestSaved = !isAuthed && !isPrivate && getGuestToken() !== null;
    // Solde connu à l'instant de la mort, +ce qu'on vient de gagner. Le vrai
    // total côté serveur peut différer si plusieurs onglets jouent en
    // parallèle ; on rafraîchit en arrière-plan pour reconverger.
    const cached = wallet.get();
    let total: number | null = null;
    // XP d'avant cette vie (tâche 5.2) : trophées gagnés du compte, ou
    // solde invité (un invité ne dépense rien).
    let xpBefore: number | null = null;
    if (isAuthed && !isPrivate && cached) {
      total = cached.balance + earned;
      xpBefore = cached.total_earned;
    }
    if (guestSaved && this.guestBalance !== null) {
      xpBefore = this.guestBalance;
      this.guestBalance += earned;
      total = this.guestBalance;
    }
    const killer = msg.killerId ? msg.killerName : null;
    this.pendingDeath = {
      lifeSeconds: Math.max(0, lifeMs / 1000),
      maxBlades: me.maxBladeCount,
      kills: me.kills,
      rank,
      score: earned,
      cratesDestroyed: me.cratesDestroyed ?? 0,
      powerupsCollected: me.powerupsCollected ?? 0,
      cause: msg.cause ?? (killer ? "blades" : "wall"),
      killerName: killer,
      killerBlades: msg.killerBlades ?? null,
      victimBlades: msg.victimBlades ?? 0,
      best,
      // Le serveur persiste seulement si le joueur a fourni un token au
      // join. Côté client, l'état d'auth au moment de la mort est la
      // meilleure approximation.
      scorePersisted: isAuthed && !isPrivate,
      guestSaved,
      walletTotal: total,
      privateRoom: isPrivate,
      xp: xpBefore === null ? null : { before: xpBefore, gained: earned },
    };
    // Caméra sur le tueur, puis la carte ; mort à la bordure : un temps
    // pour voir les lames se désintégrer.
    const view = this.players.get(this.myId);
    this.killCam = {
      killerId: msg.killerId,
      x: view?.renderX ?? me.x,
      y: view?.renderY ?? me.y,
      cardAt: performance.now() + (msg.killerId ? KILLCAM_MS : WALL_DEATH_MS),
    };
    this.showKillCamBanner(this.pendingDeath);
    // Refresh asynchrone du solde authoritative pour le prochain affichage
    // (login screen au retour menu, prochaine mort).
    if (isAuthed) void wallet.refresh();
  }

  // Bandeau de la caméra sur le tueur : qui, comment, avec combien de lames.
  private showKillCamBanner(d: DeathStats): void {
    const el = document.getElementById("killcam");
    if (!el) return;
    const label = el.querySelector(".kc-label") as HTMLElement;
    const name = el.querySelector(".kc-name") as HTMLElement;
    const skip = el.querySelector(".kc-skip") as HTMLElement;
    if (d.cause === "wall" || !d.killerName) {
      label.textContent = t("killcam.outOfBounds");
      name.textContent = t("killcam.redEdge");
    } else {
      label.textContent = t(d.cause === "throw" ? "killcam.throwBy" : "killcam.killedBy");
      name.textContent = d.killerName;
    }
    this.setKillCamBlades(d.killerBlades);
    skip.textContent = t(this.input.isTouch ? "killcam.skipTouch" : "killcam.skipDesktop");
    el.classList.remove("hidden");
  }

  private setKillCamBlades(n: number | null): void {
    const el = document.querySelector("#killcam .kc-blades") as HTMLElement | null;
    if (el) el.textContent = n === null ? "" : n === 1 ? t("common.oneBlade") : t("common.nBlades", { n });
  }

  // Caméra sur le tueur : elle glisse vers lui puis le suit, tant qu'il
  // est en vie et que le serveur nous l'envoie (zone d'intérêt autour du
  // lieu de la mort, buissons : cf. tâche 2.4) ; sinon elle reste où elle
  // est.
  private updateKillCam(now: number, dt: number): void {
    const kc = this.killCam!;
    const killerState = kc.killerId ? this.room?.state?.players?.get(kc.killerId) : undefined;
    const killerView = kc.killerId ? this.players.get(kc.killerId) : undefined;
    if (killerState?.alive && killerView) {
      const k = 1 - Math.exp(-dt / KILLCAM_PAN_TAU);
      kc.x += (killerView.renderX - kc.x) * k;
      kc.y += (killerView.renderY - kc.y) * k;
    }
    this.camera.setTarget(kc.x, kc.y);
    this.camera.setOrbitRadius(killerState?.alive ? outerOrbitRadius(killerState.bladeCount) : 0);
    if (this.pendingDeath) {
      // Nombre de lames du tueur en direct : il ramasse le butin.
      if (killerState?.alive) this.setKillCamBlades(killerState.bladeCount);
      if (now >= kc.cardAt) this.showDeathCard();
    }
  }

  // Fin de la caméra sur le tueur (délai écoulé ou passée par le joueur).
  private showDeathCard(): void {
    if (!this.pendingDeath) return;
    document.getElementById("killcam")?.classList.add("hidden");
    // Sans réapparition (dernière équipe en vie) : REGARDER au lieu de
    // REJOUER.
    this.death.setSpectate(!modeRespawns(this.room?.state?.mode ?? "ffa"));
    this.death.show(this.pendingDeath);
    this.pendingDeath = null;
  }

  private endKillCam(): void {
    this.killCam = null;
    this.pendingDeath = null;
    document.getElementById("killcam")?.classList.add("hidden");
  }

  // Minuterie de la partie ; la dernière minute d'une manche est annoncée.
  // Modes équipe : les deux scores, celui de son équipe d'abord.
  private updateMatchUi(serverNowMs: number): void {
    const state = this.room?.state;
    if (!state) return;
    const mode: string = state.mode ?? "ffa";
    const hud: MatchHud = {
      phase: state.phase ?? MatchPhase.Playing,
      endsAt: state.phaseEndsAt ?? 0,
      roundBased: mode !== "tdm" && mode !== "ctf",
      shrinks: modeShrinks(mode),
      team: null,
    };
    const mine = this.myTeam();
    const label = TEAM_SCORE_LABELS[mode];
    if (label && mine !== TEAM_NONE) {
      const a: number = state.teamScore1 ?? 0;
      const b: number = state.teamScore2 ?? 0;
      hud.team = { label: t(label), mine: mine === 1 ? a : b, theirs: mine === 1 ? b : a };
    }
    if (this.match.update(hud, serverNowMs)) {
      this.toasts.push(t("match.shrinkToast"));
      this.sound.borderWarning(1);
      this.haptics.play("hitTaken");
    }
  }

  // Bandeaux en jeu, 4 s chacun, dans l'ordre.
  private updateToast(now: number): void {
    if (now < this.toastUntil) return;
    const el = document.getElementById("challenge-toast");
    if (!el) return;
    const next = this.toasts.shift();
    if (next === undefined) {
      if (this.toastUntil !== 0) {
        el.classList.add("hidden");
        this.toastUntil = 0;
      }
      return;
    }
    el.textContent = next;
    el.classList.remove("hidden");
    this.toastUntil = now + 4000;
  }

  // Room en cours, pour les liens d'invitation (tâche 5.5).
  private roomRef(): RoomRef | null {
    const room = this.room;
    if (!room) return null;
    return { roomId: room.roomId, code: String(room.state?.code ?? ""), isPrivate: !!room.state?.isPrivate };
  }

  // Invitation dans la room en cours : lien vers le salon privé, ou vers
  // cette arène publique.
  private async invite(feedback: (r: ShareResult) => void): Promise<void> {
    const ref = this.roomRef();
    if (!ref) return;
    const text = ref.isPrivate ? t("share.inviteRoom", { code: ref.code }) : t("share.inviteArena");
    feedback(await share({ title: "blade.io", text, url: inviteUrl(ref) }, { native: this.input.isTouch }));
  }

  // Partage du score de la carte de fin de vie, avec le lien de l'arène.
  private async shareScore(): Promise<void> {
    const s = this.death.lastStats;
    const ref = this.roomRef();
    if (!s || !ref) return;
    const text = t("share.score", { score: formatNumber(s.score, 0), kills: s.kills, blades: s.maxBlades });
    const r = await share({ title: "blade.io", text, url: inviteUrl(ref) }, { native: this.input.isTouch, copyText: true });
    this.death.shareFeedback(r);
  }

  // Fin d'une vie en room publique, versée une fois (à la mort ou au retour
  // au menu) : record personnel (cf. personalBest) et statistiques locales
  // du profil (tâche 5.1). Renvoie le record d'avant et s'il est battu
  // (null : rien de versé).
  private submitLife(me: any): { previous: number; isNew: boolean } | null {
    if (this.bestSubmitted || this.room?.state?.isPrivate) return null;
    this.bestSubmitted = true;
    recordLocalLife({
      score: me.score,
      kills: me.kills,
      maxBlades: me.maxBladeCount,
      survivalSeconds: Math.max(0, (this.serverNow() - me.spawnedAt) / 1000),
      crates: me.cratesDestroyed ?? 0,
      powerups: me.powerupsCollected ?? 0,
    });
    return submitScore(me.score);
  }

  // Gain flottant du joueur local : « +N 🏆 » en public, « +N » en room
  // privée (points sans trophées).
  private scorePop(x: number, y: number, points: number, size: "big" | "small"): void {
    const text = this.room?.state?.isPrivate ? `+${points}` : `+${points} 🏆`;
    this.combatFeedback.scorePop(x, y, text, size, performance.now());
  }

  private computeMyRank(): number {
    const entries = this.boardEntries();
    entries.sort((a, b) => b.score - a.score);
    const idx = entries.findIndex((e) => e.id === this.myId);
    return idx >= 0 ? idx + 1 : entries.length;
  }

  // Classement de toute la room : résumé du serveur (2 Hz), avec mes
  // propres valeurs prises dans l'état, plus frais. Avant le premier
  // résumé : les joueurs reçus (ceux de ma zone).
  // Mon score : celui de ma vie, plus frais que le résumé, dans l'arène ;
  // ailleurs, le classement compte toute la partie (GameMode.standing) et
  // seul le résumé le connaît (avant, ma ligne n'avait que ma vie en cours
  // dans les manches). Modes équipe : ◆ sur son équipe.
  private boardEntries(): LeaderboardEntry[] {
    const entries: LeaderboardEntry[] = [];
    const me = this.room?.state?.players?.get(this.myId);
    const mine = this.myTeam();
    const lifeScore = (this.room?.state?.mode ?? "ffa") === "ffa";
    if (this.summary) {
      for (const [id, name, score, bladeCount, bot, team] of this.summary.board) {
        const ally = sameTeam(mine, team ?? TEAM_NONE);
        if (id === this.myId && me) {
          entries.push({ id, name: me.name, score: lifeScore ? me.score : score, bladeCount: me.bladeCount, ally });
        } else {
          entries.push({ id, name, score, bladeCount, bot, ally });
        }
      }
      if (me && !entries.some((e) => e.id === this.myId)) {
        entries.push({ id: this.myId, name: me.name, score: me.score, bladeCount: me.bladeCount, ally: mine !== TEAM_NONE });
      }
      return entries;
    }
    this.room?.state?.players?.forEach((p: any, id: string) => {
      entries.push({ id, name: p.name, score: p.score, bladeCount: p.bladeCount, bot: p.isBot, ally: sameTeam(mine, p.team ?? TEAM_NONE) });
    });
    return entries;
  }

  // Rayon de l'arène du moment : celui de la carte, resserré en fin de
  // manche (ArenaState.mapRadius, tâche 7.1).
  private arenaRadius(): number {
    const r = this.room?.state?.mapRadius;
    return typeof r === "number" && r > 0 ? r : MAP_RADIUS;
  }

  // Équipe du joueur local (modes équipe), TEAM_NONE sinon.
  private myTeam(): number {
    return this.room?.state?.players?.get(this.myId)?.team ?? TEAM_NONE;
  }

  // Entracte d'une partie à fin : rien ne bouge, plus d'inputs.
  private matchOver(): boolean {
    return this.room?.state?.phase === MatchPhase.Over;
  }

  // Fin de partie : la vie en cours compte pour le record ; le podium
  // remplace la caméra sur le tueur et l'écran de mort.
  private onMatchEnd(ev: MatchEndEvent): void {
    const me = this.room?.state?.players?.get(this.myId);
    if (me?.alive && !this.dead) this.submitLife(me);
    this.death.hide();
    this.endKillCam();
    this.setSpectating(false);
    this.resetPrediction();
    this.match.showPodium(ev, this.myId, this.myTeam());
    this.sound.challengeDone();
  }

  // Drapeaux synchronisés (capture du drapeau), relus à chaque image.
  private readFlags(): Array<FlagSnapshot & FlagStatus> {
    const out = this.flagStates;
    out.length = 0;
    this.room?.state?.flags?.forEach((f: any) => {
      out.push({ team: f.team, x: f.x, y: f.y, carrierId: f.carrierId ?? "", atBase: !!f.atBase, returnsAt: f.returnsAt ?? 0 });
    });
    return out;
  }

  private updateFlags(myTeam: number, dt: number, serverNowMs: number): void {
    const flags = this.readFlags();
    this.flagsView.update(flags, myTeam, (id) => {
      const v = this.players.get(id);
      if (!v || !(this.renderAlive.get(id) ?? false)) return null;
      this.flagCarrierPos.x = v.renderX;
      this.flagCarrierPos.y = v.renderY;
      return this.flagCarrierPos;
    }, dt);
    if (this.matchOver()) this.flagHud.hide();
    else this.flagHud.update(flags, myTeam, this.myId, serverNowMs);
    // Porteur rentré chez lui alors que son drapeau n'y est pas : la règle,
    // une fois.
    const carried = flags.find((f) => f.carrierId === this.myId);
    const home = flags.find((f) => f.team === myTeam);
    const me = this.players.get(this.myId);
    if (!carried) {
      this.needHomeShown = false;
    } else if (!this.needHomeShown && home && !home.atBase && me) {
      const base = teamBase(myTeam);
      if (Math.hypot(me.renderX - base.x, me.renderY - base.y) <= CTF_BASE_RADIUS) {
        this.needHomeShown = true;
        this.toasts.push(t("flag.toast.needHome"));
      }
    }
  }

  // Fil et bandeaux des évènements de drapeau, vus de son équipe.
  private onFlagEvent(ev: FlagEvent): void {
    const mine = this.myTeam();
    if (mine === TEAM_NONE) return;
    const ours = ev.team === mine;
    const now = performance.now();
    const name = ev.name ?? null;
    const i = ours ? 0 : 1;
    switch (ev.kind) {
      case "take":
        this.killFeed.pushFlag(name, t(FLAG_FEED_KEYS.take[i]), !ours, now);
        if (ev.playerId === this.myId) {
          this.toasts.push(t("flag.toast.carry"));
          this.sound.tierUp(2);
        } else if (ours) {
          this.sound.borderWarning(0.6);
          this.haptics.play("hitTaken");
        }
        break;
      case "drop":
        this.killFeed.pushFlag(name, t(FLAG_FEED_KEYS.drop[i]), ours, now);
        break;
      case "return":
        if (name) this.killFeed.pushFlag(name, t(FLAG_FEED_KEYS.return[i]), ours, now);
        else this.killFeed.pushFlag(null, t(FLAG_FEED_KEYS.home[i]), ours, now);
        break;
      case "capture":
        this.killFeed.pushFlag(name, t(FLAG_FEED_KEYS.capture[i]), !ours, now);
        this.toasts.push(t(ours ? "flag.toast.conceded" : "flag.toast.scored"));
        if (ours) this.sound.bladeLost();
        else this.sound.challengeDone();
        break;
    }
  }

  // Arène qui se resserre faute de joueurs (tâche 4.5) : la future limite
  // au sol et sur la minimap, bannière et bip à l'annonce. Pas pendant la
  // dernière minute d'une manche : le mur y va plus loin que ce repère, et
  // « vers le centre » est déjà annoncé.
  private updateArenaShrink(serverNowMs: number): void {
    const state = this.room?.state;
    const at: number = state?.arenaShrinkAt ?? 0;
    const target: number = state?.arenaTarget ?? 0;
    const roundEnding = modeShrinks(state?.mode ?? "ffa")
      && state?.phase === MatchPhase.Playing
      && (state?.phaseEndsAt ?? 0) - serverNowMs <= ROUND_SHRINK_MS;
    const shown = at > 0 && target > 0 && target < this.arenaRadius() - 0.5 && !roundEnding && !this.matchOver();
    this.shownArenaTarget = shown ? target : 0;
    this.wall.setTarget(this.shownArenaTarget, serverNowMs < at);
    if (at === this.lastShrinkAt) return;
    this.lastShrinkAt = at;
    if (!shown || serverNowMs >= at) return;
    this.toasts.push(t("arena.shrinkNotice", { s: Math.max(1, Math.round((at - serverNowMs) / 1000)) }));
    this.sound.borderWarning(0.5);
  }

  // Évènement de carte (tâche 4.4) : bannière et son à son annonce (ou à
  // l'arrivée en cours d'évènement), zone au sol à chaque image.
  private updateMapEvent(serverNowMs: number): void {
    const src = this.room?.state?.mapEvent;
    const ev = this.mapEventSnap;
    ev.kind = src?.kind ?? MapEventKind.None;
    ev.x = src?.x ?? 0;
    ev.y = src?.y ?? 0;
    ev.radius = src?.radius ?? 0;
    ev.startsAt = src?.startsAt ?? 0;
    ev.endsAt = src?.endsAt ?? 0;
    this.mapEventView.update(ev, serverNowMs, this.elapsed * 0.001);
    if (ev.kind === this.lastEventKind) return;
    this.lastEventKind = ev.kind;
    const key = MAP_EVENT_TOASTS[ev.kind];
    if (!key || this.matchOver()) return;
    this.toasts.push(t(key));
    this.sound.tierUp(1);
  }

  private rainSpark(x: number, y: number, rarity: BladeRarity): void {
    const ev = this.room?.state?.mapEvent;
    if (!ev || ev.kind !== MapEventKind.Rain || this.serverNow() < ev.startsAt - 200) return;
    if (Math.hypot(x - ev.x, y - ev.y) > ev.radius + 0.5) return;
    this.particles.spawnSparks(x, 2.5, y, this.theme.palette.rarityColor[rarity], 6, 3);
  }

  // Partie suivante : le serveur a remis tout le monde en jeu, avec les
  // lames de départ ; comme une réapparition, sans la demander.
  private onMatchStart(): void {
    this.match.hidePodium();
    this.death.hide();
    this.endKillCam();
    this.setSpectating(false);
    this.dead = false;
    this.bestSubmitted = false;
    this.resetPrediction();
  }

  private respawn(): void {
    this.death.hide();
    this.endKillCam();
    this.dead = false;
    this.bestSubmitted = false;
    this.resetPrediction();
    this.onboarding.enterGame(performance.now());
    this.room?.send("respawn", { name: this.myName });
  }

  // Dernière équipe en vie : pas de réapparition pendant la manche. La
  // carte de fin de vie s'efface, on regarde la suite.
  private spectate(): void {
    this.death.hide();
    this.endKillCam();
    this.setSpectating(true);
  }

  private setSpectating(on: boolean): void {
    if (this.spectating === on) return;
    this.spectating = on;
    document.getElementById("hud")?.classList.toggle("spectating", on);
    const banner = document.getElementById("spectate-banner");
    banner?.classList.toggle("hidden", !on);
    if (on && banner) {
      // Éliminé, ou arrivé en cours de manche.
      const text = banner.querySelector(".sb-text") as HTMLElement;
      const key: I18nKey = this.dead ? "match.spectating" : "match.spectatingLate";
      text.dataset.i18n = key;
      text.textContent = t(key);
    }
  }

  private async returnToMenu(): Promise<void> {
    // Quitter en vie termine la vie : son score compte pour le record.
    const meAlive = this.room?.state?.players?.get(this.myId);
    if (meAlive?.alive && !this.dead) this.submitLife(meAlive);
    this.death.hide();
    this.endKillCam();
    this.match.reset();
    this.setSpectating(false);
    this.restartAt = 0;
    document.getElementById("restart-banner")?.classList.add("hidden");
    this.borderWarning.hide();
    this.hud.hide();
    this.hud.setRoomCode("");
    this.hud.clearEffects();
    this.chat.hide();
    this.nametags.clear();
    this.combatFeedback.clear();
    this.killFeed.clear();
    this.onboarding.leaveGame();
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
    this.resetPrediction();
    this.clearPlayerViews();
    // clear() au lieu de recréer : voir attemptReconnect pour le pourquoi
    // (sans ça, lames fantômes héritées de la session précédente).
    this.blades.clear();
    this.crates.clear();
    this.powerups.clear();
    this.flagsView.clear();
    this.flagHud.hide();
    this.lastEventKind = MapEventKind.None;
    this.mapEventSnap.kind = MapEventKind.None;
    this.mapEventView.update(this.mapEventSnap, 0, 0);
    this.dead = false;
    // Bloque ici jusqu'à confirmation de fermeture (timeout 1.5s pour ne
    // pas geler indéfiniment si la connexion est cassée). Le login n'est
    // affiché qu'APRÈS, garantissant que tout clic suivant sur Enter
    // démarre sur une ardoise propre.
    await this.conn.leave();
    if (isReloadPending()) {
      // Preset abaissé, qualité ou thème changés pendant la partie : on les
      // construit maintenant que le joueur n'a plus rien en cours.
      window.location.reload();
      return;
    }
    this.login.show();
    void this.profile.refreshBadge();
    void this.sound.playLobbyMusic();
  }

  private sendInput(): void {
    if (!this.room || this.matchOver()) return;
    const { dx, dy, boost, throwPressed, aimX, aimY } = this.input.getInput();
    if (throwPressed) this.throwLatched = true;
    this.inputSeq = (this.inputSeq + 1) >>> 0;
    const payload: InputMessage = { dx, dy, boost, seq: this.inputSeq };
    if (this.throwLatched) {
      payload.throw = true;
      // Le serveur ne lit la visée qu'avec le lancer.
      if (aimX !== 0 || aimY !== 0) {
        payload.aimX = aimX;
        payload.aimY = aimY;
      }
      this.throwLatched = false;
      // Seulement pour un lancer que le serveur acceptera : marteler Espace
      // pendant le cooldown ne doit pas le prolonger à l'écran.
      const me = this.room.state?.players?.get(this.myId);
      const now = this.serverNow();
      if (me?.alive && this.throwReady(me, now)) this.predictedThrowReadyAt = now + THROW_COOLDOWN_MS;
    }
    this.room.send("input", payload);
    // Un pas de prédiction par input envoyé (le serveur en appliquera un).
    this.predictor.push(this.inputSeq, { dx, dy, boost });
    this.sound.setBoost(!!boost && (dx !== 0 || dy !== 0));
    this.localBoosting = !!boost && (dx !== 0 || dy !== 0) && (this.room.state?.players?.get(this.myId)?.bladeCount ?? 0) > 0;
  }

  private resetPrediction(): void {
    this.predictor.reset();
    this.errX = 0;
    this.errY = 0;
    this.needReconcile = false;
  }

  // Rendu du joueur local : interpolation entre les deux dernières
  // positions prédites (l'horloge d'inputs avance par pas fixes), plus la
  // correction en cours d'absorption.
  private updateLocalPrediction(dt: number, view: PlayerView): void {
    if (!this.predictor.ready) { view.setLocalRender(view.targetX, view.targetY); return; }
    const alpha = Math.max(0, Math.min(1, this.inputAccumMs / (SERVER_DT * 1000)));
    const b = this.predictor.body;
    const rx = this.predictor.prevX + (b.x - this.predictor.prevX) * alpha;
    const ry = this.predictor.prevY + (b.y - this.predictor.prevY) * alpha;
    const decay = Math.exp(-dt / this.ERR_DECAY_TAU);
    this.errX *= decay; this.errY *= decay;
    if (Math.abs(this.errX) < 0.001) this.errX = 0;
    if (Math.abs(this.errY) < 0.001) this.errY = 0;
    view.setLocalRender(rx + this.errX, ry + this.errY);
  }

  // Position acquittée par le serveur : l'InputPredictor rejoue les inputs
  // qu'il n'a pas encore appliqués. La correction (nulle sans évènement
  // serveur imprévu : recul d'un clash, poussée d'un joueur) est absorbée
  // par le rendu au lieu de faire sauter le personnage.
  private reconcileLocal(): void {
    const state = this.room?.state;
    const me = state?.players?.get(this.myId);
    if (!me) return;
    if (!me.alive || this.dead || this.matchOver()) { this.resetPrediction(); return; }
    const ack: AckState = {
      seq: me.lastSeq,
      x: me.x,
      y: me.y,
      knockbackVx: me.knockbackVx ?? 0,
      knockbackVy: me.knockbackVy ?? 0,
      serverTime: state.serverTime,
      speedUntil: me.speedUntil,
      hitlagUntil: me.hitlagUntil,
      bladeCount: me.bladeCount,
    };
    const wasReady = this.predictor.ready;
    const c = this.predictor.reconcile(ack);
    if (!wasReady) return;
    const d = Math.hypot(c.dx, c.dy);
    // Téléportation (respawn, reconnexion) : pas de lissage.
    if (d > 15) { this.errX = 0; this.errY = 0; return; }
    this.errX -= c.dx;
    this.errY -= c.dy;
    if (this.debugHitboxes) {
      this.corrections.push(d);
      if (this.corrections.length > 3000) this.corrections.shift();
    }
  }

  // Indicateur de visée : trajectoire du prochain lancer quand il est
  // disponible (lames, cooldown écoulé à l'heure du serveur). Visée libre
  // (curseur, glisser sur THROW) marquée ; direction de marche (clavier
  // seul, tap mobile) discrète. Un glisser en cours reste visible, atténué,
  // pendant le cooldown : le doigt voit où il vise.
  private updateAimIndicator(localView: PlayerView | undefined, dt: number, serverNowMs: number): void {
    const me = this.room?.state?.players?.get(this.myId);
    const alive = !!me && !!localView && !this.dead && (this.renderAlive.get(this.myId) ?? !!me.alive);
    const ready = alive && this.throwReady(me, serverNowMs);
    let opacity = 0;
    const aim = alive ? this.input.aim() : null;
    if (aim) {
      this.aimDirX = aim.x;
      this.aimDirY = aim.y;
      opacity = ready ? 0.6 : this.input.dragAiming ? 0.22 : 0;
    } else if (ready) {
      // Lancer sans visée : direction de marche en cours, sinon la dernière
      // retenue par le serveur (p.dirX/dirY), comme processThrows.
      const move = this.input.peekDirBoost();
      const moving = Math.hypot(move.dx, move.dy) > 0.05;
      const fx = moving ? move.dx : me.dirX;
      const fy = moving ? move.dy : me.dirY;
      const m = Math.hypot(fx, fy);
      if (m > 1e-3) {
        this.aimDirX = fx / m;
        this.aimDirY = fy / m;
        opacity = 0.25;
      }
    }
    this.aimIndicator.update(
      dt,
      this.elapsed * 0.001,
      localView?.renderX ?? 0,
      localView?.renderY ?? 0,
      this.aimDirX,
      this.aimDirY,
      me?.bladeCount ?? 0,
      opacity,
    );
    // Bouton THROW mobile grisé tant que le lancer n'est pas disponible.
    const cooldown = alive && !ready;
    if (this.throwBtn && cooldown !== this.throwBtnCooldown) {
      this.throwBtnCooldown = cooldown;
      this.throwBtn.classList.toggle("cooldown", cooldown);
    }
  }

  // Lancer disponible pour le joueur local : des lames et le cooldown écoulé
  // à l'heure du serveur, celui prédit au dernier envoi compris.
  private throwReady(me: any, serverNowMs: number): boolean {
    return me.bladeCount > 0 && Math.max(me.throwCooldownUntil, this.predictedThrowReadyAt) <= serverNowMs;
  }

  // Compte à rebours du redémarrage annoncé (tâche T.3).
  private updateRestartBanner(now: number): void {
    this.nextRestartBannerAt = now + 250;
    const el = document.getElementById("restart-banner");
    if (!el) return;
    if (this.restartWaiting) {
      el.textContent = t("net.updating");
      el.classList.remove("hidden");
      return;
    }
    if (!this.restartAt || !this.room) {
      el.classList.add("hidden");
      return;
    }
    const left = Math.max(0, Math.ceil((this.restartAt - this.serverNow()) / 1000));
    el.textContent = t("net.restartIn", { s: left });
    el.classList.remove("hidden");
  }

  // Partie fermée au bout du compte à rebours (tâche T.3). La nouvelle
  // version met quelques secondes à démarrer : on attend qu'elle accepte des
  // joueurs (/healthz, 503 pendant le préavis) avant de revenir au menu.
  // Sinon, rejoindre tout de suite échoue, et le rechargement éventuel du
  // retour au menu (preset abaissé en partie) tombe sur la page d'erreur du
  // navigateur.
  private async backToMenuAfterRestart(room: unknown): Promise<void> {
    this.restartWaiting = true;
    this.nextRestartBannerAt = 0;
    const until = performance.now() + 90_000;
    while (performance.now() < until && this.room === room) {
      try {
        const r = await fetch(`/healthz?t=${Date.now()}`, { cache: "no-store" });
        if (r.ok) break;
      } catch { /* ancienne version arrêtée, nouvelle pas encore lancée */ }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    this.restartWaiting = false;
    if (this.room !== room) return;
    void showAlert(t("net.updated"));
    void this.returnToMenu();
  }

  // Zone d'intérêt (tâche 2.4) : le serveur ne nous envoie que ce qui est
  // à moins de ce rayon. On lui annonce l'étendue de sol réellement visible
  // (format d'écran, recul selon l'orbite), à 4 u près.
  private announceView(now: number): void {
    this.nextViewCheckAt = now + 500;
    const blades = this.room?.state?.players?.get(this.myId)?.bladeCount ?? 0;
    const r = Math.min(viewRadiusLimit(blades), Math.ceil(this.camera.visibleExtent()));
    if (Math.abs(r - this.sentViewRadius) < 4) return;
    this.sentViewRadius = r;
    this.room?.send("view", { r });
  }

  // Ping toutes les 2 s ; une réponse perdue est oubliée au bout de 10 s.
  private sendPing(now: number): void {
    this.nextPingAt = now + 2000;
    for (const [n, at] of this.pingSentAt) if (now - at > 10000) this.pingSentAt.delete(n);
    const n = ++this.pingSeq;
    this.pingSentAt.set(n, now);
    this.room?.send("ping", n);
  }

  // Indications de première partie (tâche 3.1) : chacune quand la
  // situation se présente, une seule fois (Onboarding les mémorise).
  private checkOnboardingHints(serverNowMs: number): void {
    const state = this.room?.state;
    const me = state?.players?.get(this.myId);
    const view = this.players.get(this.myId);
    if (!me?.alive || this.dead || !view) return;
    if (isInBush(view.renderX, view.renderY)) this.onboarding.hint("bush");
    if (this.borderIntensity > 0.2) this.onboarding.hint("border");
    const move = this.input.peekDirBoost();
    if (me.bladeCount >= 6 && Math.hypot(move.dx, move.dy) > 0.05) this.onboarding.hint("boost");
    if (me.bladeCount >= 2 && this.throwReady(me, serverNowMs)) {
      // Un ennemi visible à portée utile de lancer.
      let inRange = false;
      state.players.forEach((p: any, id: string) => {
        if (inRange || id === this.myId || !p.alive) return;
        const d = Math.hypot(p.x - view.renderX, p.y - view.renderY);
        if (d > 8 && d < THROW_PROJECTILE_MAX_RANGE - 2) inRange = true;
      });
      if (inRange) this.onboarding.hint("throw");
    }
  }

  // Buisson du joueur local (tâche 4.7) : son dôme devient transparent ;
  // rafale de pixels et salves de statique à l'entrée et à la sortie.
  private updateLocalBush(localView: PlayerView | undefined): void {
    const me = this.room?.state?.players?.get(this.myId);
    const alive = !!localView && !!me?.alive && !this.dead;
    const bush = alive ? bushAt(localView!.renderX, localView!.renderY) : -1;
    if (bush === this.localBush) return;
    if (alive) {
      this.particles.spawnSparks(localView!.renderX, 1.2, localView!.renderY, this.decor.bushBurstColor, 14, 3);
      this.sound.bushGlitch(bush >= 0);
    }
    this.localBush = bush;
    this.decor.setInsideBush(bush);
  }

  // Alerte d'approche de la bordure : vignette et bip, selon l'écart entre
  // l'orbite extérieure (les lames meurent avant le corps) et la zone
  // mortelle. Position rendue du joueur local : celle qu'il voit à l'écran.
  private updateBorderWarning(localView: PlayerView | undefined, dt: number): void {
    const t = this.elapsed * 0.001;
    const me = this.room?.state?.players?.get(this.myId);
    if (!localView || !me || !me.alive || this.matchOver()) {
      this.borderIntensity = 0;
      this.borderWarning.update(0, 0, 0, t, dt);
      return;
    }
    const x = localView.renderX;
    const y = localView.renderY;
    const r = Math.hypot(x, y);
    const gap = this.arenaRadius() - WALL_KILL_THICKNESS - r - outerOrbitRadius(me.bladeCount);
    const intensity = Math.max(0, Math.min(1, 1 - gap / BORDER_WARNING_DISTANCE));
    this.borderIntensity = intensity;
    let dirX = 0;
    let dirY = 0;
    if (intensity > 0 && r > 1e-3) {
      // Direction écran du mur : projection du joueur et d'un point situé
      // 10 u plus loin vers l'extérieur (indépendant de l'angle caméra).
      const cam = this.sceneStack.camera;
      this.tmpNdcA.set(x, 0, y).project(cam);
      this.tmpNdcB.set(x + (x / r) * 10, 0, y + (y / r) * 10).project(cam);
      const sx = (this.tmpNdcB.x - this.tmpNdcA.x) * window.innerWidth;
      const sy = -(this.tmpNdcB.y - this.tmpNdcA.y) * window.innerHeight;
      const len = Math.hypot(sx, sy);
      if (len > 1e-6) {
        dirX = sx / len;
        dirY = sy / len;
      }
    }
    this.borderWarning.update(intensity, dirX, dirY, t, dt);
    const now = performance.now();
    if (intensity > 0 && now >= this.nextBorderBeepAt) {
      this.sound.borderWarning(intensity);
      // Un bip toutes les 0,9 s au seuil, toutes les 0,25 s au contact.
      this.nextBorderBeepAt = now + 900 - 650 * intensity;
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
    this.hud.setBoost(!!me.boost, me.bladeCount);
    this.hud.setScore(me.score, this.room.state.isPrivate ? null : getBest());
    // Effets actifs : on relit les *Until du joueur local et on met à jour
    // les badges HUD avec leur temps restant. Durée base conservée dans
    // effectDurations pour normaliser la barre.
    const dnow = this.serverNow();
    const updateFx = (key: I18nKey, color: number, until: number) => {
      if (until <= dnow) {
        this.hud.updateEffect(key, "", "#" + color.toString(16).padStart(6, "0"), 0, 1, dnow);
        this.effectDurations.delete(key);
      } else {
        let dur = this.effectDurations.get(key);
        if (dur === undefined) {
          dur = until - dnow;
          this.effectDurations.set(key, dur);
        }
        this.hud.updateEffect(
          key,
          t(key),
          "#" + color.toString(16).padStart(6, "0"),
          until,
          dur,
          dnow,
        );
      }
    };
    updateFx("hud.fxSpeed", this.theme.palette.powerUpColor[PowerUpType.Speed], me.speedUntil ?? 0);
    updateFx("hud.fxSpin", this.theme.palette.powerUpColor[PowerUpType.Spin], me.spinUntil ?? 0);
    updateFx("hud.fxMagnet", this.theme.palette.powerUpColor[PowerUpType.Magnet], me.magnetUntil ?? 0);
    updateFx("hud.fxShield", this.theme.palette.powerUpColor[PowerUpType.Shield], me.shieldUntil ?? 0);
    // Zone dorée (tâche 4.4) : points ×2 tant qu'on y est.
    const ev = this.mapEventSnap;
    const inGolden = ev.kind === MapEventKind.Golden && me.alive && dnow >= ev.startsAt && dnow < ev.endsAt &&
      Math.hypot(me.x - ev.x, me.y - ev.y) <= ev.radius;
    updateFx("hud.fxGolden", this.theme.palette.rarityColor[BladeRarity.Legendary], inGolden ? ev.endsAt : 0);

    const now = performance.now();
    if (now - this.lastHudUpdate < 100) return;
    this.lastHudUpdate = now;
    const entries = this.boardEntries();
    const sorted = [...entries].sort((a, b) => b.score - a.score);
    // Couronne : le leader désigné par le serveur (meilleur score vivant),
    // avec sa prime ; à défaut de résumé, le premier du classement.
    const leader = this.summary?.leader;
    this.topPlayerId = leader ? this.summary!.board[leader[0]]?.[0] ?? null : sorted.length > 0 ? sorted[0].id : null;
    this.leaderBounty = leader ? leader[1] : 0;
    this.leaderboard.update(entries, this.myId, this.topPlayerId, now);
    // Rank badge live
    const myRankIdx = sorted.findIndex((e) => e.id === this.myId);
    this.hud.setRank(myRankIdx >= 0 ? myRankIdx + 1 : entries.length);
    // Minimap : joueurs et légendaires du résumé de la room (le serveur
    // n'envoie plus les entités lointaines ; les joueurs cachés dans un
    // buisson n'y figurent pas).
    const others: MinimapPlayer[] = [];
    const legendaries: Array<{ x: number; y: number; legendary: boolean }> = [];
    const summary = this.summary;
    const mine = this.myTeam();
    if (summary) {
      for (const [i, x, y] of summary.map) {
        const row = summary.board[i];
        const id = row?.[0];
        if (!id || id === this.myId) continue;
        const side = mine === TEAM_NONE ? undefined : sameTeam(mine, row[5] ?? TEAM_NONE) ? "ally" : "foe";
        others.push({ id, x, y, isMe: false, side });
      }
      for (const [x, y] of summary.legendaries) legendaries.push({ x, y, legendary: true });
    }
    others.sort((a, b) => {
      const da = (a.x - me.x) ** 2 + (a.y - me.y) ** 2;
      const db = (b.x - me.x) ** 2 + (b.y - me.y) ** 2;
      return da - db;
    });
    const flags: MinimapFlag[] = [];
    if (mine !== TEAM_NONE) {
      for (const f of this.flagStates) {
        const base = teamBase(f.team);
        flags.push({ x: f.x, y: f.y, baseX: base.x, baseY: base.y, ally: f.team === mine, atBase: f.atBase });
      }
    }
    const events: MinimapEvent[] = [];
    const mev = this.mapEventSnap;
    if (mev.kind !== MapEventKind.None) {
      events.push({ kind: mev.kind, x: mev.x, y: mev.y, radius: mev.radius, active: this.serverNow() >= mev.startsAt });
    }
    this.minimap.draw({ id: this.myId, x: me.x, y: me.y, isMe: true }, others.slice(0, 10), legendaries, this.arenaRadius(), flags, events, this.shownArenaTarget);
  }

  // Pilote la résolution dynamique et le downgrade auto de preset.
  //
  // Logique :
  //  - Si fps < 50 pendant 2 s, on baisse le resScale de 0.1 (jusqu'au
  //    minimum du preset).
  //  - Si fps > 58 ET resScale < 1.0 pendant 5 s, on remonte de 0.05.
  //  - Si fps < 35 pendant 4 s ET resScale est déjà au minimum ET
  //    autoDowngrade est activé, on bascule au preset inférieur. Hors
  //    partie : reload immédiat (materials/shaders construits au boot).
  //    En partie : post-FX coupés à chaud et reload différé au retour
  //    menu — le reload immédiat éjectait le joueur de son match.
  //
  // Appelé une fois par fenêtre de mesure FPS (~0.5 s).
  private adaptiveQuality(_dt: number): void {
    if (!this.quality.dynamicResolution) return;
    // Boutique ouverte (lobby) : son aperçu 3D fausse la mesure, et un
    // reload la fermerait en plein achat. La mesure repart de zéro après.
    if (isBoutiqueOpen()) {
      this.lowFpsAccum = 0;
      this.highFpsAccum = 0;
      return;
    }
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
        !isReloadPending() &&
        fps < 35 &&
        Date.now() - this.lastDowngradeAt > 30000
      ) {
        // Resolution déjà au minimum mais ça rame encore : downgrade preset.
        const lower = nextLowerPreset(this.quality.preset);
        if (lower) {
          console.log(`[blade.io] auto-downgrade preset: ${this.quality.preset} → ${lower} (fps=${fps.toFixed(0)})`);
          savePresetChoice(lower);
          this.lastDowngradeAt = Date.now();
          if (this.room) {
            // En partie : le bloom et les passes plein écran sont le plus
            // gros poste GPU et se coupent sans reconstruire la scène.
            this.postFx.setEnabled(false);
            reloadAtMenu();
          } else {
            // Hors partie : les matériaux/shaders sont construits au boot
            // selon le preset, seul un reload les reconstruit.
            window.location.reload();
          }
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
      const frameSec = (now - last) / 1000;
      const dt = Math.min(0.1, frameSec);
      last = now;
      this.elapsed += dt * 1000;
      // FPS mesuré sur le temps réel : avec le dt plafonné à 0,1 s, une
      // machine à 2 FPS s'affichait à 10 FPS et l'adaptation de qualité
      // réagissait avec plusieurs fois le retard voulu.
      this.fpsAccum += frameSec;
      this.fpsFrames++;
      if (this.fpsAccum >= 0.5) {
        this.fps = this.fpsFrames / this.fpsAccum;
        this.fpsAccum = 0; this.fpsFrames = 0;
        this.hud.setNet(this.fps, this.room ? this.pingMs : null);
        this.adaptiveQuality(dt);
      }
      // Horloge d'inputs fixe : un input par SERVER_DT de temps réel, quel
      // que soit le framerate (le serveur applique un pas par input). Au plus
      // 5 par frame ; au-delà (onglet en arrière-plan), le retard est
      // abandonné plutôt que rattrapé d'un bloc. Rien pendant l'attente de
      // la nouvelle version (room fermée) : le joueur se déplacerait seul,
      // en prédiction, dans une partie figée.
      if (this.room && !this.restartWaiting) {
        const stepMs = SERVER_DT * 1000;
        this.inputAccumMs += frameSec * 1000;
        for (let i = 0; i < 5 && this.inputAccumMs >= stepMs; i++) {
          this.inputAccumMs -= stepMs;
          this.sendInput();
        }
        if (this.inputAccumMs >= stepMs) this.inputAccumMs = 0;
      }
      if (this.needReconcile) {
        this.needReconcile = false;
        this.reconcileLocal();
      }
      // Tick de rendu de la frame, puis ce qui l'attendait sur la ligne de
      // temps, avant de placer joueurs et lames.
      this.renderTick = this.serverClock.isReady
        ? this.serverClock.tickAt(now - RENDER_DELAY)
        : (this.room?.state?.tick ?? 0);
      this.flushTimeline();
      const localView = this.players.get(this.myId);
      // Heure du serveur : présente pour le joueur local (prédit), au tick
      // de rendu pour les autres (affichés 80 ms dans le passé).
      const serverNowMs = this.serverNow();
      const serverRenderMs = this.serverClock.isEpochReady ? this.serverClock.epochAt(now - RENDER_DELAY) : serverNowMs;
      const myTeam = this.myTeam();
      for (const [id, v] of this.players) {
        if (id === this.myId && !this.spectating) this.updateLocalPrediction(dt, v);
        else v.interpolate(now, RENDER_DELAY);
        // Spawn protection visuel : halo cyan pulsé tant que
        // spawnProtectionUntil est dans le futur. Lu directement du state
        // serveur ; la dérive d'horloge sur ~2.5s reste imperceptible.
        const ps = this.playerState(id);
        v.setProtected(!!ps && ps.spawnProtectionUntil > (id === this.myId ? serverNowMs : serverRenderMs));
        // Modes équipe : alliés à la couleur de son propre anneau.
        const ally = id !== this.myId && sameTeam(myTeam, ps?.team ?? TEAM_NONE);
        if (id !== this.myId) v.setAlly(ally);
        v.animate(dt);
        v.updateTrail(dt);
        const dissolving = v.updateDissolve(dt);
        // Buissons : le serveur ne nous envoie un joueur caché qu'à portée
        // de contact des orbites (tâche 2.4) ; reçu, il est affiché.
        const isLocal = id === this.myId;
        const shouldBeVisible = this.renderAlive.get(id) ?? !!ps?.alive;
        // Mort : le corps reste le temps de se dissoudre (tâche 4.9).
        const shown = shouldBeVisible || dissolving;
        if (v.root.visible !== shown) v.root.visible = shown;
        if (v.trail.visible !== (shouldBeVisible && isLocal)) v.trail.visible = shouldBeVisible && isLocal;
        // Lignes de vitesse (tâche 4.9) : le joueur local d'après son
        // dernier input, sans attendre le serveur ; les autres d'après l'état.
        const boosting = isLocal ? this.localBoosting && !this.dead : !!ps?.boost;
        if (boosting && shouldBeVisible && !dissolving && v.moveSpeed > 4) {
          const palette = this.theme.palette;
          const color = isLocal || ally ? palette.playerLocal.accent : palette.playerRemote.accent;
          this.combatFx.speedLines.track(id, v.renderX, v.renderY, v.moveX, v.moveZ, v.moveSpeed, color, isLocal, dt);
        }
      }
      for (let i = this.corpses.length - 1; i >= 0; i--) {
        const c = this.corpses[i];
        if (c.updateDissolve(dt)) continue;
        this.disposePlayerView(c);
        this.corpses.splice(i, 1);
      }
      this.blades.update(now, RENDER_DELAY, this.elapsed * 0.001, this.playerPositions);
      if (this.debugHitboxes) {
        // Étincelle vs milieu des deux lames là où elles sont dessinées à
        // cette frame.
        for (const c of this.clashChecks) {
          const d = this.clashDistance(c);
          if (d !== null) this.debugHitboxes.recordClash(d);
        }
        for (const c of this.clashChecksImmediate) {
          const d = this.clashDistance(c);
          if (d !== null) this.debugHitboxes.recordImmediateClash(d);
        }
        this.clashChecks.length = 0;
        this.clashChecksImmediate.length = 0;
      }
      this.debugHitboxes?.update(this.renderTick, this.myId, (ownerId, ring, slot, inRing, tick) => {
        const owner = this.room?.state?.players?.get(ownerId);
        if (!owner) return null;
        return orbitSlotAngle(ring, slot, inRing, this.orbitThetaFor(ownerId, tick), owner.spinPhase ?? 0);
      });
      this.crates.update(dt, this.elapsed * 0.001);
      this.powerups.update(dt, this.elapsed * 0.001);
      // Après les lames, qui alimentent les traînées.
      this.combatFx.update(dt, now, this.renderPosOf);
      this.particles.update(dt);
      if (this.killCam) {
        this.updateKillCam(now, dt);
      } else {
        if (localView) this.camera.setTarget(localView.renderX, localView.renderY);
        // Recul selon l'orbite du joueur local (vivant et en partie).
        const meCam = this.room?.state?.players?.get(this.myId);
        this.camera.setOrbitRadius(meCam?.alive && !this.dead ? outerOrbitRadius(meCam.bladeCount) : 0);
      }
      this.camera.update(dt);
      this.ground.update(this.elapsed * 0.001);
      this.wall.update(this.elapsed * 0.001);
      this.wall.setRadius(this.arenaRadius());
      this.ground.setRadius(this.arenaRadius());
      this.updateArenaShrink(serverNowMs);
      this.updateMatchUi(serverNowMs);
      this.updateFlags(myTeam, dt, serverNowMs);
      this.updateMapEvent(serverNowMs);
      this.updateBorderWarning(localView, dt);
      this.updateAimIndicator(localView, dt, serverNowMs);
      this.combatFeedback.update(now, (x, y) => this.camera.screenOf(x, y));
      this.killFeed.update(now);
      if (this.room && !this.restartWaiting && now >= this.nextPingAt) this.sendPing(now);
      if (this.room && now >= this.nextViewCheckAt) this.announceView(now);
      if (now >= this.nextRestartBannerAt) this.updateRestartBanner(now);
      if (now >= this.nextHintCheckAt) {
        this.nextHintCheckAt = now + 250;
        this.checkOnboardingHints(serverNowMs);
      }
      this.onboarding.update(now);
      this.decor.update(this.elapsed * 0.001);
      this.updateLocalBush(localView);
      // Wisps ambient : centrés sur le joueur local pour qu'on en voie
      // toujours autour de soi. Au lobby (pas de localView) on les laisse
      // tourner autour de l'origine.
      const wispCx = localView ? localView.renderX : 0;
      const wispCz = localView ? localView.renderY : 0;
      this.wisps.update(wispCx, wispCz, dt, this.elapsed * 0.001);
      // Nametags : update juste avant le render pour que les positions
      // projettées correspondent à la frame qu'on affiche. No-op si le
      // toggle Settings est off.
      this.nametags.update(
        this.players,
        this.myId,
        (id) => (this.renderAlive.get(id) ?? !!this.playerState(id)?.alive) && !this.players.get(id)?.dissolving,
        (id) => this.playerState(id)?.name ?? "?",
        (id) => this.playerState(id)?.bladeCount ?? 0,
        (id) => this.playerState(id)?.level ?? 0,
        (id) => sameTeam(myTeam, this.playerState(id)?.team ?? TEAM_NONE),
        this.sceneStack.camera,
        window.innerWidth,
        window.innerHeight,
      );
      this.updateHud();
      this.updateToast(performance.now());
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
          // Ancrée comme le nametag, puis décalée au-dessus par le CSS : à
          // une hauteur monde fixe, la couronne et sa prime chevauchaient le
          // nametag dès que la caméra reculait.
          const vec = this.crownVec.set(topView.renderX, NAMETAG_ANCHOR_Y, topView.renderY);
          vec.project(this.sceneStack.camera);
          // Devant la caméra et dans l'écran : le leader peut être synchronisé
          // (zone d'intérêt) sans être visible, la couronne restait alors
          // affichée hors de l'écran.
          if (vec.z < 1 && Math.abs(vec.x) <= 1 && Math.abs(vec.y) <= 1) {
            const x = (vec.x * 0.5 + 0.5) * window.innerWidth;
            const y = (-(vec.y * 0.5) + 0.5) * window.innerHeight;
            crownEl.style.left = `${x}px`;
            crownEl.style.top = `${y}px`;
            showCrown = true;
          }
        }
      }
      if (showCrown) crownEl.classList.remove("hidden");
      else crownEl.classList.add("hidden");
      if (this.leaderBounty !== this.shownBounty) {
        this.shownBounty = this.leaderBounty;
        const bountyEl = document.getElementById("crown-bounty");
        if (bountyEl) bountyEl.textContent = this.leaderBounty > 0 ? `+${this.leaderBounty} 🏆` : "";
      }

      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

// Applique les variables CSS du thème actif AVANT d'instancier le jeu :
// les UIs créés ensuite (LoginScreen, Hud, etc.) prennent les bonnes
// couleurs dès leur premier render. De même pour la langue du texte fixe.
applyThemeCss();
applyI18n();
// Boutique instanciée tôt pour brancher le bouton "BOUTIQUE" du login
// screen + écouter Échap. Reste cachée tant que l'user ne l'ouvre pas.
new Boutique();
new Game();

// Badge d'effet d'un power-up (aucun pour Blades, instantané) : la clé de
// son libellé sert aussi d'identifiant du badge.
// Bannière de chaque évènement de carte.
const MAP_EVENT_TOASTS: Partial<Record<number, I18nKey>> = {
  [MapEventKind.Rain]: "event.rain",
  [MapEventKind.Crate]: "event.crate",
  [MapEventKind.Golden]: "event.golden",
};

// Libellé du score des équipes dans la minuterie, par mode.
const TEAM_SCORE_LABELS: Partial<Record<string, I18nKey>> = {
  tdm: "match.score.tdm",
  lts: "match.score.lts",
  ctf: "match.score.ctf",
};

function powerUpEffectKey(t: PowerUpType): I18nKey | null {
  switch (t) {
    case PowerUpType.Speed: return "hud.fxSpeed";
    case PowerUpType.Spin: return "hud.fxSpin";
    case PowerUpType.Magnet: return "hud.fxMagnet";
    case PowerUpType.Shield: return "hud.fxShield";
    case PowerUpType.Blades: return null;
  }
}
