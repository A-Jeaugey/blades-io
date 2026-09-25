# Plan d'amélioration — blades.io (V2)

Document vivant : on coche les cases au fur et à mesure. Ce plan remplace le plan V1, archivé dans [`docs/archive/PLAN-v1.md`](docs/archive/PLAN-v1.md).

Il découle de l'audit du 2026-09-24 : [`docs/AUDIT-2026-09.md`](docs/AUDIT-2026-09.md). Chaque tâche cite les constats qu'elle traite (`FEEL-01`, `ECO-01`…).

---

## Actions manuelles en attente

Étapes impossibles depuis une session de code (accès Supabase, serveur de production, fusion dans `main`). Le owner les coche ; chaque session les rappelle en fin de tâche tant qu'il en reste.

- [ ] **Appliquer la migration `supabase/migrations/0004_leaderboard_public_only.sql`** dans l'éditeur SQL Supabase (tâche 0.2). Sans elle, le serveur ne crédite déjà plus rien en room privée, mais les parties privées enregistrées avant restent au classement.
- [ ] **Vérifier que le proxy de production transmet l'IP du joueur** avant de déployer la phase 0 (tâche 0.3). Le serveur en ligne répond `server: nginx`, alors que le repo contient un `Caddyfile` : le proxy doit envoyer `X-Forwarded-For` (sous nginx : `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`). Sinon, tous les joueurs partagent un seul compteur de limitation de débit : le lobby affiche « — » et les nouveaux invités n'ont plus de wallet dès qu'il y a du monde. Si nginx et Caddy sont chaînés, régler `TRUST_PROXY` (et `trusted_proxies` côté Caddy) pour que le serveur voie l'IP du joueur.
- [ ] **Fusionner `claude/great-shannon-itw2b2` dans `main`** une fois les deux points ci-dessus faits. La fusion déclenche le déploiement.

---

## Comment utiliser ce plan

1. Prendre la **première tâche non cochée** dans l'ordre recommandé (section « Calendrier »), sauf décision contraire. Dans chaque phase, les tâches sont listées dans leur ordre d'exécution ; les numéros sont des identifiants stables, d'où un ordre parfois non séquentiel (1.8 juste après 1.1, par exemple).
2. Relire le constat correspondant dans l'audit (preuves `fichier:ligne`).
3. Implémenter sur une branche dédiée, en respectant `CLAUDE.md` (contrat `shared/`, serveur autoritatif, couleurs dans `themes/`, trois niveaux de qualité).
4. Valider **tous** les critères d'acceptation de la tâche. Pour toute tâche serveur, lancer `node tools/bench-server.js 60 120` avant et après (après `npm run build:shared && npm run build --workspace=@bladeio/server`), et noter les chiffres dans le commit.
5. Cocher la case, ajouter la date et le hash du commit à la fin de la ligne, et citer l'identifiant de la tâche dans le message de commit (ex. `[0.1] Prix des items côté serveur`).

**Effort** : S ≤ 0,5 jour · M = 1-2 jours · L = 3-5 jours · XL > 1 semaine.

---

## Principes (s'appliquent à toutes les tâches)

- **Ce que le joueur voit est ce que le serveur calcule.** Toute divergence visible entre rendu et simulation est un bug prioritaire.
- **Lisibilité avant effets.** Un effet qui gêne la lecture d'une menace est refusé, même s'il est beau.
- **Aucun avantage payant.** Le cadrage caméra, les couleurs de gameplay (raretés, menaces) et les hitbox sont identiques pour tous, quel que soit le cosmétique.
- **Honnêteté.** Aucune donnée affichée n'est inventée (joueurs en ligne, ping, saisons, classements).
- **Mesurer avant et après.** Performance : `tools/bench-server.js`. Gameplay : télémétrie (tâche 4.8) et sessions de test.
- **Pas de reload ni de déconnexion imposés en pleine partie.**

---

## Vue d'ensemble

| Phase | Objectif | Sortie de phase | Effort total estimé |
|---|---|---|---|
| **0. Urgences** | Plus de faille économique, plus de donnée factice, plus de run perdue bêtement | Tous les constats P0 de l'audit fermés, sauf `FEEL-01` (tâche 1.1) | ~4 jours |
| **1. Combat fiable** | Ce qu'on voit = ce qui se passe ; réponse immédiate aux inputs ; visée libre | Duel 3 contre 3 où chaque clash visible est réel | ~2,5 semaines |
| **2. Performance et réseau** | Tenir 60 joueurs confortablement, diviser la bande passante | Bench 60 joueurs : tick moyen < 4 ms, < 45 Ko/s par client | ~2 semaines (+ 2.5 optionnelle) |
| **3. Première expérience et UX** | Un nouveau joueur comprend, survit et progresse | Temps médian avant la première mort > 45 s en session scriptée | ~2 semaines |
| **4. Profondeur et équilibrage** | Progression qui ne plafonne pas, contre-mesures au snowball, carte vivante | Paliers jusqu'à 200+ lames, télémétrie en place | ~3-4 semaines |
| **5. Méta, rétention, social** | Des raisons de revenir chaque jour | Profil, XP, défis, classements temporaires en ligne | ~3 semaines |
| **6. Cosmétiques visibles et boutique** | Des cosmétiques que les autres voient, économie saine | Loadout serveur, premiers skins en boutique | ~3 semaines |
| **7. Modes de jeu** | Variété et parties courtes | Manches chronométrées jouables | ~3-5 semaines |
| **T. Transverse** | Tests, CI, déploiement sans coupure, docs à jour | En continu, les premières tâches dès la semaine 1 | ~2 semaines réparties |

---

## Décisions produit à prendre

Ces choix bloquent ou orientent certaines tâches. Une recommandation est proposée pour chacun ; tant qu'aucune décision n'est prise, on applique la recommandation.

| # | Question | Recommandation | Tâches concernées |
|---|---|---|---|
| D1 | Langue par défaut de l'interface ? | Détection via `navigator.language`, français et anglais complets, anglais par défaut sinon. | 3.7 |
| D2 | Trophées en room privée ? | Aucun trophée et aucune entrée au classement en privé (parties « entre amis »). | 0.2 |
| D3 | Monétisation en argent réel ? | Pas avant d'avoir une base de joueurs et la phase 5 ; monnaie de jeu uniquement d'ici là. | 6.5 |
| D4 | Couleurs de rareté universelles ou propres à chaque thème ? | Universelles (famille de teinte fixe par rareté) ; les thèmes n'ajustent que saturation et luminosité dans une plage contrôlée. | 6.3 |
| D5 | Manches chronométrées en public ou seulement en privé ? | D'abord en privé et dans une file publique séparée, puis décision selon la télémétrie. | 7.1 |
| D6 | Hébergement ? | VPS avec bande passante garantie (région UE) avant toute ouverture large ; la connexion domestique ne tient pas une room pleine (~45 Mbit/s sortants). | T.3, T.9 |
| D7 | Taille maximale d'une room publique ? | 40 joueurs tant que la phase 2 n'est pas terminée, puis 60. | 2.x, 4.5 |
| D8 | Bots : noms humoristiques actuels ou noms crédibles ? Signaler les bots ? | Garder l'humour et afficher un petit indicateur « bot » dans le classement, par transparence. | 4.6 |
| D9 | L'ancienne décision « taille de map inchangée » tient-elle ? | La revoir : arène dont le rayon suit la population (tâche 4.5), la forme reste un cercle. | 4.5 |

---

## Calendrier recommandé

Semaines indicatives pour un rythme de développement régulier. Les phases 1 et 2 peuvent avancer en parallèle.

| Semaine | Contenu |
|---|---|
| 1 | Phase 0 complète · T.1 (CI) · T.7 (docs, passe rapide) |
| 2 | T.2 (tests des systèmes serveur) · 2.1 · 2.2 · 3.3 · nametags par défaut (partie de 3.4) |
| 3-4 | 1.1 · 1.8 · 1.3 + 1.4 · 1.5 · 1.6 · 1.7 · puis 1.2 |
| 5 | 3.1 · 3.2 · 3.4 · 3.5 |
| 6 | 2.3 · 2.4 · T.3 (déploiement gracieux) · 3.6 |
| 7-8 | 4.1 · 4.2 · 4.3 · 4.8 · 4.6 · 2.6 |
| 9-11 | Phase 5 · 3.7 · 3.8 · 3.9 |
| 12-14 | Phase 6 |
| 15+ | Phase 7 · 4.4 · 4.5 · 4.7 · 4.9 · 2.5 · T.6 |

---

## Phase 0 — Urgences

Objectif : fermer les failles et les défauts qui ne doivent pas vivre une semaine de plus. Tâches courtes et indépendantes.

**Statut : terminée le 2026-09-24.** Le seul constat P0 encore ouvert, `FEEL-01`, relève de la tâche 1.1.

- [x] **0.1 — Prix des items côté serveur** · S · `ECO-01` `SEC-01` · 2026-09-24 · `241911c`
  - Quoi : le serveur devient la seule source de vérité pour le prix et l'existence d'un item. Migration `supabase/migrations/0004_shop_items.sql` : table `shop_items(id text primary key, kind text, price bigint, active boolean)` seedée avec les thèmes actuels (sanctuaire 1500, forge-vermeille 3500, profondeurs-glacees 6000) ; nouvelle version de `purchase_item(p_user_id, p_item_id)` qui lit le prix en base et refuse un item inconnu ou inactif. `/api/wallet/purchase` n'accepte plus de `price`. Ajouter `GET /api/shop/catalog` pour que la boutique affiche les prix du serveur.
  - Fichiers : `supabase/migrations/`, `server/src/auth/routes.ts`, `server/src/auth/wallet.ts`, `client/src/auth/wallet.ts`, `client/src/boutique/Boutique.ts`.
  - Acceptation : une requête avec `price: 0` débite le vrai prix ; un `item_id` inconnu renvoie `400 invalid_item` ; l'achat depuis l'interface fonctionne comme avant ; les prix affichés viennent du catalogue.
  - Réalisé : catalogue partagé `SHOP_ITEMS` (`shared/src/shop.ts`) au lieu d'une table SQL et d'un endpoint de catalogue. `purchase_item` n'est appelable que par le service role, donc la validation serveur suffit, et le déploiement ne dépend pas d'une migration. La boutique affiche les prix du même catalogue.

- [x] **0.2 — Pas de trophées ni de classement en room privée** · S · `ECO-02` `META-02` · Décision D2 · 2026-09-24 · `ad4f834`
  - Quoi : dans `persistMatchIfAuthed`, ne créditer aucun wallet (authentifié ou invité) si la room est privée. Recréer la vue `leaderboard_top` en excluant `room_code is not null`. Écran de mort en privé : « Partie privée : pas de trophées ».
  - Fichiers : `server/src/rooms/ArenaRoom.ts`, nouvelle migration SQL, `client/src/ui/DeathScreen.ts`, `client/src/main.ts`.
  - Acceptation : une mort en room privée ne change pas le solde ; le classement n'affiche que des parties publiques ; le message en privé est explicite.
  - Réalisé : **migration `0004_leaderboard_public_only.sql` à appliquer à la main** dans l'éditeur SQL Supabase. Le correctif serveur est actif sans elle ; elle retire du classement les parties privées déjà enregistrées.

- [x] **0.3 — Durcir l'API et les dépendances** · S · `SEC-02` `SEC-04` · 2026-09-24 · `36027e1`
  - Quoi : limitation de débit par IP (`express-rate-limit` ou un compteur en mémoire) sur `/api/guest/init` (5/heure), `/api/profile`, `/api/wallet/*` ; `app.set("trust proxy", 1)` derrière Caddy ; CORS restreint aux origines de `ALLOWED_ORIGINS` (par défaut même origine). Retirer le méta-paquet `colyseus` de `server/package.json` (le code n'utilise que `@colyseus/core` et `@colyseus/ws-transport`), puis `npm audit fix` sans changement majeur.
  - Fichiers : `server/src/index.ts`, `server/src/auth/routes.ts`, `server/package.json`, `package-lock.json`, `.env.example`.
  - Acceptation : 6 appels à `/api/guest/init` en une heure depuis la même IP → le 6ᵉ reçoit `429` ; `npm audit --omit=dev` n'affiche plus que ce qui dépend de la montée Colyseus 0.18 (T.6) ; le jeu démarre et les rooms se créent normalement.
  - Réalisé : 120 requêtes/min par IP sur `/api`, et 20 par 15 min sur `/api/guest/init` au lieu de 5 par heure (une salle de classe partage souvent une même IP). `TRUST_PROXY` et `ALLOWED_ORIGINS` sont documentés dans `.env.example`. Vulnérabilités en production : 15 → 3 (1 haute : `nanoid` via `@colyseus/core`), toutes levées par T.6.

- [x] **0.4 — Lobby honnête** · S · `UX-01` · 2026-09-24 · `b8af18c`
  - Quoi : supprimer toute valeur inventée. Ajouter `GET /api/stats` (joueurs connectés et rooms, via un compteur tenu par les rooms ou `matchMaker.query`). Mesurer le ping réel (aller-retour HTTP sur `/healthz` au lobby ; en jeu, le message `ping` déjà géré par le serveur). Injecter le hash de build au moment du build (`define` Vite). Remplacer région, saison, patch notes et classement factices par de vraies données ou les retirer. Réécrire le bandeau défilant avec les règles réelles (pas de fusion).
  - Fichiers : `client/index.html`, `client/src/ui/LoginScreen.ts`, `client/vite.config.ts`, `server/src/index.ts`.
  - Acceptation : aucun `Math.random()` ne produit une valeur affichée comme statistique ; avec le serveur arrêté, les champs affichent « — » et non des chiffres.
  - Réalisé : ping du lobby mesuré avec la Resource Timing API (temps réseau seul). Aucun ping n'est affiché en jeu aujourd'hui : l'affichage est prévu en 3.4.

- [x] **0.5 — Un joueur déconnecté s'arrête** · S · `FEEL-06` · 2026-09-24 · `0817312`
  - Quoi : à la déconnexion non volontaire, remettre `inputDx`, `inputDy`, `inputBoost` et `inputThrow` à zéro avant `allowReconnection`. Dans la boucle, si un humain n'a envoyé aucun input depuis 500 ms, ses inputs sont remis à zéro (`lastInputAt` enfin utilisé).
  - Fichiers : `server/src/rooms/ArenaRoom.ts`, `server/src/systems/movement.ts`.
  - Acceptation : couper le réseau d'un client en mouvement → son personnage s'arrête en moins de 0,5 s côté serveur.

- [x] **0.6 — Plus de rechargement de page en pleine partie** · S · `CLI-02` · 2026-09-24 · `c3122de`
  - Quoi : pendant un match, la baisse automatique de qualité se limite à ce qui se change à chaud (résolution, bloom via `PostFX.setEnabled`). Le changement de preset est mémorisé et appliqué au prochain retour au menu.
  - Fichiers : `client/src/main.ts`, `client/src/scene/PostFX.ts`.
  - Acceptation : FPS artificiellement bas en jeu → aucune déconnexion ; le preset inférieur est actif après le retour au menu.

- [x] **0.7 — Entrées hybrides (PC à écran tactile)** · S · `UX-04` · 2026-09-24 · `ee0e68a`
  - Quoi : le mode d'entrée suit le dernier périphérique utilisé (toucher → tactile ; clavier ou souris → desktop) au lieu d'être figé au démarrage. Les contrôles tactiles s'affichent ou se masquent dynamiquement.
  - Fichiers : `client/src/input/InputManager.ts`, `client/src/main.ts`, `client/src/ui/ChatPanel.ts`.
  - Acceptation : sur un PC à écran tactile, clavier et souris fonctionnent ; toucher l'écran bascule en mode tactile ; sur téléphone rien ne change.

- [x] **0.8 — Anti-triche d'input conforme à la doc** · S · `NET-03` · 2026-09-24 · `8996c41` `8bb0a4a`
  - Quoi : compter une violation par fenêtre d'une seconde dépassant `MAX_INPUT_RATE`, et déconnecter le client après `MAX_INPUT_VIOLATIONS` violations (code de fermeture dédié, message côté client). Mettre le README en accord avec les valeurs réelles.
  - Fichiers : `server/src/rooms/ArenaRoom.ts`, `README.md`.
  - Acceptation : un client qui envoie 200 inputs/s est déconnecté en quelques secondes ; un client normal à 60 inputs/s ne l'est jamais.

- [x] **0.9 — Trancher le TTL des lames au sol** · S · `GAME-11` · 2026-09-24 · `f596194`
  - Quoi : appliquer `GROUND_BLADE_TTL_MS` aux lames au sol (suppression serveur à échéance) et faire clignoter côté client les 3 dernières secondes (échéance connue via un champ synchronisé en secondes ou via le temps serveur de la tâche 1.1). Mettre les commentaires en cohérence.
  - Fichiers : `server/src/systems/orbitPositions.ts` (ou un petit système dédié), `server/src/state/Blade.ts`, `client/src/entities/BladeView.ts`, `shared/src/constants.ts`.
  - Acceptation : aucune lame au sol plus vieille que le TTL dans le bench ; le clignotement est visible avant disparition.
  - Réalisé : TTL appliqué aux seuls drops (mort, caisse, lancer retombé). Les lames ambiantes n'expirent pas : `ambientCap` les plafonne déjà, et les renouveler ne produirait que du trafic réseau et des lames qui disparaissent sous le nez du joueur. Un booléen synchronisé `expiring` (levé une fois, 3 s avant l'échéance) suffit au clignotement, sans attendre le temps serveur de 1.1.

---

## Phase 1 — Combat fiable

Objectif : ce qu'on voit est ce qui se passe, et le personnage répond immédiatement. C'est la phase qui a le plus d'impact sur le plaisir de jeu.

- [ ] **1.1 — Horloge serveur partagée et orbites synchronisées** · M · `FEEL-01`
  - Quoi : le temps orbital du serveur dérive du numéro de tick (`t = tick × SERVER_DT`, déterministe) au lieu d'une somme de `dt` variables. Le client estime le temps serveur à partir de `state.tick` reçu à chaque patch (offset lissé) et calcule les angles des lames distantes à `tempsServeur − RENDER_DELAY`, le même instant que la position interpolée de leur propriétaire. Ajouter le multiplicateur du power-up Spin côté client. Ajouter un mode debug (touche ou paramètre d'URL) qui dessine les hitbox calculées.
  - Fichiers : `server/src/rooms/ArenaRoom.ts`, `server/src/systems/orbitPositions.ts`, `shared/src/orbits.ts`, `client/src/main.ts`, `client/src/entities/BladeView.ts`, nouveau `client/src/net/ServerClock.ts`.
  - Acceptation : en mode debug, les hitbox et les lames rendues se superposent (écart angulaire < 0,1 rad pour les joueurs distants) ; dans un duel 3 contre 3, chaque étincelle de clash apparaît sur un contact visible ; le résultat est identique pour deux clients arrivés à des moments différents et après une mise en arrière-plan de l'onglet.

- [ ] **1.8 — Échéances exprimées en temps serveur** · S · `FEEL-07` · Dépend de 1.1
  - Quoi : les badges d'effets, le halo de protection et le cooldown de lancer comparent les échéances au temps serveur estimé, et non à `Date.now()` du navigateur. Idéalement, les champs `*Until` deviennent des temps relatifs au démarrage de la room (plus compacts, cf. 2.3).
  - Fichiers : `client/src/main.ts`, `client/src/ui/Hud.ts`, `server/src/state/Player.ts`.
  - Acceptation : avec l'horloge du système décalée de +5 minutes, badges et halo se comportent correctement.

- [ ] **1.3 — Visée indépendante du déplacement** · M · `GAME-04`
  - Quoi : ajouter `aimX`/`aimY` (normalisés) à `InputMessage` ; le serveur les stocke et `processThrows` les utilise (repli sur la direction de déplacement si absents). Souris : visée vers le curseur. Clavier seul : visée = direction de déplacement. Tactile : glisser depuis le bouton THROW pour viser, simple tap = direction du joystick. Indicateur de visée au sol quand le lancer est disponible. Les bots visent aussi par ce champ (fin du « lancer seulement dans le sens de marche »).
  - Fichiers : `shared/src/types.ts`, `server/src/rooms/ArenaRoom.ts`, `server/src/state/Player.ts`, `server/src/systems/throws.ts`, `server/src/systems/bots.ts`, `client/src/input/*`, `client/src/main.ts`, nouvel indicateur dans `client/src/entities/PlayerView.ts`.
  - Acceptation : on peut lancer derrière soi en fuyant ; le tap mobile fonctionne toujours ; la valeur d'aim est validée et normalisée côté serveur.

- [ ] **1.4 — Direction souris par projection sur le sol** · S · `FEEL-03` · À faire avec 1.3
  - Quoi : projeter le curseur sur le plan `y = 0` (raycast) et calculer mouvement et visée depuis la position du joueur. Conserver la zone morte au centre.
  - Fichiers : `client/src/input/Mouse.ts`, `client/src/input/InputManager.ts`, `client/src/main.ts`.
  - Acceptation : un curseur placé sur une cible au sol donne une direction qui passe par cette cible, quel que soit l'endroit de l'écran.

- [ ] **1.5 — Retours de combat immédiats** · M · `FEEL-05`
  - Quoi : flash blanc de 80 ms sur les lames impliquées dans un clash (couleur par instance) ; sons distincts pour clash, lame brisée, élimination confirmée, caisse brisée, mort ; indicateur de direction au bord de l'écran quand on perd une lame ; « +1 » à l'élimination.
  - Fichiers : `client/src/entities/BladeView.ts`, `client/src/audio/SoundManager.ts`, `client/src/main.ts`, `client/src/ui/Hud.ts`.
  - Acceptation : les évènements se distinguent au son seul ; on sait de quel côté vient une attaque sans regarder la minimap.

- [ ] **1.6 — Hitlag sans blocage** · S · `GAME-07` · À valider en playtest
  - Quoi : un seul hitlag par joueur toutes les 250 ms au maximum ; ne plus geler la rotation des orbites (ou 30 ms maximum) ; appliquer le knockback à la sortie du gel au lieu de le laisser décroître pendant.
  - Fichiers : `server/src/systems/collisions.ts`, `server/src/systems/movement.ts`, `server/src/systems/orbitPositions.ts`, `shared/src/constants.ts`.
  - Acceptation : dans un affrontement de deux joueurs à 30 lames, chacun peut se dégager ; part du temps passé figé pendant un clash prolongé < 30 % (mesurée dans le bench ou un test).

- [ ] **1.7 — Caméra équitable et dynamique** · M · `FEEL-04`
  - Quoi : le cadrage devient une constante de gameplay dans `shared/` et sort de l'interface `Theme` (fin de l'avantage ou désavantage selon le thème). Zoom arrière progressif selon le rayon de l'orbite extérieure. Compensation du ratio d'écran pour garantir une surface visible minimale identique (le portrait mobile ne doit plus voir moins large). Screen shake lissé (bruit continu plutôt qu'aléatoire par frame).
  - Fichiers : `shared/src/constants.ts`, `client/src/scene/Camera.ts`, `client/src/scene/Scene.ts`, `client/src/themes/*.ts`, `client/src/themes/Theme.ts`, `client/src/fx/ScreenShake.ts`, `CLAUDE.md`, `.claude/skills/blade-theme/SKILL.md`.
  - Acceptation : même surface visible sur les quatre thèmes ; en 390×844, la largeur visible au sol est au moins 80 % de celle d'un écran 16:9 ; la caméra recule quand l'orbite grandit, sans à-coups.

- [ ] **1.2 — Vraie prédiction avec rejeu d'inputs** · L · `FEEL-02` · Dépend de 1.1 et T.2
  - Quoi : extraire le pas de mouvement dans `shared/` (fonction pure utilisée par le serveur et le client : vitesse, boost, power-up Speed, collision décor, knockback, hitlag). Le serveur met en file les inputs reçus, en applique un par tick et renvoie le dernier `seq` appliqué. Le client garde un tampon d'inputs, recale sur l'état serveur à chaque patch et rejoue les inputs non acquittés. Le lissage d'erreur ne sert plus qu'aux petites corrections.
  - Fichiers : nouveau `shared/src/movement.ts`, `server/src/systems/movement.ts`, `server/src/rooms/ArenaRoom.ts`, `client/src/main.ts`.
  - Acceptation : avec 150 ms de latence simulée, le personnage réagit sans délai aux changements de direction et s'arrête net ; correction moyenne < 0,1 u en ligne droite ; pas de rubber-banding sous Speed ; tests unitaires du pas de mouvement partagé.

---

## Phase 2 — Performance et réseau

Objectif : tenir 60 joueurs avec de la marge et diviser la bande passante. Référence de départ (bench 60 bots) : tick moyen 10,6 ms, p99 17,5 ms, 93 Ko/s par client.

- [ ] **2.1 — Optimiser l'aimantation des lames au sol** · S · `NET-02`
  - Quoi : construire une fois par tick un tableau simple des joueurs vivants (position, rayon d'aimant au carré) ; sortir `Date.now()` et les constantes des boucles ; indexer les joueurs dans une grille spatiale et ne tester, pour chaque lame au sol, que les cellules voisines ; ne plus lire les champs du schema dans la boucle interne.
  - Fichiers : `server/src/systems/orbitPositions.ts`.
  - Acceptation : comportement identique (tests T.2) ; bench 60 bots : tick moyen réduit d'au moins 40 %.

- [ ] **2.2 — Réduire les parcours de l'état** · M · `NET-02` `NET-04`
  - Quoi : index par tick (joueurs vivants, lames par propriétaire, lames au sol) partagé par les systèmes ; comptage par anneau tenu sur le joueur (champ non synchronisé) pour `attachBladeToPlayer` et `recompactOwnerRing` ; rayon de bouclier précalculé une fois par joueur et grille spatiale dans `pushOutPlayers` ; `lastHitAt` rattaché à l'instance de room ; suppression de l'écrasement de `score` dans `attachBladeToPlayer`.
  - Fichiers : `server/src/systems/*.ts`, `server/src/rooms/ArenaRoom.ts`.
  - Acceptation : bench 60 bots : tick moyen < 4 ms, p99 < 8 ms ; tests T.2 verts.

- [ ] **2.3 — Fréquence de patch et compacité** · M · `NET-01` · Après 1.1 (idéalement après 1.2)
  - Quoi : patch à 30 Hz (le tick reste à 60 Hz), interpolation client adaptée ; positions quantifiées (entiers 16 bits au centième, la carte tient dans ±327) ; échéances en temps relatif 32 bits au lieu de `float64` ; retrait des champs synchronisés inutiles.
  - Fichiers : `server/src/state/*.ts`, `server/src/rooms/ArenaRoom.ts`, `client/src/main.ts`, `client/src/entities/*.ts`.
  - Acceptation : bench 60 bots < 45 Ko/s par client ; pas de dégradation visible du mouvement des joueurs distants.

- [ ] **2.4 — Filtrage par zone d'intérêt et bushes côté serveur** · L · `NET-01` `SEC-03` `GAME-09`
  - Quoi : utiliser `StateView` (Colyseus 0.16) pour n'envoyer à chaque client que les entités proches (rayon à calibrer, ~70 u) plus lui-même. Un joueur caché dans un bush est retiré de la vue des autres sauf à très courte distance. Minimap et classement passent par un résumé basse fréquence (2 Hz) qui exclut les joueurs cachés. Les bots respectent les bushes (pas de ciblage d'un joueur caché hors courte portée).
  - Fichiers : `server/src/rooms/ArenaRoom.ts`, `server/src/state/*.ts`, `server/src/systems/bots.ts`, `client/src/main.ts`, `client/src/ui/Minimap.ts`, `client/src/ui/Leaderboard.ts`.
  - Acceptation : un client modifié ne reçoit pas la position d'un joueur caché ; bench 60 bots < 30 Ko/s par client ; minimap et classement fonctionnent.

- [ ] **2.5 — Orbites synchronisées sous forme compacte** · XL · `NET-01` · Optionnel, à évaluer après 2.3 et 2.4
  - Quoi : ne plus synchroniser chaque lame en orbite comme une entité ; synchroniser par joueur la liste ordonnée des raretés (par exemple un tableau d'octets). Les entités `Blade` ne concernent plus que les lames au sol et en vol. Le client reconstruit les instances d'orbite.
  - Acceptation : bench 60 bots < 20 Ko/s par client ; rendu identique.

- [ ] **2.6 — Rendu client des lames et des effets** · M · `CLI-01` `GFX-03`
  - Quoi : index inverse par bucket (suppression en O(1)) ; une seule lecture par propriétaire et par frame ; buckets qui grandissent au lieu d'un plafond silencieux de 800 ; particules en sprites ronds via un petit shader (taille et opacité par particule) ; traînée en ruban échantillonnée dans le temps (et non par frame), réinitialisée au spawn.
  - Fichiers : `client/src/entities/BladeView.ts`, `client/src/fx/Particles.ts`, `client/src/entities/PlayerView.ts`.
  - Acceptation : 2 000 lames à l'écran sans pic de frame lors des morts ; aucune lame invisible ; particules rondes ; traînée de même longueur à 30 et 144 FPS.

- [ ] **2.7 — Alléger le client** · S · `CLI-03`
  - Quoi : chargement différé de Tone.js (au premier geste) et de Supabase (si configuré, à l'ouverture du panneau d'auth ou si une session existe) ; découpage du code de la boutique ; sourcemaps non publiées ; suppression des allocations et `getElementById` par frame.
  - Fichiers : `client/src/main.ts`, `client/src/audio/SoundManager.ts`, `client/src/auth/*.ts`, `client/vite.config.ts`.
  - Acceptation : JavaScript initial < 600 Ko (< 180 Ko gzip).

- [ ] **2.8 — Bench de performance dans la CI** · S · `NET-02` · Dépend de T.1
  - Quoi : script `npm run bench` (autour de `tools/bench-server.js`), exécuté en CI, dont le résultat est publié dans le résumé du workflow ; seuil d'alerte sur le tick moyen à 60 bots.
  - Acceptation : chaque PR affiche tick moyen, p99 et Ko/s par client.

---

## Phase 3 — Première expérience et UX

Objectif : un nouveau joueur comprend le jeu, survit à sa première minute et sait ce qui se passe à l'écran.

- [ ] **3.1 — Onboarding** · M · `UX-02`
  - Quoi : au premier lancement, écran des contrôles adapté à l'appareil (clavier et souris ou tactile) et trois règles essentielles ; pendant la première partie, indications contextuelles uniques (lancer quand un ennemi est à portée, boost et son coût, bordure mortelle, bushes) ; page « Comment jouer » depuis le lobby.
  - Fichiers : nouveau `client/src/ui/Onboarding.ts`, `client/index.html`, `client/src/styles.css`, `client/src/main.ts`.
  - Acceptation : les contrôles sont visibles moins de 3 s après la première entrée en jeu ; chaque indication n'apparaît qu'une fois (mémorisée localement).

- [ ] **3.2 — Spawn sûr et période de grâce** · M · `GAME-03`
  - Quoi : spawn dans un rayon d'environ 150 u (loin de la bordure), à une distance des autres joueurs qui croît avec leur nombre de lames, en privilégiant les zones avec des lames au sol (meilleur de 30 candidats). Les bots ignorent un joueur apparu depuis moins de 10 s, sauf s'il les attaque. La protection s'arrête dès que le joueur lance ou touche quelqu'un.
  - Fichiers : `server/src/rooms/ArenaRoom.ts`, `server/src/systems/bots.ts`.
  - Acceptation : banc de sessions scriptées (joueurs qui marchent au hasard) : temps médian avant la première mort > 45 s, contre ~10 s à l'audit.

- [ ] **3.3 — Bordure lisible** · S · `UX-03` `GFX-04`
  - Quoi : cercle de l'arène sur la minimap ; à moins de 25 u de la zone mortelle, vignette rouge progressive et son d'alerte ; mur animé qui paraît dangereux ; effet spécifique quand une lame est détruite par le mur.
  - Fichiers : `client/src/ui/Minimap.ts`, `client/src/scene/Ground.ts`, `client/src/scene/PostFX.ts`, `client/src/audio/SoundManager.ts`, `client/src/main.ts`.
  - Acceptation : en test, aucun joueur ne meurt contre la bordure sans avoir reçu d'alerte.

- [ ] **3.4 — HUD utile** · M · `UX-05` `FEEL-05` `GFX-01`
  - Quoi : fil des éliminations (4 lignes, 4 s) ; « +N 🏆 » flottant sur les évènements qui rapportent ; record personnel ; classement compact (top 5 + soi) ; nametags activés par défaut pour les joueurs proches, avec nombre de lames et couleur de menace (plus fort ou plus faible que soi) ; ping affiché ; remplacement de la barre de « boost » par une information réelle (coût du boost en lames/s) ; compteur de lames déplacé pour ne plus masquer la zone sous le joueur.
  - Fichiers : `client/src/ui/*.ts`, `client/src/scene/NametagOverlay.ts`, `client/index.html`, `client/src/styles.css`, `client/src/main.ts`.
  - Acceptation : lisible en 390 px de large ; comparaison avec les captures de l'audit.

- [ ] **3.5 — Mort et respawn** · M · `UX-09`
  - Quoi : 2 à 3 s de caméra sur le tueur (avec son nombre de lames), puis la carte récapitulative : score, record personnel, trophées, cause de la mort et un conseil adapté (bordure, lancer, joueur plus gros) ; texte invité corrigé.
  - Fichiers : `client/src/ui/DeathScreen.ts`, `client/src/main.ts`, `client/src/scene/Camera.ts`.
  - Acceptation : la cause de la mort est toujours compréhensible ; le texte invité ne laisse pas croire que les trophées sont perdus.

- [ ] **3.6 — Mobile** · M · `UX-04`
  - Quoi : lobby responsive (onglets de mode sur deux lignes ou empilés sous 480 px), HUD portrait (classement repliable), zones de sécurité (`env(safe-area-inset-*)`), cibles tactiles d'au moins 44 px, vibration courte au coup et à l'élimination quand c'est supporté.
  - Fichiers : `client/src/styles.css`, `client/index.html`, `client/src/ui/*.ts`, `client/src/input/TouchJoystick.ts`.
  - Acceptation : aucun débordement à 360 px ; toutes les actions accessibles avec les pouces.

- [ ] **3.7 — Internationalisation** · M · `UX-06` · Décision D1
  - Quoi : module `client/src/i18n/` (dictionnaires fr et en), extraction de toutes les chaînes, sélecteur dans les réglages, `<html lang>` mis à jour.
  - Acceptation : aucun écran ne mélange deux langues.

- [ ] **3.8 — Accessibilité** · M · `UX-08` `GAME-08`
  - Quoi : forme ou icône propre à chaque power-up ; rareté lisible aussi par la silhouette ou l'intensité lumineuse ; palette daltonienne en option ; réglage d'intensité du screen shake (0 à 100 %) et des flashs ; `prefers-reduced-motion` respecté par défaut pour le shake.
  - Acceptation : les cinq power-ups se distinguent sur une capture en niveaux de gris.

- [ ] **3.9 — Finitions d'interface** · S · `UX-07` `UX-09`
  - Quoi : modales du jeu à la place de `alert()`/`confirm()` ; changement de thème ou de qualité en pleine partie appliqué au prochain retour au menu (pas de reload) ; e-mail masqué dans le lobby ; validation du pseudo alignée entre client et API, messages d'erreur clairs.
  - Acceptation : plus aucun `alert(` ni `confirm(` dans `client/src`.

---

## Phase 4 — Profondeur de gameplay et équilibrage

Objectif : une progression qui ne plafonne pas, un snowball maîtrisé, une carte qui vit. Chaque réglage s'appuie sur la télémétrie (4.8).

- [ ] **4.8 — Télémétrie de gameplay** · M · `OPS-04` · À faire en premier dans la phase
  - Quoi : à chaque fin de vie, le serveur enregistre durée, cause de la mort (bordure, lame, lancer, corps), tier du tueur, lames maximum, tier atteint, lancers et touches, temps de boost, public ou privé. Stockage dans une table Supabase (`life_stats`, sans donnée personnelle pour les invités) et quelques vues d'agrégation pour équilibrer.
  - Acceptation : on peut répondre en une requête à « quelle part des premières vies dure moins de 20 s ? » et « quelle est la première cause de mort ? ».

- [ ] **4.1 — Paliers étendus et formes distinctes** · L · `GAME-01`
  - Quoi : 5 à 6 paliers (ordre de grandeur : 1, 10, 25, 50, 100, 200 lames) avec une géométrie procédurale propre à chacun (dague ou flèche, épée, faux, scie, lame runique, aura légendaire), un son et un effet de passage de palier ; croissance de la hitbox plafonnée (voir 4.2) ; échelles calibrées pour éviter la saturation du bloom.
  - Fichiers : `shared/src/constants.ts`, `shared/src/tiers.ts`, nouveau `client/src/entities/bladeGeometries.ts`, `client/src/entities/BladeView.ts`, `client/src/audio/SoundManager.ts`.
  - Acceptation : chaque palier se reconnaît sur une capture ; le bandeau du lobby décrit la réalité.

- [ ] **4.2 — Contre-mesures au snowball et loot de mort** · M · `GAME-02` `GAME-10`
  - Quoi : prime sur le leader (bonus de loot et de trophées à son élimination, affichée sur la couronne) ; bonus « underdog » pour un kill contre un joueur deux fois plus gros ; loot de mort qui privilégie les lames rares ; rendements décroissants de la hitbox au-delà d'un seuil.
  - Acceptation : télémétrie : durée médiane de règne du leader en baisse ; les kills « underdog » représentent une part mesurable des éliminations.

- [ ] **4.3 — Power-ups rééquilibrés** · S · `GAME-08`
  - Quoi : durées de l'ordre de 8, 12, 18 et 25 s selon la rareté ; le power-up Blades donne des lames dont la rareté suit la sienne ; formes distinctes (cf. 3.8).
  - Acceptation : aucun effet ne dure plus de 30 s.

- [ ] **4.6 — Bots plus justes et plus variés** · M · `GAME-09` `GAME-03` · Décision D8
  - Quoi : vision qui respecte les bushes ; niveaux de difficulté, avec plus de bots faciles quand des débutants sont présents ; pas plus d'un bot sur un même nouveau joueur ; indicateur « bot » discret dans le classement.
  - Acceptation : temps médian avant la première mort d'un débutant en hausse (télémétrie).

- [ ] **4.4 — Évènements de carte** · M · `GAME-06`
  - Quoi : un évènement toutes les 90 à 120 s parmi : pluie de lames sur une zone annoncée 5 s avant, caisse légendaire signalée sur la minimap, zone dorée au centre (score doublé tant qu'on y reste) ; bannière et marqueur de minimap.
  - Acceptation : télémétrie : une part mesurable des joueurs converge vers chaque évènement.

- [ ] **4.5 — Arène dont la taille suit la population** · M · `GAME-06` · Décision D9
  - Quoi : rayon jouable fonction du nombre de joueurs (ordre de grandeur 140 à 250 u), qui évolue lentement avec un mur visible en mouvement et des alertes ; spawns et loot dans le rayon courant ; `state.mapRadius` enfin utilisé par le client (sol, mur, minimap).
  - Acceptation : 3 joueurs → ~155 u, 60 joueurs → 250 u ; le mur avance toujours moins vite qu'un joueur et prévient avant.

- [ ] **4.7 — Bushes « Glitch Fields » et structures de carte** · L · `GFX-04` · Reprend les modules 4 et 5 du plan V1
  - Quoi : bushes lisibles (dôme translucide et glitch en cyber, équivalents dans les autres variantes) ; 20 à 25 structures (panneaux holographiques, arches, racks de serveurs) avec colliders dans `shared/src/decor.ts`, sans bloquer spawns, loot ni déplacements des bots ; trois niveaux de qualité.
  - Acceptation : critères des modules 4 et 5 du plan V1 ; pas de baisse de FPS mesurable en qualité Low.

- [ ] **4.9 — Effets visuels marquants** · M · `GFX-03`
  - Quoi : onde de choc aux clashs et aux éliminations, éclats de lame brisée, dissolution à la mort, colonne de lumière au passage de palier, traînées d'aspiration au ramassage, lignes de vitesse au boost, traînée en ruban des projectiles. Budget par niveau de qualité.
  - Acceptation : chaque effet a une version pour chaque niveau de qualité ; aucune perte de lisibilité (principes).

---

## Phase 5 — Méta, rétention et social

Objectif : donner des raisons de revenir le lendemain.

- [ ] **5.1 — Profil joueur** · M · `META-01`
  - Quoi : panneau profil dans le lobby avec statistiques cumulées tirées de `matches` (parties, éliminations, meilleur score, survie moyenne, dernières parties) ; statistiques locales pour les invités.

- [ ] **5.2 — XP et niveaux de compte** · M · `META-01`
  - Quoi : XP par partie selon la performance (non farmable en privé, cf. 0.2), courbe de niveaux, récompenses (cosmétiques de la phase 6, titres), niveau affiché à côté du pseudo.

- [ ] **5.3 — Défis quotidiens et hebdomadaires** · M · `META-01`
  - Quoi : trois défis quotidiens (ex. « Lance 20 lames », « Détruis 5 caisses », « Élimine un joueur plus gros que toi ») et un défi hebdomadaire, suivis côté serveur, remis à zéro à minuit (heure de Paris), récompensés en trophées et XP.

- [ ] **5.4 — Classements temporaires et saisons** · M · `META-02`
  - Quoi : classements du jour, de la semaine et de tous les temps (parties publiques seulement) ; saisons de 4 à 6 semaines avec classement remis à zéro et récompenses ; le lobby affiche la vraie saison.

- [ ] **5.5 — Partage et groupes** · M · `META-03`
  - Quoi : balises Open Graph et image d'aperçu pour les liens partagés ; bouton de partage natif sur mobile (Web Share API) ; plus tard, groupes pour rejoindre une room publique ensemble.

- [ ] **5.6 — Chat et modération** · M · `META-03` `SEC-05` · Reprend le module 8 du plan V1
  - Quoi : filtre de mots (fr et en) pour le chat et les pseudos ; mute d'un joueur côté client ; signalement journalisé ; commandes `/help`, `/me`, `/mute`.

---

## Phase 6 — Cosmétiques visibles et boutique

Objectif : vendre (en trophées) des cosmétiques que les autres voient, sans jamais toucher à la lisibilité ni à l'équité.

- [ ] **6.1 — Loadout cosmétique géré par le serveur** · L · `ECO-03`
  - Quoi : champs `skin`, `bladeSkin`, `trail`, `killFx` synchronisés sur `Player` ; au join, le serveur charge les items équipés depuis l'inventaire (possession vérifiée) ; valeurs par défaut pour les invités ; rendu par joueur dans `PlayerView` et `BladeRenderer` (en gardant l'instancing).

- [ ] **6.2 — Premiers cosmétiques** · L · `ECO-03`
  - Quoi : 6 à 10 skins de personnage, 4 à 6 skins de lames, 4 traînées, 3 effets d'élimination, tous procéduraux ; onglets « Skins » et « Épées » de la boutique fonctionnels.

- [ ] **6.3 — Garde-fous de lisibilité des thèmes** · M · `GFX-02` · Décision D4
  - Quoi : contrat de thème étendu (luminance maximale du sol, couleurs réservées au gameplay, contraste minimal) et script `tools/check-themes` qui vérifie chaque thème ; couleurs de rareté universelles ; correction de Forge Vermeille et Profondeurs Glacées ; mise à jour de la skill `blade-theme` et de `CLAUDE.md`.
  - Acceptation : le script passe pour les quatre thèmes ; les raretés se lisent sur chaque sol.

- [ ] **6.4 — Boutique V2** · M
  - Quoi : catalogue serveur (0.1) étendu aux types d'items, mise en avant tournante, aperçu 3D, équipement des skins sans rechargement.

- [ ] **6.5 — Monétisation en argent réel** · XL · Décision D3 · Hors périmètre tant que D3 n'est pas tranchée
  - Pré-requis si oui : CGV, mentions légales, RGPD, âge minimum, prestataire de paiement, politique de remboursement.

---

## Phase 7 — Modes de jeu

Objectif : de la variété et des parties courtes avec un vrai dénouement. Reprend le module 9 du plan V1.

- [ ] **7.3 — Architecture des modes** · M · Pré-requis de 7.1 et 7.2
  - Quoi : registre de modes côté serveur (règles de score, de spawn, de fin de partie en hooks), `filterBy` sur le mode, colonne `game_mode` dans `matches`, sélecteur de mode dans le lobby.

- [ ] **7.1 — Manches chronométrées** · L · `GAME-05` · Décision D5
  - Quoi : manches de 5 minutes, arène qui se resserre pendant la dernière minute, écran de podium (top 3 et statistiques), relance automatique après 15 s, bonus de trophées selon le classement.

- [ ] **7.2 — Modes équipe** · XL · `GAME-05`
  - Quoi : Team Deathmatch, Last Team Standing, Capture the Flag ; couleurs d'équipe (s'appuie sur les couleurs par joueur de 3.4 et 6.1), spawns symétriques, tableaux de score par équipe et MVP.

---

## Transverse — Qualité, CI, déploiement, documentation

À mener en continu ; T.1, T.2 et T.7 dès les deux premières semaines, T.3 avant toute ouverture large.

- [ ] **T.1 — Intégration continue** · S · `OPS-01`
  - Quoi : workflow GitHub Actions sur chaque push et PR : `npm ci`, `build:shared`, typecheck client et serveur, build du client, tests (T.2), bench (2.8).
  - Acceptation : un push qui casse le typecheck est signalé en rouge.

- [ ] **T.2 — Tests des systèmes serveur** · M · `OPS-01`
  - Quoi : Vitest (ou `node:test`) sur les systèmes critiques : mouvement (collision décor, drain du boost), collisions (dégâts de clash, protection de spawn), lancers (portée, pierce, atterrissage), ramassage, score, orbites et tiers de `shared/`, bots (la fuite ne se bloque jamais).
  - Acceptation : les systèmes touchés par les phases 1 et 2 sont couverts avant leur refactor.

- [ ] **T.3 — Déploiement sans couper les parties** · M · `OPS-01` · Décision D6
  - Quoi : gestion de `SIGTERM` : annonce aux clients (« redémarrage dans 60 s »), plus de nouvelles rooms, puis `gracefullyShutdown()` ; build dans un répertoire séparé puis bascule atomique, redémarrage seulement si tout le build a réussi ; déploiement déclenché manuellement ou à heure creuse plutôt qu'à chaque push ; vérification de santé et retour arrière.
  - Fichiers : `server/src/index.ts`, `auto-deploy.sh`, `systemd/*`, `deploy.sh`.
  - Acceptation : un déploiement pendant une partie affiche un avertissement et ne coupe personne sans préavis ; un build cassé ne remplace jamais la version en ligne.

- [ ] **T.4 — Environnement de préproduction** · S
  - Quoi : une seconde instance (autre port ou sous-domaine) déployée depuis une branche `staging`, pour tester en conditions réelles avant `main`.

- [ ] **T.5 — Hygiène du code** · S · `GFX-05`
  - Quoi : supprimer le code mort (`client/src/scene/palette.ts`, `RARITY_COLOR` et `POWERUP_COLOR` de `shared/`), déplacer les couleurs en dur dans les thèmes (`Decor.ts`, minimap), ajouter ESLint aux côtés du `.prettierrc` existant.

- [ ] **T.6 — Montée de version Colyseus 0.18** · M · `SEC-04` · Après T.2
  - Quoi : migrer `@colyseus/core`, `ws-transport`, `schema` et `colyseus.js` ; corrige la vulnérabilité `nanoid` ; revalider `tools/bench-server.js` (il utilise des internes de la 0.16).

- [ ] **T.7 — Documentation à jour** · S · `OPS-02`
  - Quoi : aligner `README.md` et `CLAUDE.md` sur la réalité (tick et patch 60 Hz, délai de rendu 80 ms, drop de 70 %, formule de score, cible de déploiement réelle, outil de bench, audit, ce plan) ; corriger les commentaires obsolètes de `shared/src/constants.ts`.

- [ ] **T.8 — URL d'API configurable** · S · `OPS-03`
  - Quoi : variable `VITE_API_URL` (même origine par défaut) utilisée par tous les appels `fetch`, ou réécritures dans `vercel.json` ; garder un seul mode de déploiement documenté.
  - Note (phase 0) : `resolveServerEndpoint` (`client/src/net/Connection.ts`) force le port 2567 dès que la page est servie depuis `localhost`, même quand le serveur écoute ailleurs ; seul `VITE_SERVER_URL` permet de s'en écarter. À traiter avec la même configuration.

- [ ] **T.9 — Observabilité** · M · `OPS-04`
  - Quoi : `/api/stats` enrichi (joueurs en ligne, rooms, tick moyen et p99 par room), journaux structurés, alerte de disponibilité externe.

---

## Indicateurs de réussite

| Indicateur | Audit (2026-09) | Cible | Mesuré par |
|---|---|---|---|
| Tick serveur moyen, 60 joueurs | 10,6 ms | < 4 ms | `tools/bench-server.js 60 120` |
| Tick serveur p99, 60 joueurs | 17,5 ms | < 8 ms | idem |
| Données reçues par client, 60 joueurs | 93 Ko/s | < 45 Ko/s (2.3), < 30 Ko/s (2.4) | idem |
| Écart angulaire rendu / serveur des lames | arbitraire | < 0,1 rad | mode debug de 1.1 |
| Temps médian avant la première mort (session scriptée) | ~10 s | > 45 s | banc de sessions de 3.2 |
| Premières vies de moins de 20 s (joueurs réels) | inconnu | < 15 % | télémétrie 4.8 |
| JavaScript initial | 1,24 Mo | < 600 Ko | build Vite |
| Vulnérabilités npm en production | 15 (1 haute) | 0 haute | `npm audit --omit=dev` |
| Tests automatisés | 0 | systèmes critiques couverts | CI |

---

## Héritage du plan V1

Ce qui a été livré dans le plan V1 reste acquis : population de bots (15 joueurs minimum, 10 bots maximum), IA par scoring avec personnalités, suppression de la fusion, rotation dynamique, lancer de lame, correctifs du module 6, chat en jeu (module 8, partie de base).

Correspondance des éléments non terminés du plan V1 :

| Plan V1 | Plan V2 |
|---|---|
| 1.4 Performance serveur (tick < 30 ms avec 25 bots) | Vérifié par l'audit (4,1 ms en moyenne à 25 bots) ; suite dans 2.1, 2.2, 2.8 |
| Module 4 — Bushes « Glitch Fields » | 4.7 |
| Module 5 — Structures de map | 4.7 |
| Module 7 — Exigences non fonctionnelles | Indicateurs de réussite, phase 2 |
| Module 8 — Chat : filtrage, commandes, horodatage | 5.6 |
| Module 9 — Modes de jeu | Phase 7 |
