// Constantes de gameplay partagées entre client et serveur.
// Aucun nombre magique ne doit vivre ailleurs que dans ce fichier.

// --- Monde ---
export const MAP_RADIUS = 250;
export const WALL_KILL_THICKNESS = 2; // épaisseur de la zone fatale au bord

// --- Tick / réseau ---
// 60Hz tick : 16.7ms entre chaque update serveur, vs 50ms à 20Hz. Sur
// changement de direction / arrêt-reprise / spam de sprint, l'input
// se propage 3× plus vite à la simulation → plus de saccade perçue.
// Coût mesuré (tools/bench-server.js, 60 bots, 2026-09) : tick moyen de
// 2,0 ms après les tâches 2.1 et 2.2 du plan (9,7 ms avant), et ~95 Ko/s
// envoyés par client (patchs à 60 Hz eux aussi).
export const SERVER_TICKRATE = 60; // Hz
export const SERVER_DT = 1 / SERVER_TICKRATE;
export const MAX_INPUT_RATE = 80; // rejets au-delà
// File d'inputs par joueur (tâche 1.2) : chaque input reçu vaut un pas de
// SERVER_DT, appliqué dans l'ordre. Le serveur accumule un crédit d'un pas
// par SERVER_DT écoulé (pas de speed-hack en envoyant plus vite), jusqu'à
// MAX_STEP_CREDIT pour rattraper un à-coup réseau (≈ 166 ms), et ne garde
// pas plus de MAX_INPUT_QUEUE inputs en attente.
export const MAX_STEP_CREDIT = 10;
export const MAX_INPUT_QUEUE = 20;
// Nombre de secondes CONSÉCUTIVES au-dessus de MAX_INPUT_RATE avant
// déconnexion. Consécutives : une rafale isolée (paquets retenus pendant un
// hoquet réseau puis livrés d'un coup) ne doit pas expulser un joueur
// légitime, qui envoie un input par SERVER_DT (60 par seconde).
export const MAX_INPUT_VIOLATIONS = 3;
// Code de fermeture WebSocket envoyé au client expulsé pour flood d'inputs.
// La plage 4000-4999 revient aux applications, mais Colyseus en garde 4000
// à 4010 (4003, l'ancienne valeur, y signale un échec de reconnexion).
export const CLOSE_CODE_INPUT_FLOOD = 4100;

// --- Joueur ---
export const PLAYER_SPEED = 11; // unités / seconde
export const PLAYER_BOOST_MULT = 1.7;
export const PLAYER_BODY_RADIUS = 0.6;
// Distance centre-à-centre minimale pour qu'un kill corps-à-corps déclenche
// (uniquement quand au moins un des deux joueurs n'a plus de lames).
export const PLAYER_BODY_COLLISION = 1.0;
// Latence de l'attaquant humain : il se voit au présent (prédiction) et voit
// sa cible ~80 ms dans le passé (interpolation), et l'élimination s'affiche
// au tick de rendu. Quand il fonce sur elle, elle semblait donc entrer dans
// ses lames d'autant (1,5 à 2,5 u au boost) avant de mourir. Ses lames
// portent plus loin de ce qu'il parcourt vers elle en KILL_LAG_ALLOWANCE_MS,
// au plus KILL_LAG_REACH_MAX. Pas les bots, qui jouent au présent.
export const KILL_LAG_ALLOWANCE_MS = 100;
export const KILL_LAG_REACH_MAX = 1.5;
// Marge ajoutée au rayon de l'orbite pour le push-out joueur-joueur (les
// orbites se touchent juste, sans se chevaucher).
export const PLAYER_ORBIT_PUSH_MARGIN = 0.05;
// Effectivement déplafonné : bien au-delà de ce qu'une partie normale permet
// (au banc de 60 bots, le plus gros plafonne vers 20 lames). Le but du jeu
// reste "monter le plus haut score" (= maxBladeCount, leaderboard). À 2000
// lames, 21 anneaux et 17,8 u de rayon : la caméra recule jusque-là
// (CAMERA_ZOOM_MAX) et le serveur encaisse le contact de deux orbites
// pleines (narrowPhaseClash ne teste que leur zone de recouvrement).
export const MAX_BLADES_PER_PLAYER = 2000;
export const INITIAL_BLADE_COUNT = 3;
export const BOOST_DRAIN_INTERVAL = 0.5; // une lame toutes les 0.5s de boost
// Lames dépensées au boost (tâche 4.13) : elles se posent au sol juste
// derrière le joueur, comme la traînée de slither.io, au lieu de
// disparaître. Tout le monde peut les ramasser, leur semeur compris : faire
// demi-tour pour les reprendre coûte le temps gagné en boostant. Fuir en
// boostant nourrit son poursuivant ; poursuivre sur la même ligne ne coûte
// presque plus rien. Le plafond des lames ambiantes compte ces drops :
// quand il y en a beaucoup au sol, il en apparaît moins ailleurs.
// BOOST_DROP_RATIO : part des lames dépensées qui tombent (le reste
// disparaît, comme avant).
export const BOOST_DROP_RATIO = 1;
// Distance derrière le centre du joueur (u) et élan vers l'arrière (u/s).
export const BOOST_DROP_BACK = 1;
export const BOOST_DROP_SPEED = 1.5;
export const LOW_BLADE_WARNING = 3;

// --- Orbites ---
// Ring 0 = anneau 1 (rayon 1.8, cap 16 lames). Ring n cap = 16 + n*8.
// Densité augmentée par rapport aux anciens schémas (8 + n*4, puis
// 12 + n*6) pour que les cercles accueillent plus de lames — un joueur
// fort possède un mur dense de lames au lieu d'une ribambelle d'anneaux
// presque vides.
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
//   3 lames  → ×1.045 (quasi nul)
//  15 lames  → ×1.225
//  30 lames  → ×1.45
//  60 lames  → ×1.9
// 100+ lames → ×2.5   (cap)
export const BLADE_ROT_DIVISOR = 100;    // nombre de lames pour atteindre le cap
export const BLADE_ROT_MAX_BONUS = 1.5;  // bonus max = ×2.5 au total

// --- Lames ---
// Hitbox de base d'une lame Tier 1. Les lames de tier supérieur multiplient
// cette valeur (cf. TIER_HITBOX_MULT). Hitbox volontairement décorrélée du
// sprite visuel : 2-3x plus large que la lame qu'on voit, pour forcer les
// contacts entre deux ticks et éliminer le "syndrome de la passoire".
// (Calibré quand le tick était à 20 Hz ; conservé tel quel au passage à
// 60 Hz pour ne pas changer le ressenti des clashes.)
export const BLADE_HITBOX = 0.7;
export const BLADE_COLLISION_COOLDOWN = 0.2; // s, par paire de lames

// --- Tiers (paliers de progression) ---
// Le tier d'un joueur est dérivé de bladeCount via tierFromBladeCount(), et
// chaque palier a sa forme de lame (client/src/entities/bladeGeometries.ts).
// Tâche 4.1 : six paliers au lieu de trois. Seuils choisis sur la
// distribution mesurée dans une room publique de bots (4 graines, 15 min) :
// médiane 9 lames ; record d'une vie ≥ 20 dans 27 % des vies, ≥ 40 dans
// 3,6 %, ≥ 50 dans 1,3 %, ≥ 80 dans 0,4 %, jamais 100. Les trois premiers
// seuils ne changent pas (l'équilibrage en place non plus) ; au-dessus,
// trois paliers de plus en plus rares, à viser.
// Tier 0 (1-9 lames) : dague
// Tier 1 (10-19)     : épée
// Tier 2 (20-34)     : faux
// Tier 3 (35-54)     : scie
// Tier 4 (55-79)     : lame runique
// Tier 5 (80+)       : lame à aura
export const TIER_THRESHOLDS = [1, 10, 20, 35, 55, 80] as const;
export const TIER_COUNT = 6;

// Multiplicateur sur BLADE_HITBOX pour la collision : élargit la hitbox des
// joueurs montés en tier pour qu'ils touchent VRAIMENT. Tier 0 est aussi
// boosté (×1.5) pour résoudre le problème des combats à peu de lames :
// avec 3 lames à 120° d'écart, la hitbox angulaire passe d'environ 23° à
// 33° → contacts garantis dans la fenêtre de croisement de 100ms.
// Plafonné au tier 2 : les paliers 3 à 5 changent la forme et la taille
// des lames, pas leur portée (ni leur vitesse, cf. TIER_ROT_MULT). Mesuré
// (tâche 4.1) : avec une hitbox et une rotation encore en hausse au-delà
// (3,3 à 3,6 ; ×1,34 à ×1,4), les morts d'un débutant avant 30 s doublaient
// au banc de survie (9 → 19 sur ~100 sessions, 16 graines) : les gros bots
// devenaient plus meurtriers, à rebours de la lutte contre le snowball
// (tâche 4.2).
export const TIER_HITBOX_MULT: readonly number[] = [1.5, 2.2, 3.0, 3.0, 3.0, 3.0];

// Multiplicateur sur RING_BASE_ROT_SPEED. Progression resserrée : la base
// 5.5 rad/s donne déjà du peps à T0, et le saut T1→T2 précédent était
// trop violent (8.25 rad/s = illisible). Ici T0 5.5, T1 6.3, T2 7.2.
// Plafonné au tier 2, comme la hitbox.
export const TIER_ROT_MULT: readonly number[] = [1.0, 1.15, 1.3, 1.3, 1.3, 1.3];

// Multiplicateur sur l'échelle visuelle des lames (en plus de RARITY_SCALE).
// Volontairement modéré : à Tier 2, RARITY_SCALE Legendary (1.7) × 1.55 ×
// 20 instances émissives + bloom = washout blanc sinon. La progression
// reste lisible (T1 +25 %, T2 +55 %) sans nécessiter de géométrie dédiée.
// Hauts paliers (4.1) : leur forme suffit à les distinguer, la taille ne
// grandit plus que doucement (bloom). Purement visuel : les collisions
// utilisent TIER_HITBOX_MULT.
export const TIER_VISUAL_SCALE: readonly number[] = [1.0, 1.25, 1.55, 1.65, 1.75, 1.85];

// Lame en orbite telle que dessinée, pour les touches de corps : de son
// point d'anneau vers l'extérieur jusqu'à la pointe, sur une demi-largeur.
// La hitbox ronde (TIER_HITBOX_MULT) s'arrêtait à 2,1 u du point d'anneau,
// alors qu'une lame légendaire de palier 5 se dessine jusqu'à 3,65 u : un
// joueur traversait des lames qu'on voyait le toucher. Pointe de chaque
// forme de palier (client/src/entities/bladeGeometries.ts : dague, épée,
// faux, scie, lame runique, lame à aura), en unités de la géométrie, avant
// TIER_VISUAL_SCALE et RARITY_SCALE : toute retouche d'une forme met cette
// table à jour. Les clashs entre lames gardent la hitbox ronde.
export const BLADE_TIP_REACH: readonly number[] = [0.55, 0.95, 1.0, 1.04, 1.08, 1.16];
export const BLADE_EDGE_HALF_WIDTH = 0.2;

// Intensité du knockback (force initiale en u/s) appliquée à chaque clash,
// multipliée par le tier de la lame qui frappe.
export const KNOCKBACK_BASE = 8.0;
// Plafonné dès le tier 2 : 8 × 2,6 ≈ KNOCKBACK_MAX_SPEED.
export const KNOCKBACK_TIER_MULT: readonly number[] = [1.0, 1.7, 2.6, 2.6, 2.6, 2.6];
// Décroissance du knockback (s) : durée pendant laquelle la velocity de
// recul s'amortit exponentiellement avant de devenir négligeable.
export const KNOCKBACK_DECAY = 0.18;
// Plafond de la vitesse de recul (u/s), celle d'un clash de tier 2. Les
// reculs s'additionnent à chaque paire de lames au contact : deux joueurs
// de tier 2 en accumulaient 200 u/s en quelques ticks et se projetaient à
// plus de 10 u (tâche 1.6). Recul maximal : 21 × 0,18 ≈ 3,8 u.
export const KNOCKBACK_MAX_SPEED = 21;

// Hitlag : micro-pause du déplacement du joueur touché, pour donner du
// poids à l'impact. Tier-aware. Les orbites continuent de tourner : figées,
// les lames restaient au contact et relançaient le clash (tâche 1.6).
// Plafonné à 100 ms au-delà du tier 2 : plus long, la cible d'un gros joueur
// passerait plus d'un tiers du temps figée.
export const HITLAG_DURATION_MS: readonly number[] = [50, 75, 100, 100, 100, 100];
// Liberté garantie après un hitlag : aucun nouveau gel avant ce délai. En
// combat prolongé, les clashs s'enchaînaient et figeaient les deux joueurs
// sans issue ; au pire, un joueur passe désormais 100 / (100 + 250), soit
// 29 % du temps figé.
export const HITLAG_COOLDOWN_MS = 250;

// Intensité de screen shake déclenchée pour le joueur local quand une de
// ses lames clashe. Tier-aware. Plus généreux que le hit-confirm classique.
export const CLASH_SHAKE_INTENSITY: readonly number[] = [0.18, 0.32, 0.55, 0.55, 0.55, 0.55];

// Intensité de shake quand le joueur local change de tier.
export const TIER_UP_SHAKE: readonly number[] = [0.0, 0.35, 0.55, 0.6, 0.65, 0.75];

// --- Caméra (cadrage) ---
// Constante de gameplay, pas de thème : ce qu'on voit (menaces, lames au
// sol) doit être le même pour tous (tâche 1.7). Avant, chaque thème fixait
// son décalage de caméra et la largeur visible variait de 47 à 50 u selon
// le thème acheté ; en portrait mobile, on n'en voyait qu'un quart.
// Champ vertical et inclinaison au-dessus de l'horizontale (degrés). Sous
// ~45°, on perd la perception des menaces ; le top-down strict est laid.
export const CAMERA_FOV_DEG = 55;
export const CAMERA_PITCH_DEG = 54;
// Distance au point visé (u) avec une petite orbite : sur un écran 16:9,
// environ 50 u de sol visibles en largeur au niveau du joueur.
export const CAMERA_DISTANCE = 27;
// Largeur de sol visible minimale au niveau du joueur (u) : sur un écran
// étroit (portrait mobile), la caméra recule jusqu'à la montrer. 41 u, soit
// 82 % d'un écran 16:9 (l'objectif est 80 %, avec une marge : la largeur
// se mesure au niveau du joueur, un peu sous le point visé). Contrepartie :
// en portrait, on voit plus loin devant soi que sur un écran large.
export const CAMERA_MIN_VIEW_WIDTH = 41;
// Recul avec l'orbite extérieure : +6 % de distance par unité de rayon
// au-delà du premier anneau (1,8 u), plafonné à +100 % (vers 18,5 u de
// rayon) : l'orbite du plafond de lames (17,8 u) tient à l'écran, avec 24 u
// visibles sous le joueur en 16:9. Arrêté à +40 %, elle en débordait par le
// bas. Formule : cameraZoom (camera.ts).
export const CAMERA_ZOOM_ORBIT_BASE = 1.8;
export const CAMERA_ZOOM_PER_UNIT = 0.06;
export const CAMERA_ZOOM_MAX = 2.0;

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
// Hitbox d'un projectile. 0,85 u avant : moins que la lame qui tournoie à
// l'écran (jusqu'à 2 u de rayon pour une légendaire), et le lanceur vise un
// adversaire affiché ~80 ms dans le passé (1 à 2 u plus loin au serveur) :
// la lame semblait traverser la cible. Le contact se teste sur tout le
// trajet du tick (throws.ts), sans trou entre deux positions.
export const THROW_PROJECTILE_HITBOX = 1.4;
// Départ d'un lancer : à cette distance au-delà de l'orbite extérieure du
// lanceur (inchangé quand la hitbox a grossi : même portée qu'avant).
export const THROW_START_MARGIN = 0.95;

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

// --- Spawn sûr et période de grâce (tâche 3.2) ---
// Un joueur apparaît à moins de SPAWN_RADIUS du centre, loin de la zone
// mortelle (248 u) : avant, jusqu'à ~194 u, et un débutant qui marchait au
// hasard finissait au mur. Le point retenu est le meilleur de
// SPAWN_CANDIDATES tirages : à distance des autres joueurs, d'autant plus
// qu'ils ont de lames (BASE + PER_BLADE × lames, plafonné), puis là où il y
// a le plus de lames au sol à moins de SPAWN_LOOT_RADIUS.
export const SPAWN_RADIUS = 150;
export const SPAWN_CANDIDATES = 30;
export const SPAWN_CLEARANCE_BASE = 35;
export const SPAWN_CLEARANCE_PER_BLADE = 2;
export const SPAWN_CLEARANCE_MAX = 100;
export const SPAWN_LOOT_RADIUS = 25;
// Période de grâce : les bots ignorent un joueur apparu depuis moins de
// SPAWN_GRACE_MS (ni poursuite, ni lancer, ni récolte à son contact). Ensuite,
// pendant SPAWN_GRACE_RAMP_MS, seuls les bots faciles le prennent en chasse,
// et de près : le rayon de poursuite remonte de SPAWN_GRACE_CHASE_RADIUS au
// rayon normal, en proportion de la taille de l'arène (tâche 4.5). Sans
// cette rampe, tous les bots à moins de 80 u fondaient sur lui à la 10e
// seconde : au banc (`tools/bench-survival.js first`), médiane avant la
// première mort ~39 s, ~57 s avec.
// Grâce et rampe s'arrêtent dès qu'il lance ou que ses lames touchent
// quelqu'un (pas un bot lancé à sa poursuite) : pas de lames de bots
// gratuites pour un joueur aguerri qui vient de réapparaître. Pendant sa
// première partie, seuls son lancer et son élimination les arrêtent, et
// les bots ne peuvent pas le tuer pendant la grâce (sparedByBots).
export const SPAWN_GRACE_MS = 10000;
export const SPAWN_GRACE_RAMP_MS = 40000;
export const SPAWN_GRACE_CHASE_RADIUS = 15;
// --- Zone d'intérêt (tâche 2.4) ---
// Chaque client ne reçoit que les joueurs et les lames proches de lui.
// Rayon : distance au point du sol visible le plus éloigné de l'écran,
// annoncée par le client (50 u en 16:9 au plus près, ~136 u pour un
// téléphone en portrait au recul ×1,4), bornée ici, plus une marge pour
// que rien n'apparaisse au bord de l'écran. Valeur par défaut jusqu'à la
// première annonce. Borne : VIEW_RADIUS_MAX jusqu'au recul
// VIEW_RADIUS_MAX_ZOOM, puis en proportion du recul de la caméra du joueur
// (viewRadiusLimit, ~196 u au plafond de lames).
export const VIEW_RADIUS_MIN = 50;
export const VIEW_RADIUS_MAX = 140;
export const VIEW_RADIUS_MAX_ZOOM = 1.4;
export const VIEW_RADIUS_DEFAULT = 100;
export const VIEW_RADIUS_MARGIN = 8;
// Résumé de la room (classement, minimap) envoyé à tous, sans les joueurs
// cachés dans les buissons.
export const SUMMARY_INTERVAL_MS = 500;

// Rayon de ramassage : généreux pour que ça "accroche" dès qu'on frôle.
export const PICKUP_RADIUS = 2.8;
// Attraction magnétique : au-delà du ramassage direct, la lame se dirige
// vers le joueur le plus proche. Fait que le ramassage feel "juicy".
export const PICKUP_MAGNET_RADIUS = 5.5;
export const PICKUP_MAGNET_STRENGTH = 18; // u/s appliqués, atténués avec la distance
export const GROUND_BLADE_FRICTION = 3.5;
// Durée de vie d'un DROP au sol (lames lâchées à la mort, sorties d'une
// caisse, lancer retombé) avant qu'il ne s'évapore : le butin se ramasse
// vite ou se perd, et les zones de combat ne restent pas jonchées de lames.
// Les lames ambiantes n'expirent pas : le spawner les plafonne déjà
// (ambientCap), les faire tourner ne créerait que du trafic réseau.
export const GROUND_BLADE_TTL_MS = 15000; // 15 s
// Les dernières ms de vie d'un drop, le client le fait clignoter.
export const GROUND_BLADE_BLINK_MS = 3000;

// --- Spawn ambiant ---
// Densité modérée : assez pour pas mourir de faim, pas trop pour que la
// map reste lisible. Les drops expirés (cf. GROUND_BLADE_TTL_MS) libèrent
// de la place sous le plafond, que le spawner comble ici.
export const AMBIENT_SPAWN_INTERVAL = 1.0;
export const AMBIENT_MAX_BASE = 400;
export const AMBIENT_PER_PLAYER = 18;
export const AMBIENT_MIN_DIST_FROM_PLAYER = 10;
export const AMBIENT_SPAWN_BURST = 20; // max de spawns par tick
export const AMBIENT_MIN_FLOOR = 35; // toujours au moins N lames au sol

// Multiplicateur de densité appliqué dans les rooms privées : plus de
// lames au sol, plus de caisses, plus de power-ups. Privées = setup
// "fun avec les potes" → on veut qu'il y ait toujours du loot à
// portée. S'applique uniformément aux 3 systèmes (ambient, crates,
// powerups).
export const PRIVATE_ROOM_DENSITY_MULT = 2.5;

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
// Garde-fou de mémoire, pas un réglage : à 12, le butin d'un combat
// s'arrêtait à 12 lames, si grosse que soit l'orbite que le tueur venait de
// détruire, et tuer coûtait souvent plus de lames qu'il n'en rapportait.
export const RECENT_LOSS_BUFFER_CAP = 400;
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

// Durée des effets selon la rareté du power-up (en secondes). Tâche 4.3 :
// jusqu'à 90 s avant, un Spin ou un Shield légendaire décidait seul des
// combats pendant une minute et demie. Un second ramassage du même type
// prolonge jusqu'à la plus lointaine des deux échéances, sans cumul : aucun
// effet ne dépasse 25 s.
export const POWERUP_DURATION: Record<BladeRarity, number> = {
  [BladeRarity.Common]: 8,
  [BladeRarity.Rare]: 12,
  [BladeRarity.Epic]: 18,
  [BladeRarity.Legendary]: 25,
};

// Multiplicateurs d'effets (constants, ne dépendent pas de la rareté).
export const POWERUP_SPEED_MULT = 1.35;     // +35 % vitesse
export const POWERUP_SPIN_MULT = 1.6;       // +60 % vitesse de rotation
export const POWERUP_MAGNET_MULT = 2.0;     // x2 rayon d'aimant
export const POWERUP_SHIELD_DMG_REDUC = 0.5; // dégâts reçus par les lames divisés par 2

// BLADES : lames de la rareté du power-up, ajoutées d'un coup (tâche 4.3).
// Avant : jusqu'à 12 lames Common, qui faisaient monter de palier sans
// renforcer l'orbite. Valeur en points de vie : 3, 6, 8, 16 (contre 2, 4,
// 7, 12).
export const POWERUP_BLADES_COUNT: Record<BladeRarity, number> = {
  [BladeRarity.Common]: 3,
  [BladeRarity.Rare]: 3,
  [BladeRarity.Epic]: 2,
  [BladeRarity.Legendary]: 2,
};

// Spawn : plusieurs power-ups toujours sur la map, bien visibles (pilier
// lumineux côté client). Density suffisante pour que le joueur en croise
// un en 20-30 s de jeu.
// HITBOX 2.8 (vs 1.4 avant) : passer "à proximité" d'un power-up suffit
// maintenant à le ramasser sans avoir à viser pile son centre. Plus
// gameplay-friendly à 60 joueurs où on bouge vite et où rater un
// power-up ramassé par l'ennemi à 0.3u près était frustrant.
export const POWERUP_HITBOX = 2.8;            // rayon de ramassage (très généreux)
export const POWERUP_SCALE = 1.3;             // taille visuelle (forme du type)
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
// Champions (tâche 4.12) : jusqu'à BOT_CHAMPIONS_MAX bots qui apparaissent
// avec une grosse orbite, à la taille du plus gros humain aguerri
// (CHAMPION_SIZE_RATIO de ses lames, entre CHAMPION_MIN_BLADES et
// CHAMPION_MAX_BLADES). Sans eux, aucun bot ne dépassait quelques dizaines
// de lames : un joueur à 150 n'avait plus d'adversaire. Ils jouent en
// difficile, ne fuient qu'un joueur CHAMPION_FLEE_RATIO fois plus gros et
// ne poursuivent que des proies à leur mesure (au moins CHAMPION_PREY_RATIO
// de leurs lames) ; un débutant, ou un joueur dans sa grâce et sa rampe,
// n'est jamais leur cible. Seulement en arène et en manches, avec au moins
// un humain aguerri ; le suivant apparaît CHAMPION_RESPAWN_MS après la
// chute du précédent. Leur butin (70 %, tout s'ils mènent) va à leur tueur.
export const BOT_CHAMPIONS_MAX = 2;
export const CHAMPION_MIN_BLADES = 40;
export const CHAMPION_MAX_BLADES = 300;
export const CHAMPION_SIZE_RATIO = 0.8;
// Un second champion quand le plus gros humain en a au moins autant.
export const CHAMPION_SECOND_AT = 100;
export const CHAMPION_PREY_RATIO = 0.4;
export const CHAMPION_FLEE_RATIO = 1.3;
export const CHAMPION_RESPAWN_MS = 45000;
// Raretés de l'orbite d'un champion à l'apparition (celles d'un joueur qui
// a grossi en ouvrant des caisses).
export const CHAMPION_RARITY_WEIGHTS: Array<{ rarity: BladeRarity; weight: number }> = [
  { rarity: BladeRarity.Common, weight: 0.5 },
  { rarity: BladeRarity.Rare, weight: 0.3 },
  { rarity: BladeRarity.Epic, weight: 0.15 },
  { rarity: BladeRarity.Legendary, weight: 0.05 },
];
// Marque devant le nom d'un champion (nametag, classement, fil des kills).
export const CHAMPION_NAME_MARK = "★ ";
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
// Contre-mesures au snowball (tâche 4.2, cf. bounty.ts). Le leader (joueur
// vivant au meilleur score) porte une prime dès BOUNTY_MIN_SCORE : un quart
// de son score, entre BOUNTY_MIN et BOUNTY_MAX trophées, pour qui l'élimine,
// et il lâche toutes ses lames (LEADER_DROP_RATIO) au lieu de 70 %.
export const BOUNTY_MIN_SCORE = 30;
export const BOUNTY_SHARE = 0.25;
export const BOUNTY_MIN = 10;
export const BOUNTY_MAX = 150;
export const LEADER_DROP_RATIO = 1.0;
// Éliminer un joueur qui avait au moins deux fois plus de lames double la
// valeur du kill (SCORE_UNDERDOG en plus de SCORE_KILL).
export const UNDERDOG_RATIO = 2;
export const UNDERDOG_MIN_VICTIM_BLADES = 10;
export const SCORE_UNDERDOG = 15;

export const SCORE_KILL = 15;
export const SCORE_BLADE = 1;           // par lame du record de la vie (maxBladeCount, ne baisse jamais)
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
// Modération (tâche 5.6). Trois messages masqués en deux minutes : deux
// minutes de silence imposé par le serveur.
export const CHAT_STRIKES_TO_MUTE = 3;
export const CHAT_STRIKE_WINDOW_MS = 120_000;
export const CHAT_AUTO_MUTE_MS = 120_000;
// Derniers messages d'un joueur gardés en mémoire, joints à un signalement.
export const CHAT_RECENT_KEPT = 5;
// Signalements : un par joueur visé et par partie, cinq par tranche de
// dix minutes ; motif facultatif, tronqué.
export const REPORT_LIMIT_COUNT = 5;
export const REPORT_LIMIT_WINDOW_MS = 600_000;
export const REPORT_REASON_MAX_LENGTH = 120;

// --- Divers ---
export const NAME_MIN_LENGTH = 3;
export const NAME_MAX_LENGTH = 16;
// Pseudo de compte (profil) : même règle pour le client, l'API et la
// contrainte de la base (profiles_username_format, migration 0001). Le
// pseudo en partie d'un invité accepte aussi les lettres accentuées (cf.
// sanitizeName dans ArenaRoom).
export const USERNAME_RE = /^[A-Za-z0-9_.\-]{3,16}$/;
