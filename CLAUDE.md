# CLAUDE.md

Guide pour Claude (et autres assistants IA) qui travaillent sur ce repo.

> **Pour le contexte produit/gameplay**, lire `README.md` (anglais) et `PLAN.md` (français, plan d'amélioration V2 à suivre, cases à cocher). Chaque tâche du plan renvoie aux constats de l'audit `docs/AUDIT-2026-09.md` (preuves `fichier:ligne`, mesures de référence). Performance serveur : mesurer avant/après avec `node tools/bench-server.js` (`BENCH_SEED=<n>` : même partie avant et après, l'écart ne vient que du code mesuré). Bots ou combat : vérifier que les premières secondes d'un débutant ne deviennent pas plus meurtrières avec `node tools/bench-survival.js` (après `npm test`), et `node tools/bench-survival.js first` pour le temps avant sa première mort (débutant par défaut, que les bots ménagent ; `BENCH_RETURNING=1` pour un joueur qui revient) ; équilibre entre gros et petits joueurs (prime, loot, paliers) : `node tools/bench-snowball.js` (durée des règnes du leader, kills « underdog ») ; contact de deux grosses orbites (collisions, destructions de lames) : `node tools/bench-giants.js` (après `npm test`) ; champions face à un joueur aguerri à grosse orbite : `node tools/bench-champions.js` (après `npm test`). La section « Actions manuelles en attente » de `PLAN.md` liste ce que le owner doit faire à la main (Supabase, production, fusion) : la lui rappeler en fin de tâche tant qu'elle n'est pas vide. Ce document se concentre sur **ce qu'il faut savoir pour coder dans la base sans casser quoi que ce soit**, avec un focus sur le système de thèmes cosmétiques évolutif.

---

## Stack & Architecture

```
shared/    Constantes et types — source de vérité gameplay (positions de
           collision, balance, enums…). Importé par client ET serveur.
server/    Colyseus authoritative room. Tick et patchs à 60 Hz, simulation
           complète. Le serveur ne sait rien des couleurs/visuels — c'est
           cosmétique.
client/    Vite + Three.js + SDK Colyseus. Entités distantes rendues 80 ms
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
├── boot.ts              Point d'entrée : lobby monté tout de suite (thème,
│                        langue, formulaire, réglages, profil, aide,
│                        boutique, musique), moteur (main.ts) chargé en
│                        parallèle (tâche 2.7)
├── main.ts              Game class — moteur : boucle requestAnimationFrame,
│                        dispatch des messages serveur, gestion FX bursts
├── scene/
│   ├── Scene.ts         WebGLRenderer + camera + lumières + fog (depuis thème)
│   ├── Camera.ts        CameraRig — cadrage partagé (CAMERA_* dans shared/),
│   │                    recul selon l'orbite et le format d'écran
│   ├── Ground.ts        Sol shader (rich/simple/flat) — sources GLSL du thème
│   ├── Decor.ts         Pilier central + obélisques + cubes/lanternes
│   │                    DISPATCH cyber/spirit selon theme.decor.kind
│   ├── Bushes.ts        Buissons « Glitch Fields » (dôme, halo, particules)
│   ├── Structures.ts    Panneaux holo, arches, racks, pads à drone, cristaux
│   ├── PostFX.ts        Cible HDR de la scène, bloom, puis une passe finale
│   │                    (chroma, vignette, grain, sRGB) ; résolution
│   │                    dynamique dans une partie de la cible
│   ├── shaderWarmup.ts  Shaders compilés au lobby (tâche 2.9)
│   ├── renderScale.ts   Tailles en pixels rapportées à la partie dessinée
│   ├── MapEventView.ts  Zone au sol d'un évènement de carte (pluie, zone dorée)
│   ├── AmbientWisps.ts  Particules d'âme — actif si theme.ambient.wisps != null
│   └── palette.ts       Façade rétrocompat sur le thème actif
├── entities/
│   ├── BladeView.ts     InstancedMesh×24 (4 raretés × 6 tiers), flash
│   │                    blanc par instance (attribut aFlash) ; capacité
│   │                    qui double au besoin, retrait en O(1) ; position
│   │                    dessinée des lames rapides → traînées (setTrailSink)
│   ├── bladeGeometries.ts Une forme par palier (dague → lame à aura)
│   ├── PlayerView.ts    Capsule corps + tête + ring + halo + traînée
│   │                    (ruban échantillonné dans le temps : joueur local,
│   │                    et tout joueur qui a une traînée équipée)
│   │                    + dissolution à la mort (shader injecté)
│   ├── CrateView.ts     Boîte émissive + edges
│   ├── PowerUpView.ts   Octaèdres flottants + pilier vertical + ring sol
│   ├── FlagView.ts      Drapeaux et bases de la capture du drapeau
│   └── AimIndicator.ts  Trajectoire du prochain lancer au sol (visée)
├── fx/
│   ├── Particles.ts     Pool de Points pour bursts (sparks/explosions),
│   │                    disques additifs (shader : taille, opacité)
│   ├── CombatFx.ts      Effets de combat (4.9) : ondes de choc
│   │                    (Shockwaves), éclats de lame (Shards), colonnes
│   │                    de lumière (LightColumns), traînées des lames
│   │                    (BladeTrails), lignes de vitesse (SpeedLines)
│   ├── flash.ts         fxIntensity() : réglage des flashs des effets
│   └── ScreenShake.ts
├── themes/              ★ Système de thèmes — voir section dédiée plus bas
├── cosmetics/           Cosmétiques visibles par tous (looks.ts : apparence,
│                        loadout.ts : équipement de l'appareil)
├── boutique/            Boutique : thèmes de carte (Boutique.ts), onglets
│                        À LA UNE, SKINS, LAMES, EFFETS (cosmeticsShop.ts,
│                        aperçus CSS), vitrine du jour (offer.ts), aperçu
│                        3D d'essayage (PreviewStage.ts)
├── audio/SoundManager.ts Tone.js synth (chargé au premier geste, toneLib.ts)
│                        + HTMLAudio tracks
├── ui/                  HUD, Login, Death, Leaderboard, Minimap, Settings,
│                        PerfOverlay (mesure de fluidité, ?debug=perf),
│                        CombatFeedback (repères de perte, gains « +N 🏆 »),
│                        KillFeed (fil des éliminations), personalBest
│                        (record local), Onboarding (carte des contrôles,
│                        indications uniques, page « How to play »),
│                        ProfilePanel + localStats (profil : stats du
│                        compte ou de l'appareil), LeaderboardView
│                        (classements à onglets : lobby et profil),
│                        share (partage natif ou lien copié, invitations),
│                        MatchUi (minuterie et podium d'une partie à fin,
│                        tableau par équipe), FlagHud (état des drapeaux)
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
  borné par `viewRadiusLimit` de `shared/src/camera.ts` : `VIEW_RADIUS_MAX`,
  plus en proportion du recul de caméra que donnent au joueur ses propres
  lames, appliqué à chaque calcul), et jamais un joueur caché dans un buisson
  tant que les orbites ne peuvent pas se toucher (`isHiddenFrom`, aussi
  appliqué aux bots). Le client ne doit donc jamais supposer qu'il a tous
  les joueurs : classement, rang et minimap viennent du message `summary`
  (2 Hz). Un évènement positionnel passe par `emit(type, payload, scope)`
  pour n'aller qu'aux clients concernés : sans portée, il est diffusé à
  tous et peut trahir un joueur caché. Un champ de `Player` qui ne sert
  qu'au client du joueur lui-même (direction, recul, dernier input
  acquitté, effets, stats de la vie) porte `@view(OWNER_VIEW_TAG)` : seule
  sa propre vue a ce tag (tâche 2.3). Un champ lu pour les autres joueurs
  (position, orbite, score, cosmétiques…) ne doit pas le porter, sinon le
  client le lit à `undefined`.
- **Retrait d'un joueur** (mort, sorti de la zone d'intérêt, caché dans
  un buisson, parti) : appliqué au tick du patch sur la ligne de temps
  (`removePlayerView`), comme ses positions. Le serveur retire un mort de
  la vue des autres au tick même du kill : retiré dès réception, il
  disparaissait avant le coup fatal et l'élimination ne le trouvait plus
  (ni effet ni gain affiché). D'ici là, son dernier état se lit par
  `playerState(id)` (map `departing`), jamais directement dans
  `room.state.players`. Un corps qui se dissout finit dans `corpses`.
- **Mode debug** : `?debug=hitbox` dans l'URL dessine les hitbox serveur
  des lames proches et affiche l'écart client/serveur (orbites, étincelles).
  `?debug=perf` affiche la fluidité (FPS, temps de frame médian, p95 et
  pire, échelle de rendu, mode allégé, draw calls, shaders compilés depuis
  l'entrée en partie, qui doit rester à +0) : une capture d'écran suffit à
  diagnostiquer la machine d'un joueur. `window.__bladePerf.me()` y donne
  la position du joueur local aux bancs scriptés, sans le flux de debug
  des orbites de `?debug=hitbox` (qui fausserait la mesure).

### Quality presets — important

`detectPreset()` choisit parmi `ultra | low | medium | high` (`ultra` est le
mode le plus **léger**, « potato mode », pas le plus beau) : le choix des
réglages (`blade.settings`, `qualityChoice` autre que « Auto »), sinon la
baisse automatique de cette version du jeu (`blade.quality.auto`, avec
`__BUILD_ID__` : la version suivante retente la détection), sinon le GPU
(`WEBGL_debug_renderer_info`) : toute carte dédiée, Apple Silicon, Intel Arc
et les iGPU AMD récents en `high` (tâche 2.10 : sous `high`, le néon perd
son éclat ; le rendu passe avant, la résolution dynamique absorbe la
charge). Une baisse automatique ne s'écrit jamais comme un choix du joueur,
et une qualité choisie dans les réglages n'est jamais baissée (seule la
résolution s'adapte).
Chaque module de rendu prend `q: QualityConfig`
en constructeur et adapte son détail (segments, post-FX, instances). Un moniteur
FPS adaptatif baisse d'abord la résolution de rendu (jusqu'à 0,6 en `high`),
puis, seulement après 6 s sous 30 FPS à ce plancher, le preset (en pleine
partie : `PostFX.setLite`, bloom, effets et MSAA coupés
sans recompiler un shader, preset appliqué au retour menu — jamais de
rechargement pendant un match). Si deux baisses de résolution de suite ne
font rien gagner (écran ou navigateur bridé à 30 images par seconde,
économiseur de batterie), il rend la pleine résolution et s'arrête pour la
session (`notFillBound`). Avec post-FX, la résolution dynamique rend la
scène dans une partie de sa cible (`PostFX.setRenderScale`) : rien n'est
réalloué ; sans post-FX, c'est le canvas qui change de taille (un à-coup),
d'où des paliers plus grands et 20 s avant de remonter après une baisse. Il se
met en pause boutique ouverte (`isBoutiqueOpen`) : l'aperçu 3D y fausse la
mesure, et changer de preset au lobby recharge la page. Ne jamais couper le
post-FX en partie autrement que par `setLite` : la destination des matériaux
change, donc tous leurs shaders (une quarantaine de recompilations, des
secondes de gel sous Windows).

**Conséquence** : tout nouveau code de rendu doit gérer **les 3 niveaux de
détail** (`rich`, `simple`, `minimal`) ou au moins ne pas casser les low/ultra.
Les effets de combat ont leur budget dans `q.fx` (`FxBudget` : détail,
plafonds d'instances, facettes, points des traînées) : un nouvel effet y
prend le sien.

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
- Positions des obstacles (`DECOR_COLLIDERS`, `STRUCTURES`, `BUSHES`, `FLOATING_CUBES` dans `shared/`)
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

CSS : `applyThemeCss()` est appelé **avant** toute interface dans `boot.ts`. Il
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
  (rich) et `uRadius`. Pas de couleur en dur, seulement des `mix()`. Les
  thèmes livrés tracent en `fragFlat` (potato) une grille de 20 u, le repère
  minimal pour sentir sa vitesse.
- **Vérifier** : `npm run check:themes` doit passer (la CI le lance).
- **Decor variant** : choisissez un `kind` existant (`cyber` ou `spirit`) si
  votre thème ressemble à l'un des deux. Sinon, voir étape 2. Les
  structures (tâche 4.7) prennent `baseDark`, `structureNeon`,
  `structureScreen` et `structureLed` : loin de la couleur du mur
  (`palette.boundary`). Les buissons, `bushFoliage` et `bushAccent` (cyber)
  ou `mossColor`, `mushroomUnderglow`, `lanternEmissive` et `shrineHalo`
  (spirit).
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
  appelé depuis `settings.onChange` dans `main.ts` ; `fxIntensity()` de
  `fx/flash.ts` : à 0 %, atténué à 35 %, pas éteint). Une nouvelle couleur
  qui code une information se vérifie sous daltonisme simulé.
- **Shaders** : commentez les passes (qu'est-ce qui anime, qu'est-ce qui dérive).
  Précisez `precision highp/mediump/lowp` selon le niveau de qualité visé.
  Jamais de NaN ni d'infini : pas de `pow()` d'une base qui peut être
  négative (même d'un rien, comme `1.0 - dot()` de deux vecteurs
  normalisés), de `normalize()` d'un vecteur qui peut être nul, d'`atan(0,
  0)` ni de division par ce qui peut s'annuler. Le flou du bloom étalait un
  seul pixel NaN en carré noir d'un millier de pixels de côté (Opera GX
  sous Windows : ANGLE y passe par Direct3D) ; son entrée est assainie
  (filtre de luminosité de `PostFX.ts`), mais le pixel fautif reste noir.
  Jamais de `precision` sur un matériau : dans three.js r163, elle fuit sur
  tous les programmes compilés ensuite (la précision dépendait de l'ordre de
  compilation, et un shader compilé d'avance n'avait plus la même clé).
  Un uniform déclaré dans les deux étapes a la même précision dans les deux
  (un fragment en `precision mediump` qui partage `uTime` avec son vertex
  shader le déclare `mediump` des deux côtés), sinon le lien échoue.
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
- **Modes de jeu (tâche 7.3)** : registre partagé dans `shared/src/modes.ts`
  (`GameModeId`, `GAME_MODES` : proposé en partie rapide et/ou en salon
  privé), règles côté serveur dans `server/src/modes/` : l'interface
  `GameMode` est une série de hooks appelés par `ArenaRoom` (`onJoin`,
  `spawnPoint`, `canRespawn`, `onKill`, `standing`, `rankBonus`, `tick`,
  `onMatchStart`) ; le combat, le butin et les lancers restent communs. Un
  mode qui a une fin appelle `host.endMatch(entracte)` : classement figé
  (évènement `matchEnd`), vies en cours enregistrées (cause `match_end`),
  simulation à l'arrêt (`state.phase`, `MatchPhase.Over`, inputs acquittés
  sans pas), puis `restartMatch` (arène vidée, tout le monde réapparaît).
  Matchmaking : `filterBy(["code", "mode"])`, une file publique par mode ;
  rejoindre un code n'envoie pas de mode ; une room créée sans mode
  (client d'avant 7.3) s'inscrit en `ffa` (`listing.mode`). Ajouter un
  mode : son id dans `GameModeId` et `GAME_MODES`, sa fabrique dans
  `server/src/modes/index.ts` et `mode.<id>.name` / `mode.<id>.hint` dans
  `en.ts` et `fr.ts` (le compilateur exige les trois) ; le sélecteur du
  lobby apparaît dès qu'il y a deux modes à proposer. Colonne `game_mode`
  (migration 0011) écrite seulement hors `ffa`, pour que l'arène
  s'enregistre aussi sans la migration. Manches (tâche 7.1,
  `server/src/modes/rounds.ts`) : 5 minutes, points de toutes les vies de
  la manche (`standing`), trophées du podium (`rankBonus`, crédités par la
  room en public), minuterie et podium côté client (`ui/MatchUi.ts`).
  **Rayon de l'arène** : `state.mapRadius` (synchronisé) suit la
  population (tâche 4.5, ci-dessous) et se resserre pendant la dernière
  minute d'une manche ; tout ce qui dépend du bord le lit, jamais
  `MAP_RADIUS` : mur tueur, apparitions et butin (`zoneInner`,
  `systems/spawnPoint.ts`), lancers, bots (`botSafeRadius`), et côté
  client `arenaRadius()` (mur, sol, minimap, alerte de bord). Le sol et
  ses décors gardent la taille de la carte ; le sol s'éteint au-delà du
  mur.
- **Arène à la taille de sa population (tâche 4.5)** : rayon
  `populationRadius(n)` (`shared/src/arena.ts`) : ~155 u à 3 joueurs,
  171 u pour un humain et ses dix bots, la carte entière (250 u) à 60 ;
  n est la plus haute population, bots compris, des 20 dernières
  secondes. `ArenaSizer` (`server/src/systems/arenaSize.ts`) en tire le
  rayon de base (`ModeHost.baseRadius`) dans les modes `adaptiveArena`
  (arène, manches) ; les modes équipe gardent `MAP_RADIUS` (camps à
  160 u du centre). Le mur recule tout de suite (4 u/s au moins, la
  moitié de l'écart par seconde pour un afflux) ; il n'avance qu'après un
  préavis de 10 s (`arenaShrinkAt` et `arenaTarget` dans l'état), à
  1,5 u/s, bien moins vite qu'un joueur (11 u/s). Une room naît petite et
  grandit avec ses arrivées : sans place dégagée, un bot apparaît au plus
  à l'écart (`randomSpawnPoint`), jamais empilé au centre. Pendant le
  préavis, ce qui apparaît vise déjà la cible (`zoneRadius`) ; caisses et
  power-ups restés dehors sont retirés (`applyWallDamage`). Client :
  bannière, future limite en tirets au sol (`BoundaryWall.setTarget`) et
  sur la minimap, sol éteint au-delà du mur (`GroundSurface.setRadius`).
  Le butin garde la densité de la carte entière : plafonds des lames au
  sol, des caisses et des power-ups multipliés par la part de surface de
  l'arène (`areaShare`). Il n'apparaît jamais dans la bande que les bots
  évitent (`LOOT_WALL_MARGIN`, `systems/spawnPoint.ts`), et un bot ne vise
  rien au-delà (`botReachRadius`, `systems/bots.ts`) : sinon il oscillait
  entre sa cible et le mur, et dans une petite arène tous les bots
  finissaient collés au bord, sans plus rien ramasser ni affronter.
  Pendant la rampe de grâce d'un humain, seuls les bots faciles le
  poursuivent, dans un rayon proportionnel à la taille de l'arène ; un
  débutant garde sa grâce sur un contact (un lancer ou une élimination la
  lèvent), et pendant sa grâce les bots ne peuvent pas le tuer
  (`sparedByBots`, `systems/collisions.ts`, appliqué aussi aux lancers) ;
  prendre le drapeau adverse lève la grâce. Les bancs lisent le bord du moment (`state.mapRadius`), jamais
  `MAP_RADIUS`.
- **Modes équipe (tâche 7.2)** : `Player.team` (0 hors équipe, 1 ou 2) et
  `sameTeam()` (`shared/src/modes.ts`). Deux alliés ne se touchent jamais :
  ni clash, ni lame ou corps qui tue (`systems/collisions.ts`), ni
  projectile (`Blade.thrownTeam`, gardé même si le lanceur part), ni
  poursuite ou lancer de bot ; un allié dans un buisson reste visible de
  son équipe (`systems/interest.ts`). **Toute nouvelle source de dégâts
  doit sauter les alliés.** Règles dans `server/src/modes/teams.ts`
  (`TeamMode` : répartition dans la moins nombreuse, apparition dans son
  camp, `teamBase`, classement comme une manche, scores d'équipe
  `state.teamScore1/2`, MVP ; `TdmMode`, `LtsMode`) et `ctf.ts` (drapeaux
  dans `state.flags`, publics, sans zone d'intérêt). Hooks facultatifs de
  `GameMode` : `matchResult` (équipes et MVP dans `matchEnd`),
  `spawnsOnJoin` (arrivée en pleine manche : spectateur), `botsMayJoin`,
  `keepsEliminatedBots`, `onLeave`, `botGoal`. Objectifs des bots
  (`BotGoal`, `BotController.setGoals`) : une action de plus, notée sur la
  même échelle que les autres (fuite au-dessus de 1000, récolte sous 110,
  errance vers 10) ; `targetId` en fait une poursuite, `urgent` autorise les
  lancers à peu de lames. Porteur d'un drapeau : `Player.revealed`, visible
  de tous (zones d'intérêt, bots, minimap). Dernière équipe en vie : un
  humain hors jeu suit un coéquipier, le serveur place sa position sur lui
  (aucun système ne lit la position d'un mort), d'où sa caméra et sa zone
  d'intérêt. Client : un allié a la couleur d'anneau du joueur local
  (`PlayerView.setAlly`) et la marque ◆ (losanges autour de l'anneau,
  nametags, minimap, classement, podium) ; variables CSS `--ally-rgb` et
  `--foe-rgb` ; drapeaux `entities/FlagView.ts` (le sien carré, celui d'en
  face triangulaire), état `ui/FlagHud.ts`, évènements `flag` dans le fil.
- **Évènements de carte (tâche 4.4)** : `server/src/systems/mapEvents.ts`
  (`MapEventSystem`), réglages dans `shared/src/mapEvents.ts`, dans les
  modes où `GameModeInfo.mapEvents` est vrai (arène, manches, match à
  mort). Un à la fois, synchronisé par `state.mapEvent` (type, zone,
  annonce `startsAt`, fin `endsAt`, caisse `crateId`) : le client en tire
  bannière, zone au sol (`scene/MapEventView.ts`), marqueur de minimap et
  badge POINTS ×2. Pluie de lames (lames à échéance, comme le butin),
  caisse légendaire (`Crate.legendary`, butin fixe dans
  `CrateSystem.destroyCrate`), zone dorée : `update()` passe après le
  calcul des scores et ajoute une seconde fois l'écart de score de chaque
  joueur dedans. La minuterie ne part qu'avec un humain dans la room, sans
  aucun tirage avant : une room de bots seuls (bancs) joue à l'identique.
  Chaque évènement fini écrit une ligne `map_events` (migration 0012 ;
  `select * from map_events_summary;` : part des joueurs venus jusqu'à
  lui). Les bots y vont par `botGoal`, combiné avec celui du mode (le plus
  pressant des deux).
- **Modération (tâche 5.6)** : le filtre de mots vit dans
  `shared/src/moderation.ts` (`censorChat`, `nameProblem`), utilisé par le
  serveur (chat masqué, pseudos remplacés, classements) et par le client
  (refus dès le lobby). Pas de recherche de sous-chaîne aveugle : mots
  entiers, plus quelques racines sans faux positif connu ; un mot ajouté
  se vérifie contre la liste de faux positifs de
  `server/test/moderation.test.ts`. Signalements : `handleReport` dans
  `ArenaRoom`, table `reports` (migration 0010).
- **Triche de test** : `/blades [nombre] [rareté]` (alias `/lames`, absente
  de `/help`) dans le chat ajoute des lames en orbite, 50 par défaut, dans
  la limite de `MAX_BLADES_PER_PLAYER`. Le serveur (`handleCheat`,
  `ArenaRoom`) ne l'accepte qu'avec `CHEATS=1` dans son environnement
  (absent par défaut), en salon privé, où rien ne compte (ni trophées, ni
  classement, ni défis, ni record local, télémétrie marquée
  `room_private`), et d'un joueur en vie. Test : `server/test/cheat.test.ts`.
- **Grosses orbites** : plafond `MAX_BLADES_PER_PLAYER` = 2000 lames
  (21 anneaux, 17,8 u de rayon), bien au-delà d'une partie normale (au
  banc de 60 bots, le plus gros plafonne vers 20 lames) ; la triche y va
  d'un coup. `narrowPhaseClash` (`systems/collisions.ts`) ne teste que les
  lames de la zone où deux orbites se recouvrent
  (`contactLens`, rayon mesuré sur les positions du tick) : filtre exact,
  mêmes clashs dans le même ordre que le test de toutes les paires (test
  « grosses orbites » de `collisions.test.ts`). Pendant les collisions, les
  anneaux touchés se recompactent une seule fois, à la fin
  (`pendingRecompact`, `recompactOwnerRings`), et les ajouts de lames en
  série comptent les anneaux une fois (`ownerRingCounts`). Avant, deux
  orbites de 2000 lames au contact prenaient ~55 ms par tick, et toutes les
  rooms du process gelaient avec. Banc : `node tools/bench-giants.js`.
- **Hitbox (tâche 4.10)** : une lame en orbite a deux formes. Les clashs
  (lame contre lame) gardent la hitbox ronde (`tierBladeHitbox`) ; un corps
  meurt au contact de la hitbox ronde ou de la lame telle qu'elle est
  dessinée, du point d'anneau à la pointe (`bladeTipReach`,
  `bladeEdgeRadius` : `BLADE_TIP_REACH` × échelle du palier × échelle de la
  rareté, comme dans `BladeView`). Toute retouche d'une forme de
  `client/src/entities/bladeGeometries.ts` met `BLADE_TIP_REACH` à jour.
  Un humain qui fonce sur sa cible la touche d'autant plus loin qu'il
  avance vite (`KILL_LAG_ALLOWANCE_MS`, `KILL_LAG_REACH_MAX`, d'après la
  vitesse de son dernier pas, `Player.moveVx/moveVy`) : il la voit 80 ms
  dans le passé. Pas les bots, qui jouent au présent. Projectiles
  (`throws.ts`) : contact testé sur tout le trajet du tick
  (`server/src/systems/geometry.ts`), lames en orbite dessinées ; une lame
  en orbite qui tient arrête le projectile, brisée elle le laisse
  poursuivre (perçant) jusqu'aux suivantes ou au corps. La portée d'un
  joueur pour les buissons (`reachOf`) suit la plus longue lame de son
  palier. `?debug=hitbox` trace les deux formes (cercle, axe de la lame).
- **Butin d'un kill (tâche 4.11)** : la victime lâche 70 % de son orbite
  (tout si elle menait) et toutes les lames perdues dans les 10 dernières
  secondes (`recentLosses`, plafonné à 12 avant : le butin d'un combat ne
  dépassait jamais 12 lames). Ce butin est réservé à son tueur pendant
  `KILL_LOOT_CLAIM_MS` (`Blade.claimedBy`, `claimUntil`, champs serveur) :
  aspiré vers lui d'où qu'il soit (`updateBladePositions`), ramassé par lui
  seul (`PickupSystem`), ignoré des bots qui récoltent. Tueur mort, parti
  ou au plafond de lames : butin ordinaire. Mort sans tueur (mur) : butin
  ordinaire.
- **Champions (tâche 4.12)** : jusqu'à `BOT_CHAMPIONS_MAX` bots (un, deux
  dès que le plus gros humain aguerri a `CHAMPION_SECOND_AT` lames)
  apparaissent avec une grosse orbite, à `CHAMPION_SIZE_RATIO` de ce
  joueur (de 40 à 300 lames, raretés `CHAMPION_RARITY_WEIGHTS`), marqués
  `CHAMPION_NAME_MARK` devant leur nom (`Player.champion`, champ serveur).
  `BotController.championDue` décide (au moins un humain qui n'est pas un
  débutant, `CHAMPION_RESPAWN_MS` après la chute du précédent), la room
  les fait apparaître en plus des bots ordinaires (`maintainBots`), hors
  modes équipe. Difficiles et chasseurs : ne fuient qu'un joueur
  `CHAMPION_FLEE_RATIO` fois plus gros, ne poursuivent que des proies d'au
  moins `CHAMPION_PREY_RATIO` de leurs lames (jamais un débutant ni un
  joueur en grâce ou en rampe), et ne vont ni récolter ni errer au contact
  d'un nouveau venu (`fresh`, `nearGraced`). Ils ne boostent qu'à
  l'approche finale et lâchent une poursuite au bout de 12 s : sinon ils
  fondaient en boostant après un joueur aussi rapide qu'eux (deux lames par
  seconde). Une room de bots seuls (bancs du snowball et du débutant) n'en
  a pas : `BENCH_RETURNING=1` pour les bancs de survie, et
  `node tools/bench-champions.js`.
- **Poids du client (tâche 2.7)** : la page ne charge d'abord que
  `boot.ts` et ses imports (~175 Ko : lobby, textes, thèmes) ; le moteur
  (`main.ts`, three.js, Colyseus) est importé dès le démarrage, en
  parallèle, et `Game` reprend le lobby déjà monté (`LobbyParts`) ;
  Tone.js au premier geste (`audio/toneLib.ts`, contexte audio débloqué
  dans le geste même, pour Safari) ; supabase-js seulement pour une
  session à reprendre, un retour de connexion ou le panneau de connexion
  ouvert (`auth.preload`) ; la boutique à sa première ouverture
  (`boutique/entry.ts`). Rien de ce qu'importe le lobby ne doit tirer
  `main.ts`, three.js ou Colyseus (un `import type` suffit) : le moteur
  reviendrait dans le premier chargement. Contrôle : `SOURCEMAP=1 npm run
  build --workspace=@bladeio/client`, puis la taille du fichier cité par
  `dist/index.html`. three.js et Colyseus ont leurs fichiers
  (`manualChunks`) et `/assets/` est servi en cache permanent (noms à
  empreinte) : une mise à jour du jeu ne les fait pas retélécharger.
- **Fluidité (tâche 2.9)** : chaque shader compilé en pleine partie est un
  gel (50 à 300 ms sous Windows, où ANGLE passe par Direct3D) : tous le
  sont au lobby (`warmUpShaders` dans `main.ts`, `scene/shaderWarmup.ts`).
  `renderer.compile` couvre tout ce que la scène contient, même caché ; ce
  qui n'existe qu'en partie (joueurs, caisses, power-ups) y entre par un
  échantillon. Un nouveau genre d'objet créé en partie ajoute le sien, et se
  vérifie à `?debug=perf` (« +0 en partie »). Les joueurs d'échantillon
  restent en mémoire, hors de la scène : leurs matériaux retiennent les
  programmes, que three.js détruit sinon avec le dernier matériau qui les
  utilise (le dernier joueur d'un genre sorti du champ emportait le
  shader, recompilé à l'arrivée du suivant). Géométries des joueurs
  partagées (`sharedGeo` dans `PlayerView.ts`) : jamais de `dispose()`
  dessus. Post-traitement : une passe finale au lieu de cinq passes plein
  écran à résolution MSAA (`PostFX.ts`) ; le canvas n'a plus d'antialiasing
  à lui avec post-FX. Ce qui se mesure en pixels sur la cible (taille des
  points) suit la partie dessinée (`scene/renderScale.ts`).
- **Carte (tâche 4.7)** : `shared/src/decor.ts` décrit tout ce qui se
  voit ou bloque, pareil pour tous les thèmes. `DECOR_COLLIDERS` = pilier
  central, `OBELISKS`, puis les colliders des `STRUCTURES`
  (`structureColliders`) : `Decor.ts` lit `CENTRAL_PILLAR` et `OBELISKS`,
  jamais une tranche de `DECOR_COLLIDERS`. Structures et buissons sont
  symétriques de part et d'autre de x = 0 (camps des modes équipe) et dans
  l'arène d'un humain et de ses bots, hors de la bande que les bots
  évitent ; une structure ajoutée doit passer `server/test/decor.test.ts`
  (passage d'au moins 2 u entre obstacles, loin de la zone dorée et des
  bases). Rendu : `Structures.ts` fusionne tout ce qui ne bouge pas en
  trois maillages (corps, néons à couleurs par sommet, écrans) ; en
  qualité haute seulement, écrans qui défilent, LED qui clignotent (selon
  le réglage des flashs), drones et cristaux animés. `Bushes.ts` : dôme
  shader en haute et moyenne qualité, uni en basse et en potato ; il
  devient transparent pour le joueur qui est dedans (`setInsideBush`,
  depuis `main.ts`), avec rafale de particules et son à l'entrée et à la
  sortie.
- **Effets de combat (tâche 4.9)** : `fx/CombatFx.ts` réunit ondes de
  choc (clash, élimination, palier), éclats de lame brisée, colonne de
  lumière qui suit le joueur au passage de palier, traînées des lames
  (projectiles ; lames au sol aspirées vers un joueur, puis jusque dans son
  orbite au ramassage) et lignes de vitesse au boost (le joueur local
  d'après son dernier input, les autres d'après `Player.boost`). Chacun
  est un seul appel de rendu (géométrie instanciée, ou un maillage pour
  toutes les traînées) ; leurs shaders se compilent au premier rendu
  (objets visibles, 0 instance) et non au premier clash. Les traînées
  suivent la position DESSINÉE des lames : `BladeRenderer` les alimente
  (`setTrailSink`). La dissolution à la mort est injectée dans les
  matériaux du corps à leur création (`addDissolve`, clé de programme
  commune : un seul shader pour tous les joueurs) ; `startDissolve` au
  tick de l'élimination, à la couleur de l'effet d'élimination du tueur.
  Lisibilité : de la lumière additive et brève par-dessus la scène, rien
  qui cache une lame ou un joueur ; anneau, halo et repères d'allié d'un
  mort disparaissent tout de suite ; colonne courte (5 à 8 u) éteinte vers
  le haut.
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
- **Colyseus 0.18** (tâche T.6) : Node 22 minimum (`engines`, et
  `engine-strict` dans `.npmrc` : `npm ci` refuse une version plus
  ancienne). Le matchmaking compare les champs de `filterBy` (`code`,
  `mode`) aux métadonnées de la room, posées dans `onCreate`
  (`this.metadata`) : y retirer un champ casse la file correspondante (test
  « matchmaking » de `server/test/modes.test.ts`). `onLeave(client, code)`
  reçoit le code de fermeture (`CloseCode.CONSENTED` : départ volontaire,
  sinon fenêtre de reconnexion). Un code de fermeture propre au jeu se
  choisit hors de 4000-4010, réservés par Colyseus. Côté client, rappels
  d'état par `Callbacks.get(room)`, typés par `SyncedState` (`main.ts`) : y
  ajouter un champ avant de le suivre. La reconnexion automatique du SDK est
  coupée (`Connection.adopt`), `main.ts` a la sienne. Les tests et
  `tools/bench-server.js` s'appuient sur des internes (`_listing`, `__init`,
  `_simulationInterval`, `_serializer`) : à revalider à chaque montée de
  version.
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
  `check` de la colonne `cause`, par une nouvelle migration (dernière en
  date : `match_end`, migration 0011) : sinon l'insertion échoue (un
  avertissement par minute dans les logs).
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
  suivre aussi (`SceneStack.setViewDistance`). Recul selon l'orbite :
  `cameraZoom` (`shared/src/camera.ts`), jusqu'à ×2 pour que l'orbite du
  plafond de lames tienne à l'écran ; le serveur en déduit la zone
  d'intérêt maximale d'un joueur (`viewRadiusLimit`) : changer l'un change
  l'autre.

---

## Workflow git

- Pousser sur `main` direct est OK pour le owner du repo (pas de PR
  obligatoire pour ce projet).
- Branches de feature `claude/<task-name>` créées par les sessions, à
  cleaner après merge (depuis la machine du dev, pas le sandbox).
- La production est une seedbox Whatbox, sans root, sans systemd ni pm2 :
  le jeu tourne depuis un clone de `main` (`~/blades`), lancé par un petit
  script (Node 22 par nvm, `node server/dist/index.js`) que le cron relance
  au démarrage et toutes les 10 min s'il est tombé. Le domaine passe par les
  « Managed Links » de Whatbox (nginx géré par l'hébergeur, WebSockets
  activés, `X-Forwarded-For` transmis : `TRUST_PROXY` par défaut convient).
  Rien n'est déployé automatiquement, fusionner dans `main` ne change pas la
  production : mise à jour à la main et sur place (`git pull --ff-only`,
  `npm ci`, build, tests, puis arrêt et relance du serveur ;
  `RESTART_NOTICE_MS=60000` dans le `.env` donne aux joueurs leur préavis),
  procédure dans le README (« Seedbox without root »). Attendre que la CI
  soit verte avant de fusionner.
  `auto-deploy.sh` (release construite à part, bascule, pm2, santé, retour
  arrière ; tâche T.3), `ecosystem.config.js` et `systemd/` servent sur un
  VPS avec root ; les fichiers Render/Vercel/Docker restent des
  alternatives documentées dans le README.
