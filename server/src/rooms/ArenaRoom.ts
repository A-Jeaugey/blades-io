import { Room, Client, ServerError } from "@colyseus/core";
import { Encoder } from "@colyseus/schema";
import {
  BladeRarity,
  BOT_MAX_TOTAL,
  BOT_MIN_PLAYERS,
  BOT_NAMES,
  BOT_THINK_INTERVAL,
  BladeDestroyedEvent,
  ClashEvent,
  CrateDestroyedEvent,
  KillCause,
  PlayerKilledEvent,
  DEATH_DROP_MAX_DIST,
  DEATH_DROP_MIN_DIST,
  DEATH_DROP_RATIO,
  DEATH_DROP_SPEED_MIN,
  DEATH_DROP_SPEED_MAX,
  LEADER_DROP_RATIO,
  SCORE_UNDERDOG,
  bountyFor,
  isUnderdogKill,
  RECENT_LOSS_BUFFER_CAP,
  RECENT_LOSS_DROP_RATIO,
  RECENT_LOSS_WINDOW_MS,
  SPAWN_GRACE_MS,
  SPAWN_GRACE_RAMP_MS,
  SPAWN_PROTECTION_MS,
  SUMMARY_INTERVAL_MS,
  RoomSummary,
  ViewMessage,
  isInBush,
  GROUND_BLADE_TTL_MS,
  INITIAL_BLADE_COUNT,
  MAP_RADIUS,
  MAX_INPUT_QUEUE,
  MAX_INPUT_RATE,
  MAX_INPUT_VIOLATIONS,
  CLOSE_CODE_INPUT_FLOOD,
  MAX_PLAYERS_PER_ROOM,
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
  RARITY_HP,
  SERVER_DT,
  SERVER_TICKRATE,
  TierUpEvent,
  InputMessage,
  SetNameMessage,
  RespawnMessage,
  ChatMessage,
  ChatEvent,
  CHAT_MESSAGE_MAX_LENGTH,
  CHAT_RATE_LIMIT_COUNT,
  CHAT_RATE_LIMIT_WINDOW_MS,
  CHAT_AUTO_MUTE_MS,
  CHAT_RECENT_KEPT,
  CHAT_STRIKES_TO_MUTE,
  CHAT_STRIKE_WINDOW_MS,
  ChatMutedEvent,
  REPORT_LIMIT_COUNT,
  REPORT_LIMIT_WINDOW_MS,
  REPORT_REASON_MAX_LENGTH,
  ReportAck,
  ReportMessage,
  censorChat,
  nameProblem,
  validateLoadout,
  tierBladeHitbox,
  tierFromBladeCount,
} from "@bladeio/shared";
import { ArenaState } from "../state/ArenaState";
import { Player } from "../state/Player";
import { Blade } from "../state/Blade";
import { updateMovement } from "../systems/movement";
import {
  OrbitPositionCache,
  updateBladePositions,
  recompactOwnerRing,
} from "../systems/orbitPositions";
import { resolveCollisions } from "../systems/collisions";
import { applyWallDamage } from "../systems/wallDamage";
import { PickupSystem, attachBladeToPlayer } from "../systems/pickup";
import { SpawnSystem, pickRarity } from "../systems/spawning";
import { pickSpawnPoint, randomSpawnPoint } from "../systems/spawnPoint";
import { EventScope, InterestManager } from "../systems/interest";
import { RestartAware, registerRoom, restartDeadline, trackWrite, unregisterRoom } from "../shutdown";
import { LifeEnd, recordLife } from "../telemetry";
import { BotController } from "../systems/bots";
import { CrateSystem } from "../systems/crates";
import { PowerUpSystem } from "../systems/powerups";
import { updateScore } from "../systems/scoring";
import {
  processThrows,
  resolveProjectileCollisions,
  updateProjectiles,
} from "../systems/throws";
import { BladeThrownEvent, ChallengeDoneEvent, ProjectileImpactEvent, levelForXp } from "@bladeio/shared";
import { ChallengeOwner, advanceChallenges } from "../challenges";
import { Crate } from "../state/Crate";
import { PowerUp } from "../state/PowerUp";
import { randomId } from "../utils/ids";
import { verifyAccessToken } from "../auth/supabase";
import { recordMatch } from "../auth/matches";
import { creditGuestWallet, creditWallet, getGuestWalletBalance, getInventory, getWallet } from "../auth/wallet";
import { verifyGuestToken } from "../auth/guestToken";
import { logReport } from "../moderation";

// Pseudo affiché en jeu. NFKC d'abord (lettres pleine chasse, ligatures
// ramenées à leur forme simple), puis le filtre de modération (tâche 5.6) :
// insulte, nom réservé ou mélange d'écritures donnent un pseudo anonyme.
function sanitizeName(raw: string): string {
  const cleaned = (raw ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}_\-\.]/gu, "")
    .trim()
    .slice(0, NAME_MAX_LENGTH);
  if (cleaned.length < NAME_MIN_LENGTH || nameProblem(cleaned) !== null) return "Anon" + Math.floor(Math.random() * 1000);
  return cleaned;
}

// Encodage des patchs par client (zones d'intérêt) : Colyseus 0.16 écrit
// les vues de tous les clients à la suite dans un seul tampon partagé. Si
// leur somme le dépasse, @colyseus/schema 3.0 réalloue un autre tampon mais
// renvoie une tranche de l'ancien : patchs tronqués pour les clients
// suivants (mesuré au banc avec 60 clients et le tampon par défaut de 8 Ko).
// D'où un tampon dimensionné pour une room pleine, respawns simultanés
// compris (une vue complète pèse moins de 20 Ko).
Encoder.BUFFER_SIZE = 1024 * 1024;

// Lames d'un joueur au début d'un échange : en orbite, plus celles perdues
// en clash dans les FIGHT_WINDOW_MS précédentes.
const FIGHT_WINDOW_MS = 3000;
function bladesBeforeFight(p: Player): number {
  const since = Date.now() - FIGHT_WINDOW_MS;
  let lost = 0;
  for (const l of p.recentLosses) if (l.ts >= since) lost++;
  return p.bladeCount + lost;
}

export class ArenaRoom extends Room<ArenaState> implements RestartAware {
  maxClients = MAX_PLAYERS_PER_ROOM;
  private pickup = new PickupSystem();
  private spawning = new SpawnSystem();
  private orbitCache = new OrbitPositionCache();
  private bots = new BotController();
  private crates = new CrateSystem();
  private powerups = new PowerUpSystem();
  // Options de la room (set au onCreate à partir des joinOptions du 1er
  // client, ou rempli par filterBy).
  private roomCode = "";
  private isPrivate = false;
  private botsEnabled = true;
  // Sessions expulsées pour flood d'inputs : onLeave les nettoie sans
  // ouvrir la fenêtre de reconnexion (sinon le client reviendrait aussitôt).
  private kickedSessions = new Set<string>();
  // Cooldowns de clash par paire (cf. resolveCollisions), propres à la room.
  private clashCooldowns = new Map<string, number>();
  // Clients en mode debug hitbox (client lancé avec ?debug=hitbox) : ils
  // reçoivent chaque tick la position serveur des lames en orbite proches.
  private debugOrbitClients = new Set<string>();
  // Zones d'intérêt des clients (tâche 2.4) et prochain résumé de la room.
  private interest = new InterestManager();
  private nextSummaryAt = 0;
  // Leader : joueur vivant au meilleur score (couronne, prime ; tâche 4.2).
  private leaderId: string | null = null;
  // Projectiles dont la touche est déjà comptée (télémétrie).
  private throwHitsCounted = new WeakSet<Blade>();

  onCreate(options: { code?: string; bots?: boolean } = {}): void {
    registerRoom(this);
    this.roomCode = typeof options.code === "string" ? options.code.toUpperCase() : "";
    this.isPrivate = this.roomCode.length > 0;
    // Privé par défaut sans bots (les parties avec potes, pas besoin de
    // remplissage), public avec bots. Override possible par l'option.
    this.botsEnabled = typeof options.bots === "boolean" ? options.bots : !this.isPrivate;
    this.setMetadata({
      code: this.roomCode,
      isPrivate: this.isPrivate,
      botsEnabled: this.botsEnabled,
    });
    const state = new ArenaState();
    state.mapRadius = MAP_RADIUS;
    state.code = this.roomCode;
    state.isPrivate = this.isPrivate;
    state.botsEnabled = this.botsEnabled;
    this.setState(state);
    // NB: pas de setPrivate(true) sur les rooms à code. Colyseus exclut
    // hardcoded les rooms privées de joinOrCreate (private:false dans la
    // requête matchmaker), donc setPrivate casserait le rejoin par code.
    // L'isolation public/privé est assurée côté filterBy : public envoie
    // code="", privé envoie le code à 5 chars, jamais de cross-match.
    this.setPatchRate(1000 / SERVER_TICKRATE);
    this.setSimulationInterval((dtMs) => this.tick(dtMs / 1000), 1000 / SERVER_TICKRATE);
    this.onMessage<InputMessage>("input", (client, msg) => this.handleInput(client, msg));
    this.onMessage<SetNameMessage>("setName", (client, msg) => {
      const p = this.state.players.get(client.sessionId);
      if (p) p.name = sanitizeName(msg?.name ?? "");
    });
    this.onMessage<RespawnMessage>("respawn", (client, msg) => this.handleRespawn(client, msg));
    this.onMessage<ChatMessage>("chat", (client, msg) => this.handleChat(client, msg));
    this.onMessage<ReportMessage>("report", (client, msg) => this.handleReport(client, msg));
    this.onMessage<ViewMessage>("view", (client, msg) => this.interest.setRadius(client.sessionId, msg?.r));
    // Ping affiché dans le HUD (tâche 3.4) : le numéro reçu est renvoyé tel
    // quel, le client mesure l'aller-retour.
    this.onMessage("ping", (client, n) => {
      if (typeof n === "number" && Number.isFinite(n)) client.send("pong", n);
    });
    this.onMessage<{ on?: boolean }>("debugOrbits", (client, msg) => {
      if (msg?.on) this.debugOrbitClients.add(client.sessionId);
      else this.debugOrbitClients.delete(client.sessionId);
    });
  }

  // Validation + rate limit + modération + broadcast d'un message chat.
  // Message vide ou débit dépassé : rejet silencieux (pas de réponse
  // d'erreur au sender, ça renseignerait les spammers). Le silence imposé
  // (tâche 5.6), lui, est annoncé au joueur.
  private handleChat(client: Client, msg: ChatMessage): void {
    // Mort, on parle encore (« gg », se plaindre d'une insulte) : tant
    // qu'on est dans la room.
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    const raw = (msg?.text ?? "").toString();
    // Trim + collapse whitespace (newlines / tabs deviennent espaces, pas
    // de pavé multiligne dans un overlay 1-line).
    const cleaned = raw.replace(/\s+/g, " ").trim();
    if (cleaned.length === 0) return;
    const text = cleaned.length > CHAT_MESSAGE_MAX_LENGTH
      ? cleaned.slice(0, CHAT_MESSAGE_MAX_LENGTH)
      : cleaned;

    // Sliding-window rate limit. Prune les vieilles entries puis check.
    const now = Date.now();
    const cutoff = now - CHAT_RATE_LIMIT_WINDOW_MS;
    p.chatTimestamps = p.chatTimestamps.filter((ts) => ts > cutoff);
    if (p.chatTimestamps.length >= CHAT_RATE_LIMIT_COUNT) return;
    p.chatTimestamps.push(now);

    // Silence imposé (tâche 5.6) : le joueur, lui, est prévenu.
    if (now < p.chatMutedUntil) {
      const muted: ChatMutedEvent = { seconds: Math.ceil((p.chatMutedUntil - now) / 1000) };
      client.send("chatMuted", muted);
      return;
    }
    // Texte d'origine gardé pour un éventuel signalement ; les autres
    // reçoivent la version masquée.
    p.recentChat.push({ text, ts: now });
    if (p.recentChat.length > CHAT_RECENT_KEPT) p.recentChat.shift();
    const censored = censorChat(text);
    if (censored.hits > 0) {
      p.chatStrikes = p.chatStrikes.filter((ts) => ts > now - CHAT_STRIKE_WINDOW_MS);
      p.chatStrikes.push(now);
      if (p.chatStrikes.length >= CHAT_STRIKES_TO_MUTE) {
        p.chatStrikes = [];
        p.chatMutedUntil = now + CHAT_AUTO_MUTE_MS;
        const muted: ChatMutedEvent = { seconds: Math.ceil(CHAT_AUTO_MUTE_MS / 1000) };
        client.send("chatMuted", muted);
      }
    }

    const event: ChatEvent = {
      playerId: p.id,
      playerName: p.name,
      text: censored.text,
      ts: now,
    };
    if (msg?.action === true) event.action = true;
    this.broadcast("chat", event);
  }

  // Signalement d'un joueur (tâche 5.6) : journalisé avec ses derniers
  // messages. Un par joueur visé et par partie, quelques-uns par tranche de
  // dix minutes ; les bots ne se signalent pas (ils ne parlent pas, leurs
  // noms sont fixes).
  private handleReport(client: Client, msg: ReportMessage): void {
    const reporter = this.state.players.get(client.sessionId);
    if (!reporter) return;
    const ack = (status: ReportAck["status"]) => client.send("reportAck", { status } satisfies ReportAck);
    const target = typeof msg?.targetId === "string" ? this.state.players.get(msg.targetId) : undefined;
    if (!target || target === reporter || target.isBot) return ack("unknown");
    if (reporter.reportedIds.has(target.id)) return ack("duplicate");
    const now = Date.now();
    reporter.reportTimes = reporter.reportTimes.filter((ts) => ts > now - REPORT_LIMIT_WINDOW_MS);
    if (reporter.reportTimes.length >= REPORT_LIMIT_COUNT) return ack("limited");
    reporter.reportedIds.add(target.id);
    reporter.reportTimes.push(now);
    const reason = typeof msg?.reason === "string" ? msg.reason.replace(/\s+/g, " ").trim().slice(0, REPORT_REASON_MAX_LENGTH) : "";
    trackWrite(logReport({
      roomId: this.roomId,
      roomPrivate: this.isPrivate,
      reporter: { name: reporter.name, userId: reporter.userId, guestId: reporter.guestId },
      target: { name: target.name, userId: target.userId, guestId: target.guestId },
      reason: reason || null,
      recentMessages: [...target.recentChat],
    }));
    ack("ok");
  }

  // Hook officiel Colyseus : exécuté AVANT onJoin. Si on rejette ici, le
  // client reçoit une erreur 4xx et n'entre jamais dans la room. On
  // n'utilise pas ça pour gating l'accès (mode invité possible) — juste
  // pour valider le token Supabase et stocker l'identité authentifiée que
  // onJoin pourra consommer via auth.userId.
  async onAuth(_client: Client, options: { token?: string; guestToken?: string; name?: string; code?: string }): Promise<{
    userId: string | null;
    username: string | null;
    guestId: string | null;
    name: string;
    xp: number;
    // Items achetés (tâche 6.1) : vérifient l'équipement demandé au join.
    owned: string[];
  }> {
    // Redémarrage annoncé (cf. shutdown.ts) : plus personne n'entre.
    if (restartDeadline() > 0) throw new ServerError(503, "server_restarting");
    // Rejoindre par identifiant (lien « rejoins-moi », tâche 5.5) passe à
    // côté du filtre du matchmaker : un salon privé exige toujours son code,
    // une arène publique n'en a pas.
    const code = typeof options?.code === "string" ? options.code.toUpperCase() : "";
    if (code !== this.roomCode) throw new ServerError(403, "wrong_room");
    const token = typeof options?.token === "string" && options.token.length > 0 ? options.token : null;
    const guestTok = typeof options?.guestToken === "string" && options.guestToken.length > 0 ? options.guestToken : null;
    const requestedName = sanitizeName(options?.name ?? "");
    if (token) {
      const user = await verifyAccessToken(token);
      if (user) {
        // Authed : un user authentifié n'a pas besoin de guest token, ses
        // trophées vont directement dans wallets.
        const finalName = user.username && user.username.length > 0 ? user.username : requestedName;
        // XP du niveau (tâche 5.2) : trophées gagnés, achats non déduits.
        const [w, owned] = await Promise.all([getWallet(user.id), getInventory(user.id)]);
        return { userId: user.id, username: user.username, guestId: null, name: finalName, xp: w?.total_earned ?? 0, owned };
      }
      // Token présent mais invalide/expiré → on dégrade en invité plutôt que
      // de refuser l'accès (l'UX côté client reflasher le token est plus
      // douce qu'un pop d'erreur). Le client peut détecter ça via /api/auth/me.
    }
    // Pas authed : si un guest token signé est fourni, on l'utilise pour
    // créditer les trophées dans guest_wallets ; sinon le joueur joue mais
    // ses trophées ne sont pas trackés.
    const guestId = guestTok ? verifyGuestToken(guestTok) : null;
    // Invité : son solde est toute son XP (il ne peut rien acheter).
    const g = guestId ? await getGuestWalletBalance(guestId) : null;
    // Un invité n'achète rien : ses cosmétiques sont ceux de son niveau.
    return { userId: null, username: null, guestId, name: requestedName, xp: g && !g.claimed ? g.balance : 0, owned: [] };
  }

  onJoin(
    client: Client,
    options: { name?: string; token?: string; guestToken?: string; newcomer?: boolean; loadout?: unknown },
    auth: { userId: string | null; username: string | null; guestId: string | null; name: string; xp?: number; owned?: string[] },
  ): void {
    const p = new Player();
    p.id = client.sessionId;
    p.userId = auth?.userId ?? null;
    p.guestId = auth?.guestId ?? null;
    p.xp = Math.max(0, Math.floor(auth?.xp ?? 0));
    p.level = levelForXp(p.xp);
    // Équipement proposé par le client, gardé s'il lui appartient (tâche 6.1).
    const owned = new Set(auth?.owned ?? []);
    const loadout = validateLoadout(options?.loadout, { level: p.level, owns: (id) => owned.has(id) });
    p.skin = loadout.skin;
    p.bladeSkin = loadout.bladeSkin;
    p.trail = loadout.trail;
    p.killFx = loadout.killFx;
    // Première partie sur l'appareil, selon le client : sert seulement à la
    // télémétrie.
    p.newcomer = options?.newcomer === true;
    p.name = sanitizeName(auth?.name ?? "");
    const spawn = pickSpawnPoint(this.state);
    p.x = spawn.x; p.y = spawn.y;
    p.alive = true;
    p.spawnedAt = Date.now();
    p.spinPhase = Math.random() * Math.PI * 2;
    p.spinScale = 0.75 + Math.random() * 0.5;
    p.tier = 0;
    // Nouvelle horloge d'orbite ; la vitesse est calculée au premier tick.
    p.orbitPhase = 0;
    p.orbitTick = this.state.tick;
    p.orbitRate = 0;
    p.spawnProtectionUntil = Date.now() + SPAWN_PROTECTION_MS;
    this.startGrace(p);
    this.state.players.set(client.sessionId, p);
    for (let i = 0; i < INITIAL_BLADE_COUNT; i++) this.spawnInitialBladeFor(p);
    this.interest.addViewer(client, p);
  }

  private spawnInitialBladeFor(p: Player): void {
    const b = new Blade();
    b.id = randomId();
    b.rarity = BladeRarity.Common;
    b.hp = RARITY_HP[BladeRarity.Common];
    this.state.blades.set(b.id, b);
    attachBladeToPlayer(this.state, p, b);
  }

  async onLeave(client: Client, consented: boolean): Promise<void> {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    // Expulsé pour flood : ni reconnexion, ni match enregistré.
    if (this.kickedSessions.delete(client.sessionId)) {
      this.cleanupPlayer(client.sessionId);
      return;
    }
    // Leave volontaire : cleanup immédiat.
    if (consented) {
      // Si le joueur était encore en vie (quit via menu), on persiste son
      // score actuel — sinon il aurait fait une "vraie" partie sans la voir
      // comptée au leaderboard.
      if (p.alive) {
        this.persistMatchIfAuthed(p);
        this.recordLifeEnd(p, "quit", null, p.bladeCount, null);
      }
      this.cleanupPlayer(client.sessionId);
      return;
    }
    // Disconnect involontaire (réseau qui hoquète, proxy, mobile qui dort) :
    // on garde l'état 20 s pour permettre au client de se reconnecter via
    // client.reconnect(token) sans retour au menu. Le perso est immobilisé
    // pendant l'attente : avant, il continuait sur son dernier input.
    p.inputDx = 0;
    p.inputDy = 0;
    p.inputBoost = false;
    p.inputThrow = false;
    p.aimX = 0;
    p.aimY = 0;
    p.inputQueue.length = 0;
    try {
      const back = await this.allowReconnection(client, 20);
      const again = this.state.players.get(back.sessionId);
      if (again) this.interest.reattach(back, again);
    } catch {
      const stale = this.state.players.get(client.sessionId);
      if (stale && stale.alive) {
        this.persistMatchIfAuthed(stale);
        this.recordLifeEnd(stale, restartDeadline() > 0 ? "restart" : "disconnect", null, stale.bladeCount, null);
      }
      this.cleanupPlayer(client.sessionId);
    }
  }

  onDispose(): void {
    unregisterRoom(this);
  }

  // Leader du tick, d'après les scores à jour. Son temps de règne alimente
  // la télémétrie.
  private updateLeader(dt: number): void {
    let leader: Player | null = null;
    for (const p of this.state.players.values()) {
      if (p.alive && (leader === null || p.score > leader.score)) leader = p;
    }
    this.leaderId = leader ? leader.id : null;
    if (leader) leader.lifeLeaderMs += dt * 1000;
  }

  // Fin de vie d'un humain : une ligne de télémétrie (tâche 4.8).
  private recordLifeEnd(
    p: Player,
    cause: LifeEnd,
    killer: Player | null,
    victimBlades: number,
    killerBlades: number | null,
    bounty = 0,
    underdog = false,
  ): void {
    if (p.isBot) return;
    const now = Date.now();
    let humans = 0;
    let bots = 0;
    this.state.players.forEach((o) => {
      if (o.isBot) bots++;
      else humans++;
    });
    recordLife({
      roomPrivate: this.isPrivate,
      userId: p.userId,
      lifeIndex: p.lifeIndex,
      newcomer: p.newcomer,
      durationMs: now - p.spawnedAt,
      cause,
      killerKind: killer ? (killer.isBot ? "bot" : "player") : null,
      killerTier: killer ? killer.tier : null,
      killerBlades,
      victimBlades,
      maxBlades: p.maxBladeCount,
      maxTier: p.lifeMaxTier,
      score: p.score,
      kills: p.kills,
      throws: p.lifeThrows,
      throwHits: p.lifeThrowHits,
      boostMs: p.lifeBoostMs,
      inGrace: p.graceRampUntil > now,
      humans,
      bots,
      wasLeader: p.id === this.leaderId,
      leaderMs: p.lifeLeaderMs,
      bounty,
      underdog,
    });
  }

  // Un lancer compte une touche au premier adversaire atteint, même s'il en
  // perce plusieurs.
  private countThrowHit(bladeId: string): void {
    const proj = this.state.blades.get(bladeId);
    if (!proj || this.throwHitsCounted.has(proj)) return;
    this.throwHitsCounted.add(proj);
    const thrower = this.state.players.get(proj.thrownBy);
    if (thrower?.alive) thrower.lifeThrowHits++;
  }

  // Redémarrage du serveur (tâche T.3) : les joueurs voient un compte à
  // rebours jusqu'à `at` (heure du serveur) ; la room n'accepte plus
  // personne.
  announceRestart(at: number): void {
    this.broadcast("restart", { at });
    // Un échec du verrou ne doit pas faire tomber le processus pendant le
    // préavis : onAuth refuse de toute façon les nouvelles entrées.
    this.lock().catch((e) => console.warn("[blade.io] room lock failed during shutdown:", e));
  }

  humanCount(): number {
    return this.clients.length;
  }

  private cleanupPlayer(sessionId: string): void {
    this.debugOrbitClients.delete(sessionId);
    this.interest.removeViewer(sessionId);
    const toRemove: string[] = [];
    this.state.blades.forEach((b) => {
      if (b.ownerId === sessionId) toRemove.push(b.id);
    });
    for (const id of toRemove) this.state.blades.delete(id);
    this.state.players.delete(sessionId);
  }

  // À la fin d'une partie (mort ou leave en vie) :
  // - si le joueur est authed -> insert dans matches (leaderboard) +
  //   credit dans wallets (currency persistante).
  // - si le joueur est guest avec un token signé -> credit dans
  //   guest_wallets (sera transféré au compte au sign-in).
  // - sinon (bot, anonyme sans token, Supabase down) -> no-op.
  // - room privée -> no-op : ni trophées ni classement. Seul dans sa room
  //   avec une densité de loot ×2,5 et sans ennemi, le score se farmait
  //   sans aucun risque et remontait au leaderboard.
  // Idempotent par appelant : on n'appelle qu'une fois (à la mort, au
  // leave en vie, ou au timeout de reconnect).
  private persistMatchIfAuthed(p: Player): void {
    if (p.isBot) return;
    if (this.isPrivate) return;
    const trophies = Math.max(0, Math.floor(p.score));
    // Écritures suivies (trackWrite) : un arrêt du serveur les attend.
    const owner: ChallengeOwner | null = p.userId
      ? { id: p.userId, kind: "user" }
      : p.guestId ? { id: p.guestId, kind: "guest" } : null;
    if (owner) trackWrite(this.advanceChallengesFor(p, owner));
    if (p.userId) {
      const survival = Math.max(0, (Date.now() - p.spawnedAt) / 1000);
      trackWrite(recordMatch({
        userId: p.userId,
        score: p.score,
        kills: p.kills,
        maxBlades: p.maxBladeCount,
        survivalSeconds: survival,
        cratesDestroyed: p.cratesDestroyed,
        powerupsCollected: p.powerupsCollected,
        roomCode: this.roomCode || undefined,
      }));
      if (trophies > 0) {
        trackWrite(creditWallet(p.userId, trophies));
        this.gainXp(p, trophies);
      }
      return;
    }
    if (p.guestId && trophies > 0) {
      trackWrite(creditGuestWallet(p.guestId, trophies));
      this.gainXp(p, trophies);
    }
  }

  // Défis (tâche 5.3) : la base fait avancer ceux du jour et de la semaine
  // et crédite ceux que la vie réussit ; le joueur, s'il est encore là, le
  // voit tout de suite (XP et notification).
  private async advanceChallengesFor(p: Player, owner: ChallengeOwner): Promise<void> {
    const done = await advanceChallenges(owner, {
      throws: p.lifeThrows,
      crates: p.cratesDestroyed,
      kills: p.kills,
      powerups: p.powerupsCollected,
      survivalSeconds: Math.max(0, (Date.now() - p.spawnedAt) / 1000),
      biggerKills: p.lifeBiggerKills,
      leaderKills: p.lifeLeaderKills,
      peakBlades: p.maxBladeCount,
      wasLeader: p.lifeLeaderMs > 0 || p.id === this.leaderId,
    });
    if (done.length === 0 || this.state.players.get(p.id) !== p) return;
    for (const d of done) this.gainXp(p, d.reward);
    const ev: ChallengeDoneEvent = { challenges: done };
    this.clients.find((c) => c.sessionId === p.id)?.send("challengeDone", ev);
  }

  // Trophées crédités = XP (tâche 5.2) : le niveau affiché suit sans
  // attendre le prochain join.
  private gainXp(p: Player, amount: number): void {
    p.xp += amount;
    p.level = levelForXp(p.xp);
  }

  private handleInput(client: Client, msg: InputMessage): void {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    const now = Date.now();
    if (now - p.inputWindowStart > 1000) {
      // Bilan de la fenêtre qui se termine : au-dessus du plafond = une
      // violation, fenêtre propre = compteur remis à zéro. Seules des
      // violations consécutives expulsent (cf. MAX_INPUT_VIOLATIONS).
      p.violations = p.inputCount > MAX_INPUT_RATE ? p.violations + 1 : 0;
      p.inputWindowStart = now;
      p.inputCount = 0;
      if (p.violations >= MAX_INPUT_VIOLATIONS) {
        console.warn(`[blade.io] input flood: kicking ${client.sessionId} (${p.name})`);
        this.kickedSessions.add(client.sessionId);
        client.leave(CLOSE_CODE_INPUT_FLOOD);
        return;
      }
    }
    p.inputCount++;
    if (p.inputCount > MAX_INPUT_RATE) return;
    const dx = Number.isFinite(msg.dx) ? msg.dx : 0;
    const dy = Number.isFinite(msg.dy) ? msg.dy : 0;
    const cdx = Math.max(-1, Math.min(1, dx));
    const cdy = Math.max(-1, Math.min(1, dy));
    // Un input = un pas de mouvement, appliqué au tick dans l'ordre des seq
    // (cf. updateMovement). Doublon ou input en retard : ignoré. Mort : pas
    // de pas, mais acquitté, pour que le client n'ait rien à rejouer.
    const seq = typeof msg.seq === "number" && Number.isFinite(msg.seq) ? msg.seq >>> 0 : p.lastQueuedSeq + 1;
    if (seq > p.lastQueuedSeq) {
      p.lastQueuedSeq = seq;
      if (p.alive) {
        p.inputQueue.push({ dx: cdx, dy: cdy, boost: !!msg.boost, seq });
        if (p.inputQueue.length > MAX_INPUT_QUEUE) p.inputQueue.splice(0, p.inputQueue.length - MAX_INPUT_QUEUE);
      } else {
        p.lastSeq = seq;
      }
    }
    // Edge-trigger : on ne consomme le throw qu'au tick suivant. Si un client
    // envoie throw=true plusieurs fois rapidement, on coalesce (le cooldown
    // côté processThrows fait foi de toute façon).
    if (msg.throw === true) {
      p.inputThrow = true;
      // Visée du lancer, lue avec le flag : un message sans lancer arrivé
      // dans le même tick ne doit pas l'effacer. Acceptée si finie et assez
      // longue pour avoir une direction, normalisée ici. Sinon (clavier
      // seul, tap mobile), le lancer suit la direction de déplacement.
      const ax = Number(msg.aimX);
      const ay = Number(msg.aimY);
      const aimLen = Number.isFinite(ax) && Number.isFinite(ay) ? Math.hypot(ax, ay) : 0;
      if (aimLen > 1e-3) {
        p.aimX = ax / aimLen;
        p.aimY = ay / aimLen;
      } else {
        p.aimX = 0;
        p.aimY = 0;
      }
    }
  }

  private handleRespawn(client: Client, msg: RespawnMessage): void {
    const p = this.state.players.get(client.sessionId);
    if (!p || p.alive) return;
    if (msg?.name) p.name = sanitizeName(msg.name);
    const spawn = pickSpawnPoint(this.state);
    p.x = spawn.x; p.y = spawn.y;
    p.inputDx = 0; p.inputDy = 0; p.inputBoost = false;
    p.inputThrow = false; p.aimX = 0; p.aimY = 0;
    // Inputs envoyés pendant l'écran de mort : acquittés sans pas (cf.
    // handleInput). Le recul de la vie précédente ne pousse pas le nouveau
    // spawn.
    p.inputQueue.length = 0; p.stepCredit = 0;
    p.knockbackVx = 0; p.knockbackVy = 0;
    p.throwCooldownUntil = 0;
    p.alive = true; p.boost = false;
    p.bladeCount = 0; p.bladeIds = [];
    p.kills = 0; p.maxBladeCount = 0; p.score = 0;
    p.cratesDestroyed = 0; p.powerupsCollected = 0;
    p.spawnedAt = Date.now();
    p.lastKiller = null; p.violations = 0;
    p.spinPhase = Math.random() * Math.PI * 2;
    p.spinScale = 0.75 + Math.random() * 0.5;
    p.tier = 0;
    p.hitlagUntil = 0;
    p.hitlagReadyAt = 0;
    // Nouvelle horloge d'orbite ; la vitesse est calculée au premier tick.
    p.orbitPhase = 0;
    p.orbitTick = this.state.tick;
    p.orbitRate = 0;
    p.knockbackVx = 0;
    p.knockbackVy = 0;
    p.recentLosses = [];
    p.lifeIndex++;
    p.lifeThrows = 0; p.lifeThrowHits = 0;
    p.lifeBoostMs = 0; p.lifeMaxTier = 0;
    p.lifeLeaderMs = 0; p.bonusScore = 0;
    p.lifeBiggerKills = 0; p.lifeLeaderKills = 0;
    p.spawnProtectionUntil = Date.now() + SPAWN_PROTECTION_MS;
    this.startGrace(p);
    for (let i = 0; i < INITIAL_BLADE_COUNT; i++) this.spawnInitialBladeFor(p);
  }

  // Période de grâce d'un joueur qui (ré)apparaît (cf. SPAWN_GRACE_MS).
  private startGrace(p: Player): void {
    const now = Date.now();
    p.graceUntil = now + SPAWN_GRACE_MS;
    p.graceRampUntil = p.graceUntil + SPAWN_GRACE_RAMP_MS;
  }

  // Fin anticipée de la grâce et de sa rampe : le joueur a lancé, ou ses
  // lames ont touché quelqu'un.
  private endGrace(p: Player | null | undefined): void {
    if (!p) return;
    p.graceUntil = 0;
    p.graceRampUntil = 0;
  }

  // Clash entre p et other : p a touché quelqu'un, sauf si other est un bot
  // lancé à sa poursuite. C'est alors le bot qui attaque ; s'il suffisait à
  // lever la protection, tous les autres bots fondraient aussitôt sur p.
  private endGraceOnContact(p: Player, other: Player): void {
    if (other.isBot && this.bots.isChasing(other.id, p.id)) return;
    this.endGrace(p);
  }

  private tick(dt: number): void {
    this.state.tick++;
    this.state.serverTime = Date.now();
    if (this.botsEnabled) {
      this.maintainBots();
      const leader = this.leaderId ? this.state.players.get(this.leaderId) : undefined;
      this.bots.setLeader(this.leaderId, leader?.alive ? bountyFor(leader.score) : 0);
      this.bots.update(dt, this.state);
    }
    // Recalcule le tier de chaque joueur AVANT toutes les autres systèmes
    // (collision lit `tier` pour la hitbox, orbitPositions pour la rotation).
    // Émet un tierUp si on monte d'un palier — la chute (perte de lames)
    // ne broadcast pas pour ne pas spammer.
    this.state.players.forEach((p) => {
      if (!p.alive) return;
      const next = tierFromBladeCount(p.bladeCount);
      if (next > p.lifeMaxTier) p.lifeMaxTier = next;
      if (next > p.tier) {
        p.tier = next;
        const ev: TierUpEvent = { playerId: p.id, tier: next, x: p.x, y: p.y };
        this.emit("tierUp", ev, { players: [p.id] });
      } else if (next < p.tier) {
        p.tier = next;
      }
    });
    updateMovement(dt, this.state, (player, count) => this.removePlayerBlades(player, count));
    // Lancer de lame : exécuté juste après le mouvement pour utiliser la
    // direction (dirX/dirY) actualisée. La lame extérieure est détachée et
    // mise en projectile. Le cooldown est imposé serveur-side.
    const throwCb = this.makeThrowCallbacks();
    processThrows(this.state, throwCb);
    // Temps d'orbite dérivé du numéro de tick (déterministe, identique
    // pour tous les clients), pas de la somme des dt réels.
    updateBladePositions(dt, this.state.tick, this.state, this.orbitCache);
    // Juste après le calcul des positions : les ramassages et destructions
    // qui suivent dans ce tick réindexent des slots, la trame debug doit
    // décrire l'état que les collisions vont réellement utiliser.
    if (this.debugOrbitClients.size > 0) this.sendDebugOrbits();
    // Avancer les projectiles APRÈS updateBladePositions (qui skip les
    // projectiles), avant les collisions classiques (qui ignorent aussi).
    updateProjectiles(dt, this.state, throwCb);
    // Murs tueurs : doit s'exécuter APRÈS updateBladePositions pour que
    // l'orbitCache soit à jour. Tout joueur ou lame orbitante au-delà du
    // rayon limite est détruit. Killer = null pour le joueur (mort de mur).
    applyWallDamage(this.state, this.orbitCache, {
      onPlayerKilled: (victim) => this.killPlayer(victim, null, "wall"),
      onBladeDestroyed: (blade) => this.handleBladeDestroyed(blade),
    });
    this.pickup.update(this.state, (player, blade) => {
      this.emit("pickup", { playerId: player.id, rarity: blade.rarity }, { to: [player.id] });
    });
    resolveCollisions(this.state, this.orbitCache, {
      onBladeDestroyed: (blade, by) => this.handleBladeDestroyed(blade, by),
      onPlayerKilled: (victim, killer) => this.killPlayer(victim, killer, "blades"),
      onCrateHit: (crate, attacker) => this.handleCrateHit(crate, attacker),
      onCrateDestroyed: (crate, attacker) => this.handleCrateDestroyed(crate, attacker),
      onClash: (info) => {
        this.endGraceOnContact(info.aOwner, info.bOwner);
        this.endGraceOnContact(info.bOwner, info.aOwner);
        const ev: ClashEvent = {
          aId: info.a.id,
          bId: info.b.id,
          aOwnerId: info.aOwner.id,
          bOwnerId: info.bOwner.id,
          x: (info.ax + info.bx) * 0.5,
          y: (info.ay + info.by) * 0.5,
          tier: info.tier,
          destroyed: info.destroyed,
        };
        this.emit("clash", ev, { players: [info.aOwner.id, info.bOwner.id] });
      },
    }, this.clashCooldowns);
    // Collisions des projectiles : APRÈS resolveCollisions pour que les
    // lames orbitantes restent référence (orbitCache à jour, position des
    // joueurs aussi). Les projectiles consomment leur "pierce" sur chaque
    // contact et se détruisent quand il atteint 0.
    resolveProjectileCollisions(this.state, throwCb, this.orbitCache);
    this.spawning.update(dt, this.state, this.isPrivate);
    this.crates.update(dt, this.state, this.isPrivate);
    this.powerups.update(dt, this.state, this.isPrivate, (player, pu) => this.handlePowerUpPickup(player, pu));
    // (Auto-fusion supprimée — la progression se fait par accumulation.)
    // Mise à jour du score composite pour tous les joueurs vivants (composante survival).
    this.state.players.forEach((p) => { if (p.alive) updateScore(p); });
    this.updateLeader(dt);
    this.bots.cleanupDead(this.state);
    // Zones d'intérêt : après toute la simulation du tick, avant le patch,
    // un tick sur deux (30 Hz). En 33 ms, rien ne parcourt la marge de la
    // zone (8 u) ni celle des buissons (3 u) ; le calcul coûtait ~2 ms par
    // tick à 60 clients.
    if (this.state.tick % 2 === 0) this.interest.update(this.state);
    const now = Date.now();
    if (now >= this.nextSummaryAt) {
      this.nextSummaryAt = now + SUMMARY_INTERVAL_MS;
      this.broadcast("summary", this.buildSummary());
    }
  }

  // Ce que la zone d'intérêt ne donne plus : classement complet, joueurs de
  // la minimap (hors buissons), lames légendaires au sol.
  private buildSummary(): RoomSummary {
    const summary: RoomSummary = { board: [], map: [], legendaries: [], leader: null };
    this.state.players.forEach((p) => {
      if (p.alive && !isInBush(p.x, p.y)) summary.map.push([summary.board.length, Math.round(p.x), Math.round(p.y)]);
      if (p.id === this.leaderId) summary.leader = [summary.board.length, bountyFor(p.score)];
      summary.board.push([p.id, p.name, p.score, p.bladeCount, p.isBot]);
    });
    this.state.blades.forEach((b) => {
      if (!b.ownerId && !b.isProjectile && b.rarity === BladeRarity.Legendary) {
        summary.legendaries.push([Math.round(b.x), Math.round(b.y)]);
      }
    });
    return summary;
  }

  // Évènement de jeu estampillé du tick courant (cf. TickStamped). Avec une
  // portée, il ne part qu'aux clients concernés (cf. EventScope) : un client
  // ne reçoit pas la position d'un joueur qu'il ne voit pas.
  private emit(type: string, payload: object, scope?: EventScope): void {
    const message = { ...payload, tick: this.state.tick };
    if (scope) this.sendScoped(type, message, scope);
    else this.broadcast(type, message);
  }

  // Remplacé par les tests (TestRoom), qui capturent tous les évènements.
  private sendScoped(type: string, message: object, scope: EventScope): void {
    this.interest.send(type, message, scope);
  }

  // Mode debug hitbox : positions et hitbox des lames en orbite, telles que
  // les collisions de ce tick les voient, dans un rayon de 80 u autour du
  // joueur. Le client les superpose à son rendu pour vérifier que ce qu'on
  // voit est ce que le serveur calcule.
  private sendDebugOrbits(): void {
    const radiusSq = 80 * 80;
    for (const sessionId of this.debugOrbitClients) {
      const client = this.clients.find((c) => c.sessionId === sessionId);
      const me = this.state.players.get(sessionId);
      if (!client || !me) continue;
      const owners: Record<string, [number, number]> = {};
      const inRing = new Map<string, number>();
      this.state.players.forEach((p) => {
        if (!p.alive) return;
        // Seulement les joueurs que ce client voit : sinon le mode debug,
        // que tout client peut demander, trahirait les joueurs cachés.
        if (p.id !== sessionId && !this.interest.sees(sessionId, p.id)) return;
        const dx = p.x - me.x;
        const dy = p.y - me.y;
        if (dx * dx + dy * dy <= radiusSq) owners[p.id] = [p.x, p.y];
      });
      this.state.blades.forEach((b) => {
        if (!b.ownerId || !owners[b.ownerId]) return;
        const key = `${b.ownerId}|${b.ringIndex}`;
        inRing.set(key, (inRing.get(key) ?? 0) + 1);
      });
      // Anneau et slot tels que le serveur les a utilisés : la mesure côté
      // client isole la phase d'orbite des changements de composition.
      const rows: Array<[string, string, number, number, number, number, number, number]> = [];
      this.state.blades.forEach((b) => {
        if (!b.ownerId || !owners[b.ownerId]) return;
        const pos = this.orbitCache.get(b.id);
        if (!pos) return;
        const owner = this.state.players.get(b.ownerId)!;
        rows.push([
          b.id, b.ownerId, pos.x, pos.y, tierBladeHitbox(owner.tier),
          b.ringIndex, b.slotIndex, inRing.get(`${b.ownerId}|${b.ringIndex}`) ?? 1,
        ]);
      });
      client.send("debugOrbits", { tick: this.state.tick, owners, blades: rows });
    }
  }

  // Callbacks partagés entre processThrows / updateProjectiles /
  // resolveProjectileCollisions. Reuse les helpers existants pour rester
  // cohérent avec le reste (kill drop, broadcast, score…).
  private makeThrowCallbacks() {
    return {
      onBladeThrown: (ev: BladeThrownEvent) => {
        const thrower = this.state.players.get(ev.thrownBy);
        if (thrower) thrower.lifeThrows++;
        this.endGrace(thrower);
        this.emit("bladeThrown", ev, { players: [ev.thrownBy], blade: ev.bladeId });
      },
      onProjectileImpact: (ev: ProjectileImpactEvent) => {
        // Lame en orbite ou corps : le lancer a touché un adversaire.
        if (ev.kind === 0 || ev.kind === 1) this.countThrowHit(ev.bladeId);
        this.emit("projectileImpact", ev, { blade: ev.bladeId, at: { x: ev.x, y: ev.y } });
      },
      onPlayerKilled: (victim: Player, killer: Player | null) =>
        this.killPlayer(victim, killer, "throw"),
      onCrateHit: (crate: Crate, attacker: Player | null) =>
        this.handleCrateHit(crate, attacker),
      onCrateDestroyed: (crate: Crate, attacker: Player | null) =>
        this.handleCrateDestroyed(crate, attacker),
      onBladeDestroyed: (blade: Blade, by: Player | null) => this.handleBladeDestroyed(blade, by),
    };
  }

  private handlePowerUpPickup(player: Player, pu: PowerUp): void {
    player.powerupsCollected++;
    updateScore(player);
    this.emit("powerupPickup", {
      playerId: player.id,
      type: pu.type,
      rarity: pu.rarity,
      x: pu.x,
      y: pu.y,
    }, { to: [player.id], players: [player.id] });
  }

  private handleCrateHit(crate: Crate, attacker: Player | null): void {
    this.emit("crateHit", { crateId: crate.id, x: crate.x, y: crate.y, hp: crate.hp },
      { to: [attacker?.id], at: { x: crate.x, y: crate.y } });
  }

  private handleCrateDestroyed(crate: Crate, attacker: Player | null): void {
    if (attacker) {
      attacker.cratesDestroyed++;
      updateScore(attacker);
    }
    const ev: CrateDestroyedEvent = { crateId: crate.id, x: crate.x, y: crate.y };
    // L'auteur n'est pas nommé s'il est caché dans un buisson : l'évènement
    // part à tous les clients proches de la caisse.
    if (attacker && !isInBush(attacker.x, attacker.y)) ev.byId = attacker.id;
    this.emit("crateDestroyed", ev, { to: [attacker?.id], at: { x: crate.x, y: crate.y } });
    this.crates.destroyCrate(this.state, crate);
  }

  private maintainBots(): void {
    let bots = 0;
    this.state.players.forEach((p) => { if (p.isBot) bots++; });
    const want = this.bots.desiredBotCount(this.state);
    while (bots < want) {
      const spawn = randomSpawnPoint(this.state);
      const p = this.bots.spawnBot(this.state, spawn);
      for (let i = 0; i < INITIAL_BLADE_COUNT; i++) this.spawnInitialBladeFor(p);
      bots++;
    }
  }

  private handleBladeDestroyed(blade: Blade, by: Player | null = null): void {
    const cached = this.orbitCache.get(blade.id);
    const x = cached ? cached.x : blade.x;
    const y = cached ? cached.y : blade.y;
    const ev: BladeDestroyedEvent = {
      bladeId: blade.id, x, y, rarity: blade.rarity, ownerId: blade.ownerId,
    };
    if (by) ev.byId = by.id;
    this.emit("bladeDestroyed", ev, { blade: blade.id, to: [blade.ownerId] });
    const ownerId = blade.ownerId;
    const ring = blade.ringIndex;
    if (ownerId) {
      const owner = this.state.players.get(ownerId);
      if (owner) {
        owner.bladeCount = Math.max(0, owner.bladeCount - 1);
        const idx = owner.bladeIds.indexOf(blade.id);
        if (idx >= 0) owner.bladeIds.splice(idx, 1);
        // Mémoire courte des pertes : la lame casse dans un clash → on
        // l'enregistre pour qu'elle drop si l'owner se fait tuer dans la
        // foulée. Cap circulaire : on shift l'entrée la plus vieille.
        owner.recentLosses.push({ rarity: blade.rarity, ts: Date.now() });
        if (owner.recentLosses.length > RECENT_LOSS_BUFFER_CAP) {
          owner.recentLosses.shift();
        }
      }
    }
    this.state.blades.delete(blade.id);
    if (ownerId) recompactOwnerRing(this.state, ownerId, ring);
  }

  private removePlayerBlades(player: Player, count: number): void {
    for (let i = 0; i < count; i++) {
      if (player.bladeIds.length === 0) break;

      // Drain boost par rareté ASCENDANTE : on dépense en priorité les
      // lames les moins précieuses (Common avant Rare avant Epic avant
      // Legendary). Avant : pop() consommait la dernière lame ramassée,
      // souvent la plus rare → boostait punissait les loot drops chanceux.
      // Maintenant : scan pour trouver le minimum de rareté et le splice.
      let pickIdx = -1;
      let pickRarity = Infinity;
      for (let j = 0; j < player.bladeIds.length; j++) {
        const blade = this.state.blades.get(player.bladeIds[j]);
        if (!blade) continue; // entrée orpheline (state divergence)
        if (blade.rarity < pickRarity) {
          pickRarity = blade.rarity;
          pickIdx = j;
          // Fast-path : rareté 0 = Common = minimum possible, on s'arrête.
          if (blade.rarity === 0) break;
        }
      }

      if (pickIdx === -1) {
        // Aucune lame valide : nettoie l'orphelin en queue et continue.
        player.bladeIds.pop();
        continue;
      }

      const [id] = player.bladeIds.splice(pickIdx, 1);
      const b = this.state.blades.get(id);
      if (!b) continue;
      const ring = b.ringIndex;
      this.state.blades.delete(id);
      player.bladeCount = Math.max(0, player.bladeCount - 1);
      recompactOwnerRing(this.state, player.id, ring);
    }
  }

  private killPlayer(victim: Player, killer: Player | null, reason: KillCause): void {
    if (!victim.alive) return;
    victim.alive = false;
    // Rapport de force au début de l'échange, pour l'écran de mort : au
    // moment du coup fatal, la victime a souvent déjà perdu ses lames dans
    // les clashs qui précèdent.
    const victimBlades = bladesBeforeFight(victim);
    const killerBlades = killer ? bladesBeforeFight(killer) : null;
    // Contre-mesures au snowball (tâche 4.2) : prime sur le leader, bonus au
    // tueur d'un joueur au moins deux fois plus gros.
    const wasLeader = victim.id === this.leaderId;
    const bounty = wasLeader && killer ? bountyFor(victim.score) : 0;
    const underdog = killer !== null && killerBlades !== null && isUnderdogKill(killerBlades, victimBlades);
    this.recordLifeEnd(victim, reason, killer, victimBlades, killerBlades, bounty, underdog);
    // Persiste le match juste après le passage à mort (avant le drop, mais
    // après que tous les compteurs de session ont été incrémentés au cours
    // de la vie). Pas de await : recordMatch gère ses propres erreurs et on
    // ne veut pas bloquer la game loop.
    this.persistMatchIfAuthed(victim);
    // Les lames rares tombent en premier (tâche 4.2) : avant, les plus
    // anciennes, souvent les Common de départ, et les plus rares étaient
    // détruites. Le leader lâche tout.
    const owned: Blade[] = [];
    for (const id of victim.bladeIds) {
      const b = this.state.blades.get(id);
      if (b) owned.push(b);
    }
    owned.sort((a, b) => b.rarity - a.rarity);
    const dropCount = Math.floor(owned.length * (wasLeader ? LEADER_DROP_RATIO : DEATH_DROP_RATIO));
    const droppedRarities: BladeRarity[] = [];
    for (let i = 0; i < owned.length; i++) {
      if (i < dropCount) droppedRarities.push(owned[i].rarity as BladeRarity);
      this.state.blades.delete(owned[i].id);
    }
    victim.bladeIds = [];
    victim.bladeCount = 0;
    const now = Date.now();
    // Bonus "pertes récentes" : on prune la fenêtre, puis on drop la
    // fraction RECENT_LOSS_DROP_RATIO (1.0 = 100 %) des lames cassées en
    // clash dans les 10 dernières secondes. C'est ce qui donne au tueur
    // un butin cohérent avec le combat même si la victime meurt à 0 lame
    // en orbite. Plafonné à RECENT_LOSS_BUFFER_CAP entrées (12).
    const cutoff = now - RECENT_LOSS_WINDOW_MS;
    const fresh = victim.recentLosses.filter((l) => l.ts >= cutoff);
    const recentDropCount = Math.floor(fresh.length * RECENT_LOSS_DROP_RATIO);
    // Échantillonnage déterministe : on prend une lame sur deux pour
    // préserver la distribution des raretés (sinon prendre les N premiers
    // biaiserait vers les pertes les plus anciennes).
    for (let i = 0; i < recentDropCount; i++) {
      const idx = Math.floor((i * fresh.length) / Math.max(1, recentDropCount));
      droppedRarities.push(fresh[idx].rarity as BladeRarity);
    }
    victim.recentLosses = [];
    for (const rarity of droppedRarities) {
      const a = Math.random() * Math.PI * 2;
      const d = DEATH_DROP_MIN_DIST + Math.random() * (DEATH_DROP_MAX_DIST - DEATH_DROP_MIN_DIST);
      // Vitesse initiale calibrée pour que la position finale (post-friction)
      // reste dans PICKUP_MAGNET_RADIUS — le tueur récupère le butin sans
      // avoir à courir après les bords.
      const speed = DEATH_DROP_SPEED_MIN + Math.random() * (DEATH_DROP_SPEED_MAX - DEATH_DROP_SPEED_MIN);
      const nb = new Blade();
      nb.id = randomId();
      nb.rarity = rarity;
      nb.hp = RARITY_HP[rarity];
      nb.x = victim.x; nb.y = victim.y;
      nb.vx = Math.cos(a) * speed; nb.vy = Math.sin(a) * speed;
      nb.pickupLockUntil = now + 400;
      nb.expiresAt = now + GROUND_BLADE_TTL_MS;
      this.state.blades.set(nb.id, nb);
    }
    if (killer) {
      killer.kills++;
      if (killerBlades !== null && victimBlades > killerBlades) killer.lifeBiggerKills++;
      if (bounty > 0) killer.lifeLeaderKills++;
      killer.bonusScore += bounty + (underdog ? SCORE_UNDERDOG : 0);
      updateScore(killer);
      this.endGrace(killer);
    }
    // Pas de killer humain → on étiquette la cause (border = "wall") pour que
    // le death screen affiche quand même un "killed by". Sinon la ligne
    // disparaît et le joueur ne sait pas pourquoi il est mort.
    const killerLabel =
      killer?.name ?? (reason === "wall" ? "GRID BORDER" : null);
    const ev: PlayerKilledEvent = {
      victimId: victim.id,
      killerId: killer?.id ?? null,
      victimName: victim.name,
      killerName: killerLabel,
      cause: reason,
      victimBlades,
      killerBlades,
      bounty,
      underdog,
    };
    if (killer?.killFx) ev.killFx = killer.killFx;
    this.emit("playerKilled", ev);
  }
}
