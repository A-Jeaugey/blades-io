import { Room, Client } from "@colyseus/core";
import {
  BladeRarity,
  BOT_MAX_TOTAL,
  BOT_MIN_PLAYERS,
  BOT_NAMES,
  BOT_THINK_INTERVAL,
  ClashEvent,
  DEATH_DROP_MAX_DIST,
  DEATH_DROP_MIN_DIST,
  DEATH_DROP_RATIO,
  RECENT_LOSS_BUFFER_CAP,
  RECENT_LOSS_DROP_RATIO,
  RECENT_LOSS_WINDOW_MS,
  SPAWN_PROTECTION_MS,
  DECOR_COLLIDERS,
  GROUND_BLADE_TTL_MS,
  INITIAL_BLADE_COUNT,
  MAP_RADIUS,
  MAX_INPUT_RATE,
  MAX_PLAYERS_PER_ROOM,
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
  PLAYER_BODY_RADIUS,
  RARITY_HP,
  SERVER_DT,
  SERVER_TICKRATE,
  TierUpEvent,
  WALL_KILL_THICKNESS,
  InputMessage,
  SetNameMessage,
  RespawnMessage,
  resolveDecorCollision,
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
import { BotController } from "../systems/bots";
import { CrateSystem } from "../systems/crates";
import { PowerUpSystem } from "../systems/powerups";
import { updateScore } from "../systems/scoring";
import {
  processThrows,
  resolveProjectileCollisions,
  updateProjectiles,
} from "../systems/throws";
import { BladeThrownEvent, ProjectileImpactEvent } from "@bladeio/shared";
import { Crate } from "../state/Crate";
import { PowerUp } from "../state/PowerUp";
import { randomId } from "../utils/ids";
import { verifyAccessToken } from "../auth/supabase";
import { recordMatch } from "../auth/matches";
import { creditGuestWallet, creditWallet } from "../auth/wallet";
import { verifyGuestToken } from "../auth/guestToken";

function sanitizeName(raw: string): string {
  const cleaned = (raw ?? "")
    .replace(/[^\p{L}\p{N}_\-\.]/gu, "")
    .trim()
    .slice(0, NAME_MAX_LENGTH);
  if (cleaned.length < NAME_MIN_LENGTH) return "Anon" + Math.floor(Math.random() * 1000);
  return cleaned;
}

function randomSpawnPoint(state: ArenaState): { x: number; y: number } {
  const innerRadius = MAP_RADIUS - WALL_KILL_THICKNESS - 5;
  for (let tries = 0; tries < 30; tries++) {
    const r = Math.sqrt(Math.random()) * innerRadius * 0.8;
    const a = Math.random() * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    let inDecor = false;
    for (const d of DECOR_COLLIDERS) {
      const dx = x - d.x;
      const dy = y - d.y;
      const minR = d.radius + PLAYER_BODY_RADIUS + 1;
      if (dx * dx + dy * dy < minR * minR) { inDecor = true; break; }
    }
    if (inDecor) continue;
    let ok = true;
    state.players.forEach((p) => {
      if (!p.alive) return;
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy < 25 * 25) ok = false;
    });
    if (ok) return { x, y };
  }
  return resolveDecorCollision(0, 0, PLAYER_BODY_RADIUS);
}

export class ArenaRoom extends Room<ArenaState> {
  maxClients = MAX_PLAYERS_PER_ROOM;
  private pickup = new PickupSystem();
  private spawning = new SpawnSystem();
  private orbitCache = new OrbitPositionCache();
  private bots = new BotController();
  private crates = new CrateSystem();
  private powerups = new PowerUpSystem();
  private elapsed = 0;
  // Options de la room (set au onCreate à partir des joinOptions du 1er
  // client, ou rempli par filterBy).
  private roomCode = "";
  private isPrivate = false;
  private botsEnabled = true;

  onCreate(options: { code?: string; bots?: boolean } = {}): void {
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
    this.onMessage("ping", (client) => client.send("pong", { t: Date.now() }));
  }

  // Hook officiel Colyseus : exécuté AVANT onJoin. Si on rejette ici, le
  // client reçoit une erreur 4xx et n'entre jamais dans la room. On
  // n'utilise pas ça pour gating l'accès (mode invité possible) — juste
  // pour valider le token Supabase et stocker l'identité authentifiée que
  // onJoin pourra consommer via auth.userId.
  async onAuth(_client: Client, options: { token?: string; guestToken?: string; name?: string }): Promise<{
    userId: string | null;
    username: string | null;
    guestId: string | null;
    name: string;
  }> {
    const token = typeof options?.token === "string" && options.token.length > 0 ? options.token : null;
    const guestTok = typeof options?.guestToken === "string" && options.guestToken.length > 0 ? options.guestToken : null;
    const requestedName = sanitizeName(options?.name ?? "");
    if (token) {
      const user = await verifyAccessToken(token);
      if (user) {
        // Authed : un user authentifié n'a pas besoin de guest token, ses
        // trophées vont directement dans wallets.
        const finalName = user.username && user.username.length > 0 ? user.username : requestedName;
        return { userId: user.id, username: user.username, guestId: null, name: finalName };
      }
      // Token présent mais invalide/expiré → on dégrade en invité plutôt que
      // de refuser l'accès (l'UX côté client reflasher le token est plus
      // douce qu'un pop d'erreur). Le client peut détecter ça via /api/auth/me.
    }
    // Pas authed : si un guest token signé est fourni, on l'utilise pour
    // créditer les trophées dans guest_wallets ; sinon le joueur joue mais
    // ses trophées ne sont pas trackés.
    const guestId = guestTok ? verifyGuestToken(guestTok) : null;
    return { userId: null, username: null, guestId, name: requestedName };
  }

  onJoin(
    client: Client,
    _options: { name?: string; token?: string; guestToken?: string },
    auth: { userId: string | null; username: string | null; guestId: string | null; name: string },
  ): void {
    const p = new Player();
    p.id = client.sessionId;
    p.userId = auth?.userId ?? null;
    p.guestId = auth?.guestId ?? null;
    p.name = sanitizeName(auth?.name ?? "");
    const spawn = randomSpawnPoint(this.state);
    p.x = spawn.x; p.y = spawn.y;
    p.alive = true;
    p.spawnedAt = Date.now();
    p.spinPhase = Math.random() * Math.PI * 2;
    p.spinScale = 0.75 + Math.random() * 0.5;
    p.tier = 0;
    p.orbitTimeOffset = 0;
    p.spawnProtectionUntil = Date.now() + SPAWN_PROTECTION_MS;
    this.state.players.set(client.sessionId, p);
    for (let i = 0; i < INITIAL_BLADE_COUNT; i++) this.spawnInitialBladeFor(p);
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
    // Leave volontaire : cleanup immédiat.
    if (consented) {
      // Si le joueur était encore en vie (quit via menu), on persiste son
      // score actuel — sinon il aurait fait une "vraie" partie sans la voir
      // comptée au leaderboard.
      if (p.alive) this.persistMatchIfAuthed(p);
      this.cleanupPlayer(client.sessionId);
      return;
    }
    // Disconnect involontaire (réseau qui hoquète, proxy, mobile qui dort) :
    // on garde l'état 20 s pour permettre au client de se reconnecter via
    // client.reconnect(token) sans retour au menu.
    try {
      await this.allowReconnection(client, 20);
    } catch {
      const stale = this.state.players.get(client.sessionId);
      if (stale && stale.alive) this.persistMatchIfAuthed(stale);
      this.cleanupPlayer(client.sessionId);
    }
  }

  private cleanupPlayer(sessionId: string): void {
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
  // Idempotent par appelant : on n'appelle qu'une fois (à la mort, au
  // leave en vie, ou au timeout de reconnect).
  private persistMatchIfAuthed(p: Player): void {
    if (p.isBot) return;
    const trophies = Math.max(0, Math.floor(p.score));
    if (p.userId) {
      const survival = Math.max(0, (Date.now() - p.spawnedAt) / 1000);
      void recordMatch({
        userId: p.userId,
        score: p.score,
        kills: p.kills,
        maxBlades: p.maxBladeCount,
        survivalSeconds: survival,
        cratesDestroyed: p.cratesDestroyed,
        powerupsCollected: p.powerupsCollected,
        roomCode: this.roomCode || undefined,
      });
      if (trophies > 0) void creditWallet(p.userId, trophies);
      return;
    }
    if (p.guestId && trophies > 0) {
      void creditGuestWallet(p.guestId, trophies);
    }
  }

  private handleInput(client: Client, msg: InputMessage): void {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    const now = Date.now();
    if (now - p.inputWindowStart > 1000) { p.inputWindowStart = now; p.inputCount = 0; }
    p.inputCount++;
    if (p.inputCount > MAX_INPUT_RATE) return;
    const dx = Number.isFinite(msg.dx) ? msg.dx : 0;
    const dy = Number.isFinite(msg.dy) ? msg.dy : 0;
    const cdx = Math.max(-1, Math.min(1, dx));
    const cdy = Math.max(-1, Math.min(1, dy));
    p.inputDx = cdx; p.inputDy = cdy;
    p.inputBoost = !!msg.boost;
    // Edge-trigger : on ne consomme le throw qu'au tick suivant. Si un client
    // envoie throw=true plusieurs fois rapidement, on coalesce (le cooldown
    // côté processThrows fait foi de toute façon).
    if (msg.throw === true) p.inputThrow = true;
    if (typeof msg.seq === "number" && msg.seq > p.lastSeq) p.lastSeq = msg.seq >>> 0;
    p.lastInputAt = now;
  }

  private handleRespawn(client: Client, msg: RespawnMessage): void {
    const p = this.state.players.get(client.sessionId);
    if (!p || p.alive) return;
    if (msg?.name) p.name = sanitizeName(msg.name);
    const spawn = randomSpawnPoint(this.state);
    p.x = spawn.x; p.y = spawn.y;
    p.inputDx = 0; p.inputDy = 0; p.inputBoost = false;
    p.inputThrow = false;
    p.throwCooldownUntil = 0;
    p.alive = true; p.boost = false;
    p.bladeCount = 0; p.bladeIds = [];
    p.kills = 0; p.maxBladeCount = 0; p.score = 0;
    p.cratesDestroyed = 0; p.powerupsCollected = 0;
    p.spawnedAt = Date.now();
    p.lastKiller = null; p.violations = 0; p.lastSeq = 0;
    p.spinPhase = Math.random() * Math.PI * 2;
    p.spinScale = 0.75 + Math.random() * 0.5;
    p.tier = 0;
    p.hitlagUntil = 0;
    p.orbitTimeOffset = 0;
    p.knockbackVx = 0;
    p.knockbackVy = 0;
    p.recentLosses = [];
    p.spawnProtectionUntil = Date.now() + SPAWN_PROTECTION_MS;
    for (let i = 0; i < INITIAL_BLADE_COUNT; i++) this.spawnInitialBladeFor(p);
  }

  private tick(dt: number): void {
    this.elapsed += dt;
    this.state.tick++;
    if (this.botsEnabled) {
      this.maintainBots();
      this.bots.update(dt, this.state);
    }
    // Recalcule le tier de chaque joueur AVANT toutes les autres systèmes
    // (collision lit `tier` pour la hitbox, orbitPositions pour la rotation).
    // Émet un tierUp si on monte d'un palier — la chute (perte de lames)
    // ne broadcast pas pour ne pas spammer.
    this.state.players.forEach((p) => {
      if (!p.alive) return;
      const next = tierFromBladeCount(p.bladeCount);
      if (next > p.tier) {
        p.tier = next;
        const ev: TierUpEvent = { playerId: p.id, tier: next, x: p.x, y: p.y };
        this.broadcast("tierUp", ev);
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
    updateBladePositions(dt, this.elapsed, this.state, this.orbitCache);
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
      this.broadcast("pickup", { playerId: player.id, rarity: blade.rarity });
    });
    resolveCollisions(this.state, this.orbitCache, {
      onBladeDestroyed: (blade) => this.handleBladeDestroyed(blade),
      onPlayerKilled: (victim, killer) => this.killPlayer(victim, killer, "blades"),
      onCrateHit: (crate, attacker) => this.handleCrateHit(crate, attacker),
      onCrateDestroyed: (crate, attacker) => this.handleCrateDestroyed(crate, attacker),
      onClash: (info) => {
        const ev: ClashEvent = {
          aId: info.a.id,
          bId: info.b.id,
          x: (info.ax + info.bx) * 0.5,
          y: (info.ay + info.by) * 0.5,
          tier: info.tier,
          destroyed: info.destroyed,
        };
        this.broadcast("clash", ev);
      },
    });
    // Collisions des projectiles : APRÈS resolveCollisions pour que les
    // lames orbitantes restent référence (orbitCache à jour, position des
    // joueurs aussi). Les projectiles consomment leur "pierce" sur chaque
    // contact et se détruisent quand il atteint 0.
    resolveProjectileCollisions(this.state, throwCb, this.orbitCache);
    this.spawning.update(dt, this.state);
    this.crates.update(dt, this.state);
    this.powerups.update(dt, this.state, (player, pu) => this.handlePowerUpPickup(player, pu));
    // (Auto-fusion supprimée — la progression se fait par accumulation.)
    // Mise à jour du score composite pour tous les joueurs vivants (composante survival).
    this.state.players.forEach((p) => { if (p.alive) updateScore(p); });
    this.bots.cleanupDead(this.state);
  }

  // Callbacks partagés entre processThrows / updateProjectiles /
  // resolveProjectileCollisions. Reuse les helpers existants pour rester
  // cohérent avec le reste (kill drop, broadcast, score…).
  private makeThrowCallbacks() {
    return {
      onBladeThrown: (ev: BladeThrownEvent) => this.broadcast("bladeThrown", ev),
      onProjectileImpact: (ev: ProjectileImpactEvent) => this.broadcast("projectileImpact", ev),
      onPlayerKilled: (victim: Player, killer: Player | null) =>
        this.killPlayer(victim, killer, "throw"),
      onCrateHit: (crate: Crate, attacker: Player | null) =>
        this.handleCrateHit(crate, attacker),
      onCrateDestroyed: (crate: Crate, attacker: Player | null) =>
        this.handleCrateDestroyed(crate, attacker),
      onBladeDestroyed: (blade: Blade) => this.handleBladeDestroyed(blade),
    };
  }

  private handlePowerUpPickup(player: Player, pu: PowerUp): void {
    player.powerupsCollected++;
    updateScore(player);
    this.broadcast("powerupPickup", {
      playerId: player.id,
      type: pu.type,
      rarity: pu.rarity,
      x: pu.x,
      y: pu.y,
    });
  }

  private handleCrateHit(crate: Crate, _attacker: Player | null): void {
    this.broadcast("crateHit", { crateId: crate.id, x: crate.x, y: crate.y, hp: crate.hp });
  }

  private handleCrateDestroyed(crate: Crate, attacker: Player | null): void {
    if (attacker) {
      attacker.cratesDestroyed++;
      updateScore(attacker);
    }
    this.broadcast("crateDestroyed", { crateId: crate.id, x: crate.x, y: crate.y });
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

  private handleBladeDestroyed(blade: Blade): void {
    const cached = this.orbitCache.get(blade.id);
    const x = cached ? cached.x : blade.x;
    const y = cached ? cached.y : blade.y;
    this.broadcast("bladeDestroyed", {
      bladeId: blade.id, x, y, rarity: blade.rarity, ownerId: blade.ownerId,
    });
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
      const id = player.bladeIds.pop();
      if (!id) break;
      const b = this.state.blades.get(id);
      if (!b) continue;
      const ring = b.ringIndex;
      this.state.blades.delete(id);
      player.bladeCount = Math.max(0, player.bladeCount - 1);
      recompactOwnerRing(this.state, player.id, ring);
    }
  }

  private killPlayer(victim: Player, killer: Player | null, reason: string): void {
    if (!victim.alive) return;
    victim.alive = false;
    // Persiste le match juste après le passage à mort (avant le drop, mais
    // après que tous les compteurs de session ont été incrémentés au cours
    // de la vie). Pas de await : recordMatch gère ses propres erreurs et on
    // ne veut pas bloquer la game loop.
    this.persistMatchIfAuthed(victim);
    const bladeIds = [...victim.bladeIds];
    const dropCount = Math.floor(bladeIds.length * DEATH_DROP_RATIO);
    const droppedRarities: BladeRarity[] = [];
    for (let i = 0; i < bladeIds.length; i++) {
      const id = bladeIds[i];
      const b = this.state.blades.get(id);
      if (!b) continue;
      if (i < dropCount) droppedRarities.push(b.rarity);
      this.state.blades.delete(id);
    }
    victim.bladeIds = [];
    victim.bladeCount = 0;
    const now = Date.now();
    // Bonus "pertes récentes" : on prune la fenêtre, puis on drop 50 % des
    // lames cassées en clash dans les 10 dernières secondes. C'est ce qui
    // donne au tueur un butin cohérent avec le combat même si la victime
    // meurt à 0 lame en orbite.
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
      const speed = 3 + Math.random() * 2;
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
      updateScore(killer);
    }
    // Pas de killer humain → on étiquette la cause (border = "wall") pour que
    // le death screen affiche quand même un "killed by". Sinon la ligne
    // disparaît et le joueur ne sait pas pourquoi il est mort.
    const killerLabel =
      killer?.name ?? (reason === "wall" ? "GRID BORDER" : null);
    this.broadcast("playerKilled", {
      victimId: victim.id,
      killerId: killer?.id ?? null,
      victimName: victim.name,
      killerName: killerLabel,
    });
  }
}
