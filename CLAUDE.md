# CLAUDE.md

Guide pour Claude (et autres assistants IA) qui travaillent sur ce repo.

> **Pour le contexte produit/gameplay**, lire `README.md` (anglais) et `PLAN.md` (français, plan d'amélioration V2 à suivre, cases à cocher). Chaque tâche du plan renvoie aux constats de l'audit `docs/AUDIT-2026-09.md` (preuves `fichier:ligne`, mesures de référence). Performance serveur : mesurer avant/après avec `node tools/bench-server.js`. Bots ou combat : vérifier que les premières secondes d'un débutant ne deviennent pas plus meurtrières avec `node tools/bench-survival.js` (après `npm test`), et `node tools/bench-survival.js first` pour le temps avant sa première mort (débutant par défaut, que les bots ménagent ; `BENCH_RETURNING=1` pour un joueur qui revient) ; équilibre entre gros et petits joueurs (prime, loot, paliers) : `node tools/bench-snowball.js` (durée des règnes du leader, kills « underdog »). La section « Actions manuelles en attente » de `PLAN.md` liste ce que le owner doit faire à la main (Supabase, production, fusion) : la lui rappeler en fin de tâche tant qu'elle n'est pas vide. Ce document se concentre sur **ce qu'il faut savoir pour coder dans la base sans casser quoi que ce soit**, avec un focus sur le système de thèmes cosmétiques évolutif.

---

## Stack & Architecture

```
shared/    Constantes et types — source de vérité gameplay (positions de
           collision, balance, enums…). Importé par client ET serveur.
server/    Colyseus authoritative room. Tick et patchs à 60 Hz, simulation
           complète. Le serveur ne sait rien des couleurs/visuels — c'est
           cosmétique.
client/    Vite + Three.js + Colyseus.js. Entités distantes rendues 80 ms
           dans le passé (interpolation) + prédiction locale +
           reconciliation pour le joueur courant.
```

**Règles d'or** :
- `shared/` est un **contrat**. Toute modif y casse client+serveur+balance. Touchez avec précaution.
- Le **serveur est autoritatif**. Le client envoie `{dx, dy, boost, throw}` (plus `aimX/aimY`, la visée d'un lancer) et reçoit des snapshots. Ne tentez pas de "fixer" un comportement gameplay côté client — c'est forcément côté serveur.
- **Tout est procédural** : zéro asset PNG/SVG. Géométries Three.js + shaders GLSL inline. Conséquence : tout s'instancie, tout se thème.

---

## Rendu côté client — vue d'ensemble

```
client/src/
├── main.ts              Game class — boucle requestAnimationFrame, dispatch
│                        des messages serveur, gestion FX bursts
├── scene/
│   ├── Scene.ts         WebGLRenderer + camera + lumières + fog (depuis thème)
│   ├── Camera.ts        CameraRig — cadrage partagé (CAMERA_* dans shared/),
│   │                    recul selon l'orbite et le format d'écran
│   ├── Ground.ts        Sol shader (rich/simple/flat) — sources GLSL du thème
│   ├── Decor.ts         Pilier central + obélisques + bushes + cubes/lanternes
│   │                    DISPATCH cyber/spirit selon theme.decor.kind
│   ├── PostFX.ts        EffectComposer (bloom + chroma + vignette + grain)
│   ├── AmbientWisps.ts  Particules d'âme — actif si theme.ambient.wisps != null
│   └── palette.ts       Façade rétrocompat sur le thème actif
├── entities/
│   ├── BladeView.ts     InstancedMesh×24 (4 raretés × 6 tiers), flash
│   │                    blanc par instance (attribut aFlash) ; capacité
│   │                    qui double au besoin, retrait en O(1)
│   ├── bladeGeometries.ts Une forme par palier (dague → lame à aura)
│   ├── PlayerView.ts    Capsule corps + tête + ring + halo + traînée
│   │                    (ruban échantillonné dans le temps, joueur local)
│   ├── CrateView.ts     Boîte émissive + edges
│   ├── PowerUpView.ts   Octaèdres flottants + pilier vertical + ring sol
│   └── AimIndicator.ts  Trajectoire du prochain lancer au sol (visée)
├── fx/
│   ├── Particles.ts     Pool de Points pour bursts (sparks/explosions),
│   │                    disques additifs (shader : taille, opacité)
│   └── ScreenShake.ts
├── themes/              ★ Système de thèmes — voir section dédiée plus bas
├── cosmetics/           Cosmétiques visibles par tous (looks.ts : apparence,
│                        loadout.ts : équipement de l'appareil)
├── boutique/            Boutique : thèmes de carte (Boutique.ts), onglets
│                        À LA UNE, SKINS, LAMES, EFFETS (cosmeticsShop.ts,
│                        aperçus CSS), vitrine du jour (offer.ts), aperçu
│                        3D d'essayage (PreviewStage.ts)
├── audio/SoundManager.ts Tone.js synth + HTMLAudio tracks
├── ui/                  HUD, Login, Death, Leaderboard, Minimap, Settings,
│                        CombatFeedback (repères de perte, gains « +N 🏆 »),
│                        KillFeed (fil des éliminations), personalBest
│                        (record local), Onboarding (carte des contrôles,
│                        indications uniques, page « How to play »),
│                        ProfilePanel + localStats (profil : stats du
│                        compte ou de l'appareil), LeaderboardView
│                        (classements à onglets : lobby et profil),
│                        share (partage natif ou lien copié, invitations)
├── i18n/                Textes fr et en (dictionnaires, t(), data-i18n)
└── quality.ts           Presets ultra/low/medium/high + détection auto + dyn-res
```

### Synchronisation client/serveur — important

- Les entités distantes sont rendues `RENDER_DELAY` (80 ms) dans le passé.
  `ServerClock` (`client/src/net/ServerClock.ts`) estime le tick serveur
  correspondant : le **tick de rendu** de la frame.
- **Orbites** : angle d'une lame = `orbitSlotAngle(anneau, slot, n, θ,
  spinPhase)` (`shared/src/orbits.ts`), où θ est l'horloge d'orbite du
  joueur, synchronisée sous forme de segment (`orbitPhase`, `orbitTick`,
  `orbitRate`) et recalée à chaque changement de vitesse. Serveur et
  clients calculent le même angle pour un tick donné. Ne jamais
  réintroduire un temps local (horloge du navigateur, somme de `dt`) dans
  ce calcul.
- **Évènements de combat** (clash, lame détruite, impact, kill…) et
  changements des lames en orbite : estampillés du tick serveur
  (`TickStamped`, `emit()` côté serveur) et joués quand le tick de rendu
  l'atteint (`atTick()` dans `client/src/main.ts`). Tout nouvel évènement
  positionnel suit ce chemin, sinon il apparaît 80 ms avant l'image
  correspondante.
- **Mouvement** : un input = un pas de `SERVER_DT`, appliqué dans l'ordre
  par le serveur (file d'inputs, `lastSeq` acquitte le dernier appliqué).
  Le pas est la fonction partagée `stepMovement` (`shared/src/movement.ts`)
  et le client rejoue ses inputs non acquittés avec `InputPredictor`
  (`shared/src/prediction.ts`). Toute règle de déplacement (vitesse,
  boost, Speed, recul, hitlag, décor) se change dans `stepMovement`,
  jamais d'un seul côté : sinon la prédiction se trompe à chaque pas.
  Test de référence : `server/test/prediction.test.ts`.
- **Zone d'intérêt** (`server/src/systems/interest.ts`) : chaque client ne
  reçoit que les joueurs et les lames proches (`@view()` sur
  `players`/`blades`, rayon annoncé par le client via le message `view`,
  borné par `VIEW_RADIUS_*`), et jamais un joueur caché dans un buisson
  tant que les orbites ne peuvent pas se toucher (`isHiddenFrom`, aussi
  appliqué aux bots). Le client ne doit donc jamais supposer qu'il a tous
  les joueurs : classement, rang et minimap viennent du message `summary`
  (2 Hz). Un évènement positionnel passe par `emit(type, payload, scope)`
  pour n'aller qu'aux clients concernés : sans portée, il est diffusé à
  tous et peut trahir un joueur caché.
- **Mode debug** : `?debug=hitbox` dans l'URL dessine les hitbox serveur
  des lames proches et affiche l'écart client/serveur (orbites, étincelles).

### Quality presets — important

`getPresetConfig()` détecte le GPU via `WEBGL_debug_renderer_info` et choisit
parmi `ultra | low | medium | high` (`ultra` est le mode le plus **léger**,
« potato mode », pas le plus beau). Chaque module de rendu prend `q: QualityConfig`
en constructeur et adapte son détail (segments, post-FX, instances). Un moniteur
FPS adaptatif baisse `resScale` runtime puis downgrade le preset si nécessaire
(en pleine partie : post-FX coupés à chaud, preset appliqué au retour menu —
jamais de rechargement pendant un match). Il se met en pause boutique ouverte
(`isBoutiqueOpen`) : l'aperçu 3D y fausse la mesure, et changer de preset au
lobby recharge la page.

**Conséquence** : tout nouveau code de rendu doit gérer **les 3 niveaux de
détail** (`rich`, `simple`, `minimal`) ou au moins ne pas casser les low/ultra.

### Mobile — important

- La page couvre tout l'écran (`viewport-fit=cover`) : `#hud` est décalé
  dans la zone sûre (variables `--safe-*` en fin de `styles.css`) et sert
  de référence à ses éléments, `fixed` compris. Un nouvel élément du HUD
  va dans `#hud` ; un élément placé aux coordonnées écran du canvas
  (nametags, couronne, repères de combat) reste **hors** du HUD, sinon il
  se décale de l'encoche.
- Cibles tactiles d'au moins 44 px (`@media (pointer: coarse)`), champs de
  texte en 16 px (en dessous, iOS zoome au focus).
- Formats vérifiés : 360×640, 390×844, 640×360, 844×390 (petits écrans :
  `max-width: 480px` pour le lobby, `max-height: 500px` pour le paysage).

---

## ★ Système de thèmes — `client/src/themes/`

Un **thème** = package cosmétique complet d'un match : palette, shader sol,
variant decor, lumières, matériaux des entités, particules ambient, musique.
Tout ce qui change quand on passe d'une ambiance à une autre.

**Ce qui NE change PAS entre thèmes** :
- Positions des obstacles (`DECOR_COLLIDERS`, `BUSHES`, `FLOATING_CUBES` dans `shared/`)
- Mécaniques (vitesse, hitboxes, dégâts, tier thresholds…)
- Layout de la map en général
- Cadrage de la caméra (`CAMERA_*` dans `shared/src/constants.ts`) : il
  décide de ce qu'on voit, donc de l'information disponible

C'est **garanti par construction** : un joueur qui paye pour le thème "Forge
Vermeille" ne voit pas une map différente d'un joueur en thème de base. Pas de
pay-to-win possible.

### ★ Lisibilité : le contrat de thème (tâche 6.3)

Un thème ne doit jamais rendre le jeu plus dur à lire. Le contrat vit dans
`client/src/themes/readability.ts` ; `npm run check:themes`
(`tools/check-themes.mjs`) le vérifie pour chaque thème du registre et pour
la palette daltonienne, et la CI le lance. À lancer après toute retouche de
couleur ou de shader du sol.

- **Raretés, familles universelles (décision D4)** : commune blanche
  (argent), rare bleue (du cyan à l'azur), épique violette, légendaire or ou
  ambre. Plages OKLCH dans `RARITY_FAMILIES` ; un thème choisit sa nuance,
  jamais une autre teinte. Écart CIEDE2000 d'au moins 20 entre deux raretés.
- **Sol sombre et calme** : toutes ses couleurs sont déclarées dans
  `ground.colors` (hex tel qu'à l'écran, `base` = la dominante), luminance
  ≤ 0,03 pour `base`, ≤ 0,12 pour les motifs ; chaque rareté ressort sur
  `base` (contraste ≥ 3) et ne se confond avec aucun motif.
- **Couleurs réservées au gameplay** : la zone mortelle (`palette.boundary`)
  est rouge et loin de toute rareté ; ni le sol ni les raretés ne ressemblent
  aux couleurs de menace (`DANGER_COLOR`, `PREY_COLOR`) ; les particules
  d'ambiance (`ambient.wisps.colors`) ne prennent la couleur d'aucune lame.
- **Shaders du sol** : aucune couleur en dur (`vec3(0.4, 0.1, 0.9)` est
  refusé), uniquement des `mix()` entre les couleurs déclarées (qui bornent
  donc ce qui s'affiche). `Ground.ts` renomme le `main` du thème et ajoute la
  sortie commune : plafond de luminance (`READABILITY.groundMaxLuma`) puis
  conversion vers l'espace de sortie ; le sol s'affiche ainsi pareil avec ou
  sans post-FX.

Le contrôle s'auto-vérifie : il doit refuser les palettes d'avant 6.3
(Forge aux lames couleur de lave, Profondeurs au sol clair, légendaire rose
du Néon comme la zone mortelle…). Non couverts, parce que de forme
distincte : power-ups, caisses, joueurs, décor en volume ; les sceaux et
anneaux du décor au sol restent à 10-12 % d'opacité.

### Anatomie d'un thème

```ts
// themes/Theme.ts définit l'interface
interface Theme {
  id: string;
  displayName: string;
  palette: ThemePalette;       // toutes les couleurs (rarities, fx, players, crate, fog…)
  lighting: ThemeLighting;     // ambient + key + rim DirectionalLight
  blades: ThemeBladeStyle;     // shininess + specular + emissive boost
  decor: DecorVariant;         // discriminated union: cyber | spirit
  ambient: ThemeAmbient;       // wisps config (ou null)
  music: ThemeMusic;           // chemins lobby/battle .mp3
  ground: ThemeGround;         // 3 fragment shader sources + colors (couleurs du sol)
  ui: ThemeUiPalette;          // CSS variables (--cyan, --pink, etc.)
}
```

### Thèmes existants

| ID | Fichier | Decor | Statut |
|---|---|---|---|
| `neon` | `themes/neon.ts` | `cyber` | **Défaut**, gratuit. Cyberpunk d'origine. |
| `sanctuaire` | `themes/sanctuaire.ts` | `spirit` | Boutique, 1500 trophées. Mystique mauve/or. |
| `forge-vermeille` | `themes/forge-vermeille.ts` | `cyber` | Boutique, 3500 trophées. Forge volcanique, lave. |
| `profondeurs-glacees` | `themes/profondeurs-glacees.ts` | `cyber` | Boutique, 6000 trophées. Cathédrale gelée, aurores. |

Les prix vivent dans `shared/src/shop.ts` (voir « Prix en boutique » plus bas).

### Activation

Lecture : `getActiveTheme()` retourne le thème actif (caché en module-level,
résolu une fois depuis `localStorage["blade.theme"]` ou défaut neon).

Switch : `setActiveTheme(id)` persiste dans localStorage. **Le changement
n'est pas hot-swap** : il faut reload pour que les shaders/matériaux/CSS
soient reconstruits. Au lobby, une modale propose de recharger tout de
suite ou au prochain retour au menu ; en partie, le rechargement attend le
retour au menu (`ui/pendingReload.ts`).

Palette daltonienne (option des réglages, `localStorage["blade.colorblind"]`) :
`themes/colorblind.ts` remplace les couleurs des raretés du thème actif et
les couleurs de menace. `getActiveTheme()` renvoie le thème ainsi résolu
(le registre `THEMES` reste intact, pour la boutique) ; les couleurs de
menace se lisent dans `THREAT_COLORS` (`themes/index.ts`), jamais
directement dans `DANGER_COLOR` / `PREY_COLOR`. Même règle de rechargement
que le thème.

CSS : `applyThemeCss()` est appelé **avant** `new Game()` dans `main.ts`. Il
injecte les variables `--cyan`, `--pink`, `--dark`, etc. sur `:root` depuis
`theme.ui`. Toutes les règles CSS utilisent `var(--cyan)` etc., donc le
switch se fait sans toucher au CSS.

---

## ★ Comment ajouter un nouveau thème

C'est conçu pour être **simple et linéaire**. Ordre exact :

### 1. Créer le fichier du thème

`client/src/themes/<id>.ts` — exporter `<ID>_THEME: Theme` qui satisfait
l'interface. Copiez-collez `sanctuaire.ts` ou `neon.ts` comme base et
modifiez les valeurs. Points sensibles :

- **Palette complète obligatoire** : tous les champs de `ThemePalette` doivent
  avoir une valeur. La `rarityGlowComp` se calcule via `computeRarityGlowComp()`
  pour équilibrer le bloom selon la luminance des couleurs choisies.
- **Raretés** : une nuance dans chaque famille universelle (blanc, bleu,
  violet, or), cf. « Lisibilité » plus haut.
- **Ground shader** : 3 variantes obligatoires (`fragRich`, `fragSimple`,
  `fragFlat`) et les couleurs du sol dans `ground.colors` : `Ground.ts` les
  passe en uniforms (`base` → `uBase`, `crack` → `uCrack`), avec `uTime`
  (rich) et `uRadius`. Pas de couleur en dur, seulement des `mix()`.
- **Vérifier** : `npm run check:themes` doit passer (la CI le lance).
- **Decor variant** : choisissez un `kind` existant (`cyber` ou `spirit`) si
  votre thème ressemble à l'un des deux. Sinon, voir étape 2.
- **CSS palette** : 8 variables. Pour la cohérence, choisissez 2 accents
  (cool + warm) qui contrastent.

### 2. (Optionnel) Si la géométrie du décor change radicalement

Le `DecorVariant` est une **discriminated union** dans `themes/Theme.ts`. Pour
ajouter un nouveau "kind" (ex : `glacial` avec des cristaux de glace au lieu
des champignons) :

1. Ajouter le nouveau kind dans `DecorVariant`
2. Dans `client/src/scene/Decor.ts`, ajouter une fonction `createGlacialDecor()`
   sur le modèle de `createCyberDecor` / `createSpiritDecor`
3. Étendre le dispatch dans `createDecor()`

Sinon : si votre thème peut réutiliser `cyber` ou `spirit` en changeant juste
les couleurs (cas le plus fréquent), pas besoin de toucher à `Decor.ts`.

### 3. Enregistrer le thème

Dans `client/src/themes/index.ts` :

```ts
import { GLACIAL_THEME } from "./glacial";

export const THEMES: Record<string, Theme> = {
  [NEON_THEME.id]: NEON_THEME,
  [SANCTUAIRE_THEME.id]: SANCTUAIRE_THEME,
  [GLACIAL_THEME.id]: GLACIAL_THEME,    // ← nouvelle ligne
};
```

C'est tout. Le sélecteur de Settings le détecte automatiquement (`listThemes()`).
Pour le nom et l'accroche affichés, ajouter `theme.<id>.name` et
`theme.<id>.tagline` aux dictionnaires de `client/src/i18n/` (à défaut,
`displayName` et `tagline` du thème s'affichent dans toutes les langues).

### 4. Musique

1. Générer 2 tracks via Suno (lobby ambient + battle action).
2. Placer les fichiers dans `assets/music/` avec un naming `<Theme> Lobby.mp3`
   et `<Theme> Battle.mp3` (espaces autorisés, mais respectez la casse).
3. Étendre `client/package.json` → script `sync-music` :
   ```js
   const tracks = [
     ['Neon Lobby.mp3',           'lobby-neon.mp3'],
     ['Neon Battle.mp3',          'battle-neon.mp3'],
     ['Sanctuaire Lobby.mp3',     'lobby-sanctuaire.mp3'],
     ['Sanctuaire Battle.mp3',    'battle-sanctuaire.mp3'],
     ['Glacial Lobby.mp3',        'lobby-glacial.mp3'],     // ← nouvelles
     ['Glacial Battle.mp3',       'battle-glacial.mp3'],   //   lignes
   ];
   ```
4. Dans `themes/glacial.ts`, mettre `music: { lobby: "lobby-glacial.mp3", battle: "battle-glacial.mp3" }`.

### 5. Prix en boutique

Un thème est **gratuit par défaut** (possédé par tous). Pour le vendre,
ajouter son entrée dans le catalogue `SHOP_ITEMS` de `shared/src/shop.ts`
(`{ id, kind: "theme", price }`). Ce catalogue est la seule source de prix :
le serveur y relit le prix au moment de l'achat et la boutique l'affiche.
Ne jamais remettre de `price` dans l'objet `Theme` ni accepter un prix venant
du client.

Le prix débité est celui du jour (`priceToday`, `shared/src/shop.ts`) : -20 %
pour les trois cosmétiques à la une (`shopOffer`, tirage du jour de Paris,
servi par `GET /api/shop`) ; les thèmes de carte n'y passent jamais.
`/api/wallet/purchase` reçoit l'`item_id` et `expected_price`, le prix
affiché, qui ne sert qu'à comparer (`server/src/auth/shopQuote.ts`) : s'il
diffère (vitrine tournée à minuit pendant l'achat), l'achat est refusé en
409 `price_changed`, sans débit.

---

## Conventions de code

- **Commentaires** : français, expliquent le **pourquoi** (contraintes,
  invariants, bugs résolus). Pas le **quoi** (le code l'exprime déjà). Voir
  les fichiers existants pour le ton.
- **Textes de l'interface** : jamais en dur. Clé dans `client/src/i18n/en.ts`
  et `fr.ts` (le compilateur exige les mêmes clés dans les deux), `t("clé")`
  en TS, `data-i18n` / `data-i18n-html` / `data-i18n-attr` dans le HTML. Un
  module qui garde du texte déjà rendu s'abonne à `onLangChange()` : la
  langue change à chaud, sans rechargement. Les pseudos et autres textes de
  joueurs s'échappent avant d'entrer dans un `data-i18n-html` ou un `t()`
  inséré en HTML.
- **Couleurs** : ne **jamais** hardcoder un hex en dehors de `themes/*.ts`
  et `cosmetics/looks.ts` (apparence des cosmétiques, des données comme
  les thèmes).
  Tous les modules de rendu lisent via `getActiveTheme()`. Si vous voyez un
  `0xff2ea8` en dehors de ces deux endroits, c'est un bug à corriger.
- **Accessibilité** (tâche 3.8) : une information ne passe jamais par la
  seule couleur (forme, symbole ou taille en plus : formes des power-ups,
  ▲/▼ des nametags, taille des raretés). Toute secousse passe par
  `camera.shake` (le réglage du joueur s'y applique) ; tout nouveau flash,
  éclat ou clignotement suit le réglage des flashs (`setFlashIntensity`,
  appelé depuis `settings.onChange` dans `main.ts`). Une nouvelle couleur
  qui code une information se vérifie sous daltonisme simulé.
- **Shaders** : commentez les passes (qu'est-ce qui anime, qu'est-ce qui dérive).
  Précisez `precision highp/mediump/lowp` selon le niveau de qualité visé.
- **Performance** :
  - Le serveur de production est une seedbox à 40 Gbit/s (décision D6 du
    plan) : ni la bande passante ni le CPU ne sont des contraintes (tick à
    ~2 ms pour 60 joueurs). Ne pas sacrifier le ressenti (fréquence de
    patch, précision des positions) pour économiser des octets. Le client,
    lui, doit rester sobre : mobiles et petites machines.
  - Pré-allouez `Vector3`/`Quaternion`/`Euler`/`Matrix4` hors des boucles
    de mise à jour (pattern `tmpPos`, `tmpQuat`, etc. omniprésent).
  - Préférez `InstancedMesh` à des `Mesh` multiples. Désactivez `frustumCulled`
    quand les meshes sont garantis visibles ou quand le test coûte plus que le
    skip.
  - Désactivez `matrixAutoUpdate` sur les meshes statiques + appelez
    `updateMatrix()` une fois.
- **Server-authoritative** : ne jamais stocker un état gameplay côté client
  (HP d'une crate, position d'un joueur, etc.). Tout vient des snapshots
  Colyseus.

---

## Gotchas connus

- **Méta (phase 5)** : l'XP, ce sont les trophées gagnés en public
  (`wallets.total_earned`, solde invité) ; courbe de niveaux dans
  `shared/src/levels.ts`. Les défis (`shared/src/challenges.ts`) sont tirés
  d'après la date de Paris, les mêmes pour tous ; le serveur les fait
  avancer à chaque fin de vie publique (`advanceChallengesFor` dans
  `ArenaRoom`, fonction SQL `advance_challenges`, migration 0008, qui
  crédite aussi la récompense). Une nouvelle métrique de défi se compte
  par vie sur `Player` (remise à zéro au respawn) et entre dans
  `LifeChallengeStats`. Saisons et classements de période :
  `shared/src/seasons.ts` calcule les bornes (heure de Paris), la base
  ne fait que filtrer (`leaderboard_since`, migration 0009). Le serveur
  clôt les saisons finies au démarrage puis toutes les heures
  (`scheduleSeasonClosing`) ; `close_season` récompense une seule fois
  (`seasons_closed` sert de verrou). Changer `SEASON_WEEKS` ou
  `SEASON_ONE_START` renumérote les saisons passées : à ne faire qu'avant
  la première clôture.
- **Modération (tâche 5.6)** : le filtre de mots vit dans
  `shared/src/moderation.ts` (`censorChat`, `nameProblem`), utilisé par le
  serveur (chat masqué, pseudos remplacés, classements) et par le client
  (refus dès le lobby). Pas de recherche de sous-chaîne aveugle : mots
  entiers, plus quelques racines sans faux positif connu ; un mot ajouté
  se vérifie contre la liste de faux positifs de
  `server/test/moderation.test.ts`. Signalements : `handleReport` dans
  `ArenaRoom`, table `reports` (migration 0010).
- **Cosmétiques (phase 6)** : catalogue dans `shared/src/cosmetics.ts`
  (emplacements skin, bladeSkin, trail, killFx ; débloqués au niveau ou
  vendus via `SHOP_ITEMS`), apparence dans `client/src/cosmetics/looks.ts`.
  Le client propose son équipement au join (`options.loadout`), le serveur
  le valide (`validateLoadout` : inventaire du compte et niveau) et le
  synchronise sur `Player`. Lisibilité : un skin ne touche ni l'anneau au
  sol (soi / les autres) ni le halo de protection ; un style de lame
  (attribut d'instance `aStyle`, `STYLE_GLSL` dans `BladeView.ts`) module
  la luminosité, jamais la teinte de rareté ni la forme du palier.
  Ajouter un cosmétique (tâche 6.2) : son entrée dans `DEFS`
  (`shared/src/cosmetics.ts`) avec un niveau, ou un prix dans `SHOP_ITEMS`
  (jamais les deux, `server/test/cosmetics.test.ts` le vérifie) ; son
  apparence dans `looks.ts` et son nom et sa description (`cos.<id>`,
  `cos.<id>.desc`) dans `en.ts` et `fr.ts`, que le compilateur exige. Un
  nouvel accessoire ou style de lame demande aussi sa géométrie
  (`PlayerView.ts`) ou son motif (`STYLE_GLSL`), et son aperçu de boutique
  en CSS (`.cos-acc-<accessoire>`, `.cos-style-<n>` dans `styles.css`).
  Le client ne montre comme possédés que les items que le serveur
  accepterait : un invité n'a que ceux de son niveau.
  Boutique V2 (tâche 6.4) : la vitrine du jour (`shopOffer`,
  `shared/src/shop.ts`) est tirée d'après la date de Paris, les mêmes
  articles pour tous, jamais ceux de la veille (chaîne depuis
  `FEATURED_EPOCH`) ; le client la lit sur `GET /api/shop` (`offer.ts`,
  calcul local en secours). Aperçu 3D (`PreviewStage.ts`) : un second
  renderer WebGL sans post-FX qui reprend `PlayerView`, `BladeRenderer` et
  `ParticlePool`, un seul canvas déplacé d'onglet en onglet, boucle active
  boutique ouverte seulement, absent en potato. Un nouveau cosmétique y
  apparaît sans rien ajouter, s'il passe par ces modules.
- **Partage (tâche 5.5)** : les balises d'aperçu des liens (Open Graph)
  sont écrites par le serveur à chaque requête de page, entre
  `<!-- og:start -->` et `<!-- og:end -->` dans `client/index.html`
  (`server/src/http/ogTags.ts`) : garder ces marqueurs. L'image `og.jpg`
  est dessinée au build par le plugin Vite de `client/vite.config.ts`
  (`client/tools/ogImage.ts`, couleurs du thème neon, encodeur JPEG
  maison : le PNG des halos dépassait les ~300 Ko qu'accepte WhatsApp).
  Lien « rejoins-moi » : `?join=<roomId>`, rejoint par `joinById` ; un
  salon privé exige son code jusque dans `onAuth`.
- **Build et CI** : `npm run build` (shared, puis serveur, puis client)
  passe avec la version de TypeScript verrouillée (5.9.3) ; l'ancien
  plantage de `build:shared` ne se reproduit plus. La CI GitHub Actions
  (`.github/workflows/ci.yml`) rejoue ce build complet puis `npm test` et
  `npm run check:themes` à chaque push : elle doit être verte avant de
  pousser sur `main`.
- **Tests serveur** : `npm test` (`server/test/*.test.ts`, `node:test`
  compilé par `tsc` vers `server/dist-test/`, gitignoré). Les systèmes
  lisent `Date.now()` et `Math.random()` : utiliser `FakeClock` et
  `seedRandom` de `server/test/helpers.ts`, et `TestRoom` pour une room
  complète hors réseau. Toute modification d'un système serveur passe par
  ces tests ; un changement de comportement voulu met le test à jour dans
  le même commit.
- **Télémétrie** (`server/src/telemetry.ts`) : chaque fin de vie humaine
  écrit une ligne `life_stats` (Supabase, migration 0005). Une nouvelle
  façon de finir une vie s'ajoute au type `LifeEnd` **et** à la contrainte
  `check` de la colonne `cause`, par une nouvelle migration : sinon
  l'insertion échoue (un avertissement par minute dans les logs).
- **Arrêt du serveur** : sur SIGINT/SIGTERM, le serveur annonce le
  redémarrage, refuse les entrées et attend le départ des joueurs
  (`server/src/shutdown.ts`, préavis `RESTART_NOTICE_MS` : 60 s en
  production, aucun par défaut en dev). Toute écriture asynchrone de fin de
  partie (Supabase) passe par `trackWrite()`, sinon elle peut se perdre à
  l'arrêt.
- **`client/public/` est gitignoré**. Le dossier est régénéré au `predev`/
  `prebuild` par `sync-music`. N'y commitez rien à la main.
- **Suppression de branches sur le remote local** (`http://127.0.0.1:.../`) :
  retourne 403. Le sandbox autorise les push de commits mais pas les
  deletions. Pour cleaner les feature branches, demandez à l'utilisateur de
  le faire depuis sa machine ou via GitHub web.
- **Fichiers musicaux** : les `.mp3` source vivent dans `assets/music/` (pas
  dans `client/`). Le script `sync-music` les copie vers `client/public/`
  sous les noms repris dans `theme.music` (`lobby-<nom>.mp3`,
  `battle-<nom>.mp3`, ex. `lobby-forge.mp3`).
- **Cadrage** : `CAMERA_PITCH_DEG` sous ~45° tue la lisibilité .io (à 30°
  on perd la perception des menaces ; le top-down strict est laid). La
  distance suit l'orbite et le format d'écran (`CameraRig`) ; tout ce qui
  dépend de la distance à la caméra (brouillard, plan lointain) doit la
  suivre aussi (`SceneStack.setViewDistance`).

---

## Workflow git

- Pousser sur `main` direct est OK pour le owner du repo (pas de PR
  obligatoire pour ce projet).
- Branches de feature `claude/<task-name>` créées par les sessions, à
  cleaner après merge (depuis la machine du dev, pas le sandbox).
- Le déploiement de production est auto-hébergé (tâche T.3) :
  `auto-deploy.sh` construit `main` dans une release à part (`npm ci`, build
  complet, tests), bascule le lien `~/bladeio-current`, redémarre via pm2
  (`ecosystem.config.js`) avec un préavis de 60 s aux joueurs, vérifie
  `/healthz` et revient à la release précédente en cas d'échec. Le timer de
  `systemd/` le lance chaque jour à 5 h : un push sur `main` n'est plus
  déployé tout de suite (`systemctl start bladeio-autodeploy.service` pour
  déployer maintenant). Attendre que la CI soit verte sur la branche avant
  de fusionner.
  Les fichiers Render/Vercel/Docker restent des alternatives documentées
  dans le README, pas la cible actuelle.
