# CLAUDE.md

Guide pour Claude (et autres assistants IA) qui travaillent sur ce repo.

> **Pour le contexte produit/gameplay**, lire `README.md` (anglais) et `PLAN.md` (français, plan d'amélioration V2 à suivre, cases à cocher). Chaque tâche du plan renvoie aux constats de l'audit `docs/AUDIT-2026-09.md` (preuves `fichier:ligne`, mesures de référence). Performance serveur : mesurer avant/après avec `node tools/bench-server.js`. Bots ou combat : vérifier que les premières secondes d'un débutant ne deviennent pas plus meurtrières avec `node tools/bench-survival.js` (après `npm test`). La section « Actions manuelles en attente » de `PLAN.md` liste ce que le owner doit faire à la main (Supabase, production, fusion) : la lui rappeler en fin de tâche tant qu'elle n'est pas vide. Ce document se concentre sur **ce qu'il faut savoir pour coder dans la base sans casser quoi que ce soit**, avec un focus sur le système de thèmes cosmétiques évolutif.

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
│   ├── BladeView.ts     InstancedMesh×12 (4 raretés × 3 tiers), flash
│   │                    blanc par instance (attribut aFlash)
│   ├── PlayerView.ts    Capsule corps + tête + ring + halo + trail
│   ├── CrateView.ts     Boîte émissive + edges
│   ├── PowerUpView.ts   Octaèdres flottants + pilier vertical + ring sol
│   └── AimIndicator.ts  Trajectoire du prochain lancer au sol (visée)
├── fx/
│   ├── Particles.ts     Pool de Points pour bursts (sparks/explosions)
│   └── ScreenShake.ts
├── themes/              ★ Système de thèmes — voir section dédiée plus bas
├── audio/SoundManager.ts Tone.js synth + HTMLAudio tracks
├── ui/                  HUD, Login, Death, Leaderboard, Minimap, Settings,
│                        CombatFeedback (repères de perte, « +1 »)
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
- **Mode debug** : `?debug=hitbox` dans l'URL dessine les hitbox serveur
  des lames proches et affiche l'écart client/serveur (orbites, étincelles).

### Quality presets — important

`getPresetConfig()` détecte le GPU via `WEBGL_debug_renderer_info` et choisit
parmi `ultra | low | medium | high` (`ultra` est le mode le plus **léger**,
« potato mode », pas le plus beau). Chaque module de rendu prend `q: QualityConfig`
en constructeur et adapte son détail (segments, post-FX, instances). Un moniteur
FPS adaptatif baisse `resScale` runtime puis downgrade le preset si nécessaire
(en pleine partie : post-FX coupés à chaud, preset appliqué au retour menu —
jamais de rechargement pendant un match).

**Conséquence** : tout nouveau code de rendu doit gérer **les 3 niveaux de
détail** (`rich`, `simple`, `minimal`) ou au moins ne pas casser les low/ultra.

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
  ground: ThemeGround;         // 3 fragment shader sources + buildExtraUniforms()
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
soient reconstruits. L'UI Settings demande un confirm() avant reload.

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
- **Ground shader** : 3 variantes obligatoires (`fragRich`, `fragSimple`,
  `fragFlat`). Si vous utilisez des uniforms personnalisés, fournissez-les via
  `buildExtraUniforms(detail)`. `uTime` et `uRadius` sont gérés par
  `Ground.ts`.
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
le serveur y relit le prix au moment de l'achat (`/api/wallet/purchase` ne
reçoit que l'`item_id`) et la boutique l'affiche. Ne jamais remettre de
`price` dans l'objet `Theme` ni accepter un prix venant du client.

---

## Conventions de code

- **Commentaires** : français, expliquent le **pourquoi** (contraintes,
  invariants, bugs résolus). Pas le **quoi** (le code l'exprime déjà). Voir
  les fichiers existants pour le ton.
- **Couleurs** : ne **jamais** hardcoder un hex en dehors de `themes/*.ts`.
  Tous les modules de rendu lisent via `getActiveTheme()`. Si vous voyez un
  `0xff2ea8` en dehors de `themes/`, c'est un bug à corriger.
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

- **Build et CI** : `npm run build` (shared, puis serveur, puis client)
  passe avec la version de TypeScript verrouillée (5.9.3) ; l'ancien
  plantage de `build:shared` ne se reproduit plus. La CI GitHub Actions
  (`.github/workflows/ci.yml`) rejoue ce build complet puis `npm test` à
  chaque push : elle doit être verte avant de pousser sur `main`.
- **Tests serveur** : `npm test` (`server/test/*.test.ts`, `node:test`
  compilé par `tsc` vers `server/dist-test/`, gitignoré). Les systèmes
  lisent `Date.now()` et `Math.random()` : utiliser `FakeClock` et
  `seedRandom` de `server/test/helpers.ts`, et `TestRoom` pour une room
  complète hors réseau. Toute modification d'un système serveur passe par
  ces tests ; un changement de comportement voulu met le test à jour dans
  le même commit.
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
- Le déploiement de production est auto-hébergé : `auto-deploy.sh`, lancé
  toutes les 30 s par le timer de `systemd/`, redéploie `main` dès qu'il
  bouge (`git reset --hard`, build complet, `pm2 restart`). Tout push sur
  `main` redémarre donc le serveur et coupe les parties en cours (tâche T.3
  du plan) : attendre que la CI soit verte sur la branche avant de fusionner.
  Les fichiers Render/Vercel/Docker restent des alternatives documentées
  dans le README, pas la cible actuelle.
