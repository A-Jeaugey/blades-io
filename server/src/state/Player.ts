import { Schema, type, view, MapSchema } from "@colyseus/schema";

// Champs qui ne servent qu'au client du joueur lui-même (prédiction, HUD,
// écran de mort) : envoyés à lui seul, sa vue porte ce tag (InterestManager,
// tâche 2.3). Les autres clients n'en avaient pas l'usage ; dirX/dirY
// changeaient presque à chaque tick pour chaque bot, le quart des octets
// reçus par client.
export const OWNER_VIEW_TAG = 1;

export class Player extends Schema {
  @type("string") id: string = "";
  @type("string") name: string = "";
  @type("float32") x: number = 0;
  @type("float32") y: number = 0;
  // Dernière direction de marche : celle d'un lancer sans visée.
  @view(OWNER_VIEW_TAG) @type("float32") dirX: number = 0;
  @view(OWNER_VIEW_TAG) @type("float32") dirY: number = 1;
  @type("boolean") alive: boolean = true;
  @type("boolean") boost: boolean = false;
  @type("uint16") bladeCount: number = 0;
  @type("uint32") score: number = 0; // score composite, cf. systems/scoring.ts
  // Stats de session (écran de mort, record local).
  @view(OWNER_VIEW_TAG) @type("uint16") kills: number = 0;
  @view(OWNER_VIEW_TAG) @type("float64") spawnedAt: number = 0;
  @view(OWNER_VIEW_TAG) @type("uint16") maxBladeCount: number = 0;
  @view(OWNER_VIEW_TAG) @type("uint16") cratesDestroyed: number = 0;
  @view(OWNER_VIEW_TAG) @type("uint16") powerupsCollected: number = 0;
  // Dernier input appliqué par le serveur : le client rejoue ceux d'après
  // (prédiction, tâche 1.2).
  @view(OWNER_VIEW_TAG) @type("uint32") lastSeq: number = 0;
  // Recul résiduel (u/s), amorti à chaque pas (cf. stepMovement).
  // Synchronisé : le client le rejoue avec ses inputs non acquittés.
  @view(OWNER_VIEW_TAG) @type("float32") knockbackVx: number = 0;
  @view(OWNER_VIEW_TAG) @type("float32") knockbackVy: number = 0;
  // Phase + scale de rotation propres à chaque joueur. Sans ça, deux joueurs
  // avec le même nombre de lames sur le même anneau ont leurs blades en
  // phase pour toujours → les orbites se croisent mais les lames ne se
  // touchent JAMAIS (déphasage angulaire figé). Avec phase + scale random,
  // les orbites driftent les unes par rapport aux autres → collisions
  // garanties tôt ou tard.
  @type("float32") spinPhase: number = 0;
  // Pas synchronisé : le client reçoit orbitRate, qui l'intègre.
  spinScale: number = 1;
  // Les bots ne reçoivent pas d'input réseau, ils tournent en local.
  @type("boolean") isBot: boolean = false;
  // Fins d'effets actifs (timestamps ms, 0 si inactif). Lus par le moteur
  // de simulation (speed, spin des orbites, magnet, shield), et par le HUD
  // et la prédiction du joueur lui-même.
  @view(OWNER_VIEW_TAG) @type("float64") speedUntil: number = 0;
  @view(OWNER_VIEW_TAG) @type("float64") spinUntil: number = 0;
  @view(OWNER_VIEW_TAG) @type("float64") magnetUntil: number = 0;
  @view(OWNER_VIEW_TAG) @type("float64") shieldUntil: number = 0;
  // Fenêtre d'invulnérabilité au (re)spawn. Le joueur ne peut ni recevoir
  // ni infliger de dégât tant que cette date est dans le futur (cf.
  // SPAWN_PROTECTION_MS dans shared/constants).
  @type("float64") spawnProtectionUntil: number = 0;
  // Tier dérivé de bladeCount (0..2). Synchronisé pour que le client
  // puisse adapter la taille/forme/glow des lames sans avoir à recompter.
  @type("uint8") tier: number = 0;
  // Hitlag : pendant cette fenêtre (ms epoch), le déplacement du joueur est
  // figé (ses orbites tournent). Donne du poids au clash.
  @view(OWNER_VIEW_TAG) @type("float64") hitlagUntil: number = 0;
  // Horloge d'orbite θ (cf. orbitThetaAt dans shared) : θ vaut orbitPhase
  // au tick orbitTick puis avance de orbitRate par seconde de jeu. Recalée
  // uniquement quand la vitesse change (ramassage, perte de lame, tier,
  // Spin, hitlag) : le client calcule l'angle exact de chaque lame à
  // n'importe quel tick sans dépendre de sa propre horloge. orbitRate est
  // arrondi en float32 dès le calcul : serveur et clients utilisent la même
  // valeur exacte.
  @type("float64") orbitPhase: number = 0;
  @type("uint32") orbitTick: number = 0;
  @type("float32") orbitRate: number = 0;
  // Fin du cooldown de lancer (timestamp ms). Synchronisé pour que le
  // client puisse afficher l'état "ready" du bouton THROW.
  @view(OWNER_VIEW_TAG) @type("float64") throwCooldownUntil: number = 0;
  // Niveau de compte (tâche 5.2), affiché dans les nametags ; 0 pour un bot
  // (pas de niveau inventé, cf. décision D8).
  @type("uint16") level: number = 0;
  // Cosmétiques équipés (tâche 6.1), validés au join ; "" = apparence de
  // base. Les bots n'en portent pas.
  @type("string") skin: string = "";
  @type("string") bladeSkin: string = "";
  @type("string") trail: string = "";
  @type("string") killFx: string = "";
  // Équipe (modes équipe, tâche 7.2) : 0 hors équipe, 1 ou 2.
  @type("uint8") team: number = 0;

  // Champs non synchronisés (gestion serveur)
  // ID Supabase auth.users du joueur authentifié ; null pour les invités et
  // les bots. Utilisé à la mort pour persister le score dans la table
  // matches (via le service role).
  userId: string | null = null;
  // ID guest_wallets pour les joueurs non authentifiés (token guest signé
  // côté serveur). null pour les bots, les anonymes sans token, et les
  // joueurs authentifiés. À la mort, on credit guest_wallets au lieu de
  // matches.
  guestId: string | null = null;
  // XP du compte ou du portefeuille invité, lue au join et augmentée des
  // trophées crédités à chaque fin de vie (cf. levelForXp).
  xp: number = 0;
  // Visible de tous, même dans un buisson (porteur d'un drapeau) : zones
  // d'intérêt, bots et minimap.
  revealed: boolean = false;
  // Input courant : celui des bots, ou le dernier appliqué pour un humain.
  inputDx: number = 0;
  inputDy: number = 0;
  inputBoost: boolean = false;
  // Inputs reçus, pas encore appliqués (un pas chacun, dans l'ordre).
  inputQueue: Array<{ dx: number; dy: number; boost: boolean; seq: number }> = [];
  // Dernier seq mis en file (les doublons et les inputs en retard sont
  // ignorés) et crédit de pas (cf. MAX_STEP_CREDIT).
  lastQueuedSeq: number = 0;
  stepCredit: number = 0;
  // Edge-trigger consommé chaque tick par processThrows. Le client envoie
  // true ponctuellement à chaque appui, le serveur le remet à false après
  // traitement (ou après le tick si cooldown actif).
  inputThrow: boolean = false;
  // Pas de nouveau hitlag avant cette date (ms epoch) : fin du gel en cours
  // + HITLAG_COOLDOWN_MS.
  hitlagReadyAt: number = 0;
  // Période de grâce (ms epoch) : les bots ignorent le joueur jusqu'à
  // graceUntil, puis ne le poursuivent que de près jusqu'à graceRampUntil.
  // Remises à 0 dès qu'il lance ou que ses lames touchent quelqu'un (cf.
  // SPAWN_GRACE_MS). Jamais posées pour un bot.
  graceUntil: number = 0;
  graceRampUntil: number = 0;
  // Visée du lancer en attente, normalisée (0, 0 = aucune : le lancer suit
  // la direction de déplacement). Écrite avec inputThrow (handleInput, bots),
  // consommée par processThrows.
  aimX: number = 0;
  aimY: number = 0;
  inputCount: number = 0;
  inputWindowStart: number = 0;
  violations: number = 0;
  boostAccum: number = 0;
  lastKiller: string | null = null;
  // Liste ordonnée des IDs de lames possédées (ordre = ordre de récupération)
  bladeIds: string[] = [];
  // Buffer circulaire des lames perdues en clash (rareté + ts ms). Sert au
  // drop de mort : on restitue les lames cassées dans les N dernières
  // secondes (RECENT_LOSS_DROP_RATIO, 100 % aujourd'hui) pour que le
  // tueur loote un butin cohérent avec le combat
  // qu'il vient de gagner. Capé à RECENT_LOSS_BUFFER_CAP pour éviter
  // l'accumulation sur les longs combats.
  recentLosses: Array<{ rarity: number; ts: number }> = [];
  // Timestamps (ms) des messages chat récents, sliding window pour le
  // rate limit. La logique : à chaque chat reçu on prune les entries
  // < (now - CHAT_RATE_LIMIT_WINDOW_MS), si le tableau a déjà
  // CHAT_RATE_LIMIT_COUNT entrées le message est rejeté silencieusement.
  chatTimestamps: number[] = [];
  // Modération (tâche 5.6) : messages masqués récents (récidive), silence
  // imposé jusqu'à, derniers messages (joints à un signalement, texte
  // d'origine), joueurs déjà signalés et heures des signalements envoyés.
  chatStrikes: number[] = [];
  chatMutedUntil: number = 0;
  recentChat: Array<{ text: string; ts: number }> = [];
  reportedIds: Set<string> = new Set();
  reportTimes: number[] = [];
  // Télémétrie (tâche 4.8, cf. telemetry.ts) : rang de la vie dans la
  // session (1 = première), première partie sur l'appareil (déclarée par le
  // client), et compteurs de la vie en cours, remis à zéro au respawn.
  lifeIndex: number = 1;
  newcomer: boolean = false;
  lifeThrows: number = 0;
  lifeThrowHits: number = 0;
  lifeBoostMs: number = 0;
  lifeMaxTier: number = 0;
  // Temps passé leader pendant la vie (télémétrie de la tâche 4.2).
  lifeLeaderMs: number = 0;
  // Trophées gagnés en primes de leader et en kills « underdog » pendant la
  // vie (tâche 4.2) : ajoutés au score composite.
  bonusScore: number = 0;
  // Défis (tâche 5.3) : éliminations d'un joueur qui avait plus de lames
  // au début de l'échange, et du leader.
  lifeBiggerKills: number = 0;
  lifeLeaderKills: number = 0;
}
