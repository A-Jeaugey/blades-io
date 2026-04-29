import { Schema, type, MapSchema } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") id: string = "";
  @type("string") name: string = "";
  @type("float32") x: number = 0;
  @type("float32") y: number = 0;
  @type("float32") dirX: number = 0;
  @type("float32") dirY: number = 1;
  @type("boolean") alive: boolean = true;
  @type("boolean") boost: boolean = false;
  @type("uint16") bladeCount: number = 0;
  @type("uint32") score: number = 0; // = bladeCount max atteint (leaderboard)
  @type("uint16") kills: number = 0;
  // Stats de session
  @type("float64") spawnedAt: number = 0;
  @type("uint16") maxBladeCount: number = 0;
  @type("uint16") cratesDestroyed: number = 0;
  @type("uint16") powerupsCollected: number = 0;
  // Dernière séquence d'input appliquée par le serveur — permet au client
  // de faire de l'input replay propre (reconciliation prédiction).
  @type("uint32") lastSeq: number = 0;
  // Phase + scale de rotation propres à chaque joueur. Sans ça, deux joueurs
  // avec le même nombre de lames sur le même anneau ont leurs blades en
  // phase pour toujours → les orbites se croisent mais les lames ne se
  // touchent JAMAIS (déphasage angulaire figé). Avec phase + scale random,
  // les orbites driftent les unes par rapport aux autres → collisions
  // garanties tôt ou tard.
  @type("float32") spinPhase: number = 0;
  @type("float32") spinScale: number = 1;
  // Les bots ne reçoivent pas d'input réseau, ils tournent en local.
  @type("boolean") isBot: boolean = false;
  // Fins d'effets actifs (timestamps ms, 0 si inactif). Lus par le moteur
  // de simulation (speed, spin des orbites, magnet, shield).
  @type("float64") speedUntil: number = 0;
  @type("float64") spinUntil: number = 0;
  @type("float64") magnetUntil: number = 0;
  @type("float64") shieldUntil: number = 0;
  // Fenêtre d'invulnérabilité au (re)spawn. Le joueur ne peut ni recevoir
  // ni infliger de dégât tant que cette date est dans le futur (cf.
  // SPAWN_PROTECTION_MS dans shared/constants).
  @type("float64") spawnProtectionUntil: number = 0;
  // Tier dérivé de bladeCount (0..2). Synchronisé pour que le client
  // puisse adapter la taille/forme/glow des lames sans avoir à recompter.
  @type("uint8") tier: number = 0;
  // Hitlag : pendant cette fenêtre (ms epoch), le joueur est figé en
  // mouvement ET en rotation orbitale (cf. orbitTimeOffset). Permet de
  // donner du poids au clash sans desync visuel client/serveur.
  @type("float64") hitlagUntil: number = 0;
  // Décalage de temps appliqué au calcul d'angle orbital. Le serveur
  // l'incrémente pendant le hitlag pour que (elapsed - orbitTimeOffset)
  // reste constant → les lames ne tournent plus, même côté client (qui
  // utilise ce champ synchronisé).
  @type("float32") orbitTimeOffset: number = 0;
  // Fin du cooldown de lancer (timestamp ms). Synchronisé pour que le
  // client puisse afficher l'état "ready" du bouton THROW.
  @type("float64") throwCooldownUntil: number = 0;

  // Champs non synchronisés (gestion serveur)
  inputDx: number = 0;
  inputDy: number = 0;
  inputBoost: boolean = false;
  // Edge-trigger consommé chaque tick par processThrows. Le client envoie
  // true ponctuellement à chaque appui, le serveur le remet à false après
  // traitement (ou après le tick si cooldown actif).
  inputThrow: boolean = false;
  lastInputAt: number = 0;
  inputCount: number = 0;
  inputWindowStart: number = 0;
  violations: number = 0;
  boostAccum: number = 0;
  lastKiller: string | null = null;
  // Liste ordonnée des IDs de lames possédées (ordre = ordre de récupération)
  bladeIds: string[] = [];
  // Velocity de knockback résiduelle (u/s). Décroît exponentiellement chaque
  // tick (cf. KNOCKBACK_DECAY) et s'ajoute à la vitesse de mouvement.
  knockbackVx: number = 0;
  knockbackVy: number = 0;
  // Buffer circulaire des lames perdues en clash (rareté + ts ms). Sert au
  // drop de mort : on restitue ~50 % des lames cassées dans les N dernières
  // secondes pour que le tueur loote un butin cohérent avec le combat
  // qu'il vient de gagner. Capé à RECENT_LOSS_BUFFER_CAP pour éviter
  // l'accumulation sur les longs combats.
  recentLosses: Array<{ rarity: number; ts: number }> = [];
}
