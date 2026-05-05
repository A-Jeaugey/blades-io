// Constantes de gameplay partagées entre client et serveur.
// Aucun nombre magique ne doit vivre ailleurs que dans ce fichier.

// --- Monde ---
export const MAP_RADIUS = 250;
export const WALL_KILL_THICKNESS = 2; // épaisseur de la zone fatale au bord

// --- Tick / réseau ---
// 60Hz tick : 16.7ms entre chaque update serveur, vs 50ms à 20Hz. Sur
// changement de direction / arrêt-reprise / spam de sprint, l'input
// se propage 3× plus vite à la simulation → plus de saccade perçue.
// Coût serveur : ~3× la conso CPU vs 20Hz (toujours < 5% sur 1 core
// moderne). Bandwidth : ~3× aussi (~120 KB/s par client en peak).
// Acceptable sur serveur dédié, marginal sur cloud à 60 joueurs.
export const SERVER_TICKRATE = 60; // Hz
export const SERVER_DT = 1 / SERVER_TICKRATE;
export const CLIENT_INPUT_RATE = 60; // Hz (matche le tickrate)
export const MAX_INPUT_RATE = 80; // rejets au-delà
export const MAX_INPUT_VIOLATIONS = 3;

// --- Joueur ---
export const PLAYER_SPEED = 11; // unités / seconde
export const PLAYER_BOOST_MULT = 1.7;
export const PLAYER_BODY_RADIUS = 0.6;
// Distance centre-à-centre minimale pour qu'un kill corps-à-corps déclenche
// (uniquement quand au moins un des deux joueurs n'a plus de lames).
export const PLAYER_BODY_COLLISION = 1.0;
// Marge ajoutée au rayon de l'orbite pour le push-out joueur-joueur (les
// orbites se touchent juste, sans se chevaucher).
export const PLAYER_ORBIT_PUSH_MARGIN = 0.05;
// Effectivement déplafonné : 500 = au-delà de ce qu'un joueur peut atteindre
// dans une partie normale. Le but du jeu reste "monter le plus haut score"
// (= maxBladeCount, leaderboard) — pas de plafond artificiel à 120.
export const MAX_BLADES_PER_PLAYER = 500;
export const INITIAL_BLADE_COUNT = 3;
export const BOOST_DRAIN_INTERVAL = 0.5; // une lame toutes les 0.5s de boost
export const LOW_BLADE_WARNING = 3;

// --- Orbites ---
// Ring 0 = anneau 1 (rayon 1.8, cap 12 lames). Ring n cap = 12 + n*6.
// Densité augmentée par rapport à l'ancien schéma (8 + n*4) pour que les
// cercles accueillent plus de lames — un joueur fort possède un mur dense
// de lames au lieu d'une ribambelle d'anneaux presque vides.
export const RING_BASE_RADIUS = 1.8;
export const RING_RADIUS_STEP = 0.8;
export const RING_BASE_CAP = 16;
export const RING_CAP_STEP = 8;
export const RING_BASE_ROT_SPEED = 5.5; // rad/s — base "agressive" pour
// que même un duel à 3 lames vs 3 lames produise des clashes répétés. À
// 2 rad/s les lames se croisaient sans se toucher (3 lames = 120° de gap,
// 100ms de contact ne couvrait que ~11° d'arc → "syndrome de la passoire").
export const RING_ROT_FALLOFF = 0.12; // -12% par anneau (réduit pour que
// les anneaux extérieurs gardent du peps).

// --- Vitesse de rotation dynamique (fonction du nombre de lames) ---
// Plus un joueur possède de lames, plus ses orbites tournent vite.
// Le multiplicateur est 1 + (bladeCount / BLADE_ROT_DIVISOR) * BLADE_ROT_MAX_BONUS,
// plafonné à 1 + BLADE_ROT_MAX_BONUS. Avec les valeurs par défaut :
//   3 lames  → ×1.03  (quasi nul)
//  15 lames  → ×1.15
//  30 lames  → ×1.30
//  60 lames  → ×1.60
// 100+ lames → ×2.00  (cap)
export const BLADE_ROT_DIVISOR = 100;    // nombre de lames pour atteindre le cap
export const BLADE_ROT_MAX_BONUS = 1.5;  // bonus max = ×2.5 au total

// --- Lames ---
// Hitbox de base d'une lame Tier 1. Les lames de tier supérieur multiplient
// cette valeur (cf. TIER_HITBOX_MULT). Hitbox volontairement décorrélée du
// sprite visuel : 2-3x plus large que la lame qu'on voit, pour forcer les
// contacts au tick 20 Hz et éliminer le "syndrome de la passoire".
export const BLADE_HITBOX = 0.7;
export const BLADE_COLLISION_COOLDOWN = 0.2; // s, par paire de lames

// --- Tiers (paliers de progression) ---
// Le tier d'un joueur est dérivé de bladeCount via tierFromBladeCount().
// Tier 0 (1-9 lames)  : petites flèches, vitesse standard, hitbox standard
// Tier 1 (10-19)      : épées larges, +rotation, hitbox x2
// Tier 2 (20+)        : faux/scies géantes, ++rotation, hitbox x3
export const TIER_THRESHOLDS = [1, 10, 20] as const;
export const TIER_COUNT = 3;

// Multiplicateur sur BLADE_HITBOX pour la collision : élargit la hitbox des
// joueurs montés en tier pour qu'ils touchent VRAIMENT. Tier 0 est aussi
// boosté (×1.5) pour résoudre le problème des combats à peu de lames :
// avec 3 lames à 120° d'écart, la hitbox angulaire passe d'environ 23° à
// 33° → contacts garantis dans la fenêtre de croisement de 100ms.
export const TIER_HITBOX_MULT: readonly number[] = [1.5, 2.2, 3.0];

// Multiplicateur sur RING_BASE_ROT_SPEED. Progression resserrée : la base
// 5.5 rad/s donne déjà du peps à T0, et le saut T1→T2 précédent était
// trop violent (8.25 rad/s = illisible). Ici T0 5.5, T1 6.3, T2 7.2.
export const TIER_ROT_MULT: readonly number[] = [1.0, 1.15, 1.3];

// Multiplicateur sur l'échelle visuelle des lames (en plus de RARITY_SCALE).
// Volontairement modéré : à Tier 2, RARITY_SCALE Legendary (1.7) × 1.55 ×
// 20 instances émissives + bloom = washout blanc sinon. La progression
// reste lisible (T1 +25 %, T2 +55 %) sans nécessiter de géométrie dédiée.
export const TIER_VISUAL_SCALE: readonly number[] = [1.0, 1.25, 1.55];

// Intensité du knockback (force initiale en u/s) appliquée à chaque clash,
// multipliée par le tier de la lame qui frappe.
export const KNOCKBACK_BASE = 8.0;
export const KNOCKBACK_TIER_MULT: readonly number[] = [1.0, 1.7, 2.6];
// Décroissance du knockback (s) : durée pendant laquelle la velocity de
// recul s'amortit exponentiellement avant de devenir négligeable.
export const KNOCKBACK_DECAY = 0.18;

// Hitlag : micro-pause sur le mouvement et la rotation orbitale du joueur
// touché, pour donner du poids à l'impact. Tier-aware.
export const HITLAG_DURATION_MS: readonly number[] = [50, 75, 110];

// Intensité de screen shake déclenchée pour le joueur local quand une de
// ses lames clashe. Tier-aware. Plus généreux que le hit-confirm classique.
export const CLASH_SHAKE_INTENSITY: readonly number[] = [0.18, 0.32, 0.55];

// Intensité de shake quand le joueur local change de tier.
export const TIER_UP_SHAKE: readonly number[] = [0.0, 0.35, 0.55];

// --- Throw (lancer de lame) ---
// Cooldown entre deux lancers (ms). Volontairement court (0.5 s) : il faut
// que ça reste un outil de combat actif, pas un sort à long cooldown.
export const THROW_COOLDOWN_MS = 500;
// Vitesse du projectile (u/s). Sensiblement plus rapide qu'un joueur (11 u/s
// boost ~19 u/s), sinon trop facile à esquiver à 60 u/s d'écart en 3 s.
export const THROW_PROJECTILE_SPEED = 38;
// Durée de vie max d'un projectile (ms) avant despawn d'office. Sécurité
// au cas où le calcul de portée raterait — en pratique, le projectile se
// pose au sol bien avant (cf. THROW_PROJECTILE_MAX_RANGE).
export const THROW_PROJECTILE_TTL_MS = 3000;
// Portée maximale d'un projectile (unités monde). Quand le projectile a
// parcouru cette distance depuis le point de lancer sans rien toucher, il
// retombe au sol et redevient ramassable (par n'importe qui, y compris
// le lanceur après un court délai). Calé pour que le throw reste un outil
// tactique de courte/moyenne portée — pas un sniper cross-map.
export const THROW_PROJECTILE_MAX_RANGE = 30;
// Délai (ms) avant qu'une lame fraîchement posée au sol après un throw
// puisse être ramassée. Évite que le lanceur n'auto-récupère sa lame s'il
// finit son lancer en marchant droit dessus.
export const THROW_LANDED_PICKUP_LOCK_MS = 250;
// "Pierce" = nombre de cibles que peut traverser le projectile. Une cible
// = un joueur (ou son orbite) ou une caisse. La lame est détruite quand le
// compteur atteint 0.
//   Common / Rare : 1  (premier impact = destruction)
//   Epic           : 2  (traverse 1 cible)
//   Legendary      : 3  (traverse 2 cibles)
export const THROW_PIERCE: Record<number /* BladeRarity */, number> = {
  0: 1, // Common
  1: 1, // Rare
  2: 2, // Epic
  3: 3, // Legendary
};
// Hitbox d'un projectile (légèrement plus généreuse qu'une lame en orbite
// pour que ça "accroche" même au tick 20 Hz).
export const THROW_PROJECTILE_HITBOX = 0.85;

// --- Spawn protection ---
// Délai d'invulnérabilité au spawn / respawn. Le serveur met à load
// (l'arrivée d'un nouveau client + chargement du state Colyseus prend
// quelques 100ms) et avant le fix on pouvait être shred dans un duel
// avant même de voir le HUD. Pendant cette fenêtre :
//  - les lames du joueur ne peuvent pas être détruites en clash
//  - son corps ne peut pas être touché par des lames adverses
//  - il ne peut pas être tué par body-vs-body (sans lame)
//  - les murs ne le tuent pas (par cohérence — il spawn loin du bord)
// En contrepartie ses propres lames ne font pas de dégât non plus
// (pas de "spawn camp offensif" possible).
export const SPAWN_PROTECTION_MS = 2500;
// Rayon de ramassage : généreux pour que ça "accroche" dès qu'on frôle.
export const PICKUP_RADIUS = 2.8;
// Attraction magnétique : au-delà du ramassage direct, la lame se dirige
// vers le joueur le plus proche. Fait que le ramassage feel "juicy".
export const PICKUP_MAGNET_RADIUS = 5.5;
export const PICKUP_MAGNET_STRENGTH = 18; // u/s appliqués, atténués avec la distance
export const GROUND_BLADE_FRICTION = 3.5;
// Durée max avant qu'une lame au sol non ramassée ne s'évapore. Sans ça
// les drops de morts/caisses s'accumulent sans fin et la map se bloque.
export const GROUND_BLADE_TTL_MS = 15000; // 15 s

// --- Spawn ambiant ---
// Densité modérée : assez pour pas mourir de faim, pas trop pour que la
// map reste lisible. Le TTL court (15 s) garantit qu'une lame non-ramassée
// disparaît vite.
export const AMBIENT_SPAWN_INTERVAL = 1.0;
export const AMBIENT_MAX_BASE = 400;
export const AMBIENT_PER_PLAYER = 18;
export const AMBIENT_MIN_DIST_FROM_PLAYER = 10;
export const AMBIENT_SPAWN_BURST = 20; // max de spawns par tick
export const AMBIENT_MIN_FLOOR = 35; // toujours au moins N lames au sol

// --- Mort / drop ---
// Fraction des lames en orbite dropées au sol à la mort. 0.7 → le tueur
// peut récupérer 70 % du stockpile orbital de la victime (en plus des
// pertes récentes, cf. plus bas). Avant à 0.5 le kill se sentait peu
// rentable face à un joueur loaded.
export const DEATH_DROP_RATIO = 0.7;
// Distances de spawn des drops autour de la victime. Volontairement
// resserrées (1-3.5) pour que les lames atterrissent toutes DANS le
// PICKUP_MAGNET_RADIUS (5.5) après prise en compte de la trajectoire
// initiale (speed 2-3 + friction 3.5 = +0.4 à +1.0 unité). Avant à
// 2-6 + speed 3-5 → final 5-9 unités, hors d'aimant pour la moitié
// des drops → le tueur les ratait.
export const DEATH_DROP_MIN_DIST = 1;
export const DEATH_DROP_MAX_DIST = 3.5;
// Vitesse initiale radiale des lames lâchées à la mort (u/s). Donne le
// "burst" visuel sans projeter les lames hors d'aimant. Friction
// GROUND_BLADE_FRICTION les arrête en ~0.6-1.0 s.
export const DEATH_DROP_SPEED_MIN = 2;
export const DEATH_DROP_SPEED_MAX = 3;
// Bonus de drop : pertes "récentes" cumulées en clash dans cette fenêtre
// (ms). Évite que tuer un ennemi qui finit forcément à 0 lames donne 0 loot,
// sans pour autant resservir l'historique entier de la partie.
export const RECENT_LOSS_WINDOW_MS = 10000;
export const RECENT_LOSS_BUFFER_CAP = 12;
// Fraction des pertes récentes effectivement dropées à la mort (en plus du
// DEATH_DROP_RATIO classique appliqué aux lames encore en orbite). 1.0 =
// le tueur récupère 100 % de ce que la victime a cramé dans les 10 dernières
// secondes — encourage l'aggro.
export const RECENT_LOSS_DROP_RATIO = 1.0;

// --- Raretés ---
export enum BladeRarity {
  Common = 0,
  Rare = 1,
  Epic = 2,
  Legendary = 3,
}

export const RARITY_DAMAGE: Record<BladeRarity, number> = {
  [BladeRarity.Common]: 1,
  [BladeRarity.Rare]: 2,
  [BladeRarity.Epic]: 4,
  [BladeRarity.Legendary]: 8,
};

// HP = damage de la rareté courante. Conséquence : il faut 2 coups d'une
// lame de rareté N pour casser une de rareté N+1 (HP_N+1 = 2*DMG_N).
export const RARITY_HP: Record<BladeRarity, number> = {
  [BladeRarity.Common]: 1,
  [BladeRarity.Rare]: 2,
  [BladeRarity.Epic]: 4,
  [BladeRarity.Legendary]: 8,
};

// (Auto-fusion des lames supprimée — la progression se fait maintenant
//  uniquement par accumulation de lames, avec une rotation dynamique
//  qui augmente proportionnellement au nombre possédé.)

// --- Power-ups ---
// Orbes au sol qui donnent un bonus temporaire quand un joueur les touche.
// Durée proportionnelle à la rareté ; BLADES est instant (+X lames).
export enum PowerUpType {
  Speed = 0,    // +mouvement
  Spin = 1,     // +vitesse rotation orbites
  Magnet = 2,   // +rayon d'aimant sur lames au sol
  Shield = 3,   // lames en orbite regen leurs HP et deviennent temporairement "blindées"
  Blades = 4,   // instant : +N lames Common attachées
}

export const POWERUP_TYPE_VALUES: PowerUpType[] = [
  PowerUpType.Speed,
  PowerUpType.Spin,
  PowerUpType.Magnet,
  PowerUpType.Shield,
  PowerUpType.Blades,
];

// Couleurs distinctes par type (indépendantes des raretés de lames).
export const POWERUP_COLOR: Record<PowerUpType, number> = {
  [PowerUpType.Speed]: 0xffd700,  // jaune
  [PowerUpType.Spin]: 0x00e5ff,   // cyan
  [PowerUpType.Magnet]: 0xb14bff, // violet
  [PowerUpType.Shield]: 0xffffff, // blanc
  [PowerUpType.Blades]: 0x22ff88, // vert
};

// Durée des effets selon la rareté du power-up (en secondes). La dernière
// entrée = rareté 3 ~= "quasi permanent" pour une partie normale.
export const POWERUP_DURATION: Record<BladeRarity, number> = {
  [BladeRarity.Common]: 12,
  [BladeRarity.Rare]: 25,
  [BladeRarity.Epic]: 45,
  [BladeRarity.Legendary]: 90,
};

// Multiplicateurs d'effets (constants, ne dépendent pas de la rareté).
export const POWERUP_SPEED_MULT = 1.35;     // +35 % vitesse
export const POWERUP_SPIN_MULT = 1.6;       // +60 % vitesse de rotation
export const POWERUP_MAGNET_MULT = 2.0;     // x2 rayon d'aimant
export const POWERUP_SHIELD_DMG_REDUC = 0.5; // dégâts reçus par les lames divisés par 2

// BLADES : combien de lames Common instantanément selon rareté du power-up.
export const POWERUP_BLADES_COUNT: Record<BladeRarity, number> = {
  [BladeRarity.Common]: 2,
  [BladeRarity.Rare]: 4,
  [BladeRarity.Epic]: 7,
  [BladeRarity.Legendary]: 12,
};

// Spawn : plusieurs power-ups toujours sur la map, bien visibles (pilier
// lumineux côté client). Density suffisante pour que le joueur en croise
// un en 20-30 s de jeu.
// HITBOX 2.8 (vs 1.4 avant) : passer "à proximité" d'un power-up suffit
// maintenant à le ramasser sans avoir à viser pile son centre. Plus
// gameplay-friendly à 60 joueurs où on bouge vite et où rater un
// power-up ramassé par l'ennemi à 0.3u près était frustrant.
export const POWERUP_HITBOX = 2.8;            // rayon de ramassage (très généreux)
export const POWERUP_SCALE = 1.3;             // taille visuelle (octaèdre)
export const POWERUP_SPAWN_INTERVAL = 2.0;    // s
export const POWERUP_MAX_TOTAL = 12;
export const POWERUP_MIN_FLOOR = 6;
export const POWERUP_PER_PLAYER = 2;
export const POWERUP_MIN_DIST_FROM_PLAYER = 12;

// Distribution de rareté des power-ups (plus stingy que les caisses car
// l'effet est lourd).
export const POWERUP_RARITY_WEIGHTS: Array<{ rarity: BladeRarity; weight: number }> = [
  { rarity: BladeRarity.Common, weight: 0.55 },
  { rarity: BladeRarity.Rare, weight: 0.3 },
  { rarity: BladeRarity.Epic, weight: 0.12 },
  { rarity: BladeRarity.Legendary, weight: 0.03 },
];

// Distribution de type (indépendante de la rareté).
export const POWERUP_TYPE_WEIGHTS: Array<{ type: PowerUpType; weight: number }> = [
  { type: PowerUpType.Speed, weight: 0.25 },
  { type: PowerUpType.Spin, weight: 0.25 },
  { type: PowerUpType.Magnet, weight: 0.15 },
  { type: PowerUpType.Shield, weight: 0.2 },
  { type: PowerUpType.Blades, weight: 0.15 },
];

// --- Loot crates ---
// Caisses néon plantées sur la map. Encaissent les dégâts des lames qui les
// frôlent (HP = CRATE_HP) et droppent un paquet de lames de rareté biaisée
// vers le haut quand elles cassent.
export const CRATE_HP = 12;
export const CRATE_HITBOX = 1.1;
export const CRATE_SCALE = 1.4;
export const CRATE_SPAWN_INTERVAL = 4.0;
export const CRATE_MAX_TOTAL = 14;
export const CRATE_MIN_FLOOR = 6;
export const CRATE_PER_PLAYER = 2;
export const CRATE_MIN_DIST_FROM_PLAYER = 12;
export const CRATE_DROP_MIN = 4;
export const CRATE_DROP_MAX = 7;
export const CRATE_DROP_SPEED = 5;
export const CRATE_LOOT_WEIGHTS: Array<{ rarity: BladeRarity; weight: number }> = [
  { rarity: BladeRarity.Common, weight: 0.35 },
  { rarity: BladeRarity.Rare, weight: 0.4 },
  { rarity: BladeRarity.Epic, weight: 0.2 },
  { rarity: BladeRarity.Legendary, weight: 0.05 },
];

// --- Bots ---
export const BOT_MIN_PLAYERS = 15;
export const BOT_MAX_TOTAL = 10;
export const BOT_THINK_INTERVAL = 0.4;
export const BOT_NAMES = [
  "Courgette", "Ananas", "Poulet", "Saucisson", "Baguette", "Fromage",
  "Tomate", "Brocoli", "Fraise", "Steak", "Raclette", "Croissant"
];

export const RARITY_SCALE: Record<BladeRarity, number> = {
  [BladeRarity.Common]: 1.0,
  [BladeRarity.Rare]: 1.2,
  [BladeRarity.Epic]: 1.4,
  [BladeRarity.Legendary]: 1.7,
};

export const RARITY_COLOR: Record<BladeRarity, number> = {
  [BladeRarity.Common]: 0xffffff,
  [BladeRarity.Rare]: 0x00e5ff,
  [BladeRarity.Epic]: 0xb14bff,
  [BladeRarity.Legendary]: 0xff2ea8,
};

// Probabilités cumulées pour le tirage ambiant
export const RARITY_SPAWN_WEIGHTS: Array<{ rarity: BladeRarity; weight: number }> = [
  { rarity: BladeRarity.Common, weight: 0.7 },
  { rarity: BladeRarity.Rare, weight: 0.22 },
  { rarity: BladeRarity.Epic, weight: 0.07 },
  { rarity: BladeRarity.Legendary, weight: 0.01 },
];

// --- Spatial hash ---
export const SPATIAL_CELL_SIZE = 5;

// --- Salle ---
export const MAX_PLAYERS_PER_ROOM = 60;

// --- Scoring (leaderboard composite) ---
export const SCORE_KILL = 15;
export const SCORE_BLADE = 1;           // par lame actuelle (monte ET baisse)
export const SCORE_SURVIVAL_PTS = 1;
export const SCORE_SURVIVAL_INTERVAL = 10; // secondes
export const SCORE_CRATE = 3;
export const SCORE_POWERUP = 2;

// --- Chat ---
// Longueur max d'un message — coupe au-delà côté serveur. 200 est
// largement assez pour une réplique courte sans permettre du spam de
// pavés qui inonderaient le panneau.
export const CHAT_MESSAGE_MAX_LENGTH = 200;
// Rate limit : N messages par fenêtre de WINDOW_MS par joueur. Protège
// contre le spam (un user/bot ne peut pas crever le débit en envoyant
// 100 msg/s). Au-delà, le serveur rejette silencieusement.
export const CHAT_RATE_LIMIT_COUNT = 4;
export const CHAT_RATE_LIMIT_WINDOW_MS = 5000;
// Plafond de messages côté client. Au-delà, on drop les plus anciens
// (FIFO). Évite que la log grossisse indéfiniment en mémoire / DOM.
export const CHAT_LOG_CAP = 50;

// --- Divers ---
export const NAME_MIN_LENGTH = 3;
export const NAME_MAX_LENGTH = 16;
