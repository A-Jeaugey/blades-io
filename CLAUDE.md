# CLAUDE.md

Guide pour Claude (et autres assistants IA) qui travaillent sur ce repo.

> **Pour le contexte produit/gameplay**, lire `README.md` (anglais) et `PLAN.md` (français, roadmap living spec). Ce document se concentre sur **ce qu'il faut savoir pour coder dans la base sans casser quoi que ce soit**, avec un focus sur le système de thèmes cosmétiques évolutif.

---

## Stack & Architecture

```
shared/    Constantes et types — source de vérité gameplay (positions de
           collision, balance, enums…). Importé par client ET serveur.
server/    Colyseus authoritative room. Tick 20 Hz, simulation complète.
           Le serveur ne sait rien des couleurs/visuels — c'est cosmétique.
client/    Vite + Three.js + Colyseus.js. Interpolation 150 ms + prédiction
           locale + reconciliation pour le joueur courant.
```

**Règles d'or** :
- `shared/` est un **contrat**. Toute modif y casse client+serveur+balance. Touchez avec précaution.
- Le **serveur est autoritatif**. Le client envoie `{dx, dy, boost, throw}` et reçoit des snapshots. Ne tentez pas de "fixer" un comportement gameplay côté client — c'est forcément côté serveur.
- **Tout est procédural** : zéro asset PNG/SVG. Géométries Three.js + shaders GLSL inline. Conséquence : tout s'instancie, tout se thème.

---

## Rendu côté client — vue d'ensemble

```
client/src/
├── main.ts              Game class — boucle requestAnimationFrame, dispatch
│                        des messages serveur, gestion FX bursts
├── scene/
│   ├── Scene.ts         WebGLRenderer + camera + lumières + fog (depuis thème)
│   ├── Camera.ts        CameraRig — offset défini par le thème
│   ├── Ground.ts        Sol shader (rich/simple/flat) — sources GLSL du thème
│   ├── Decor.ts         Pilier central + obélisques + bushes + cubes/lanternes
│   │                    DISPATCH cyber/spirit selon theme.decor.kind
│   ├── PostFX.ts        EffectComposer (bloom + chroma + vignette + grain)
│   ├── AmbientWisps.ts  Particules d'âme — actif si theme.ambient.wisps != null
│   └── palette.ts       Façade rétrocompat sur le thème actif
├── entities/
│   ├── BladeView.ts     InstancedMesh×12 (4 raretés × 3 tiers)
│   ├── PlayerView.ts    Capsule corps + tête + ring + halo + trail
│   ├── CrateView.ts     Boîte émissive + edges
│   └── PowerUpView.ts   Octaèdres flottants + pilier vertical + ring sol
├── fx/
│   ├── Particles.ts     Pool de Points pour bursts (sparks/explosions)
│   └── ScreenShake.ts
├── themes/              ★ Système de thèmes — voir section dédiée plus bas
├── audio/SoundManager.ts Tone.js synth + HTMLAudio tracks
├── ui/                  HUD, Login, Death, Leaderboard, Minimap, Settings
└── quality.ts           Presets ultra/low/medium/high + détection auto + dyn-res
```

### Quality presets — important

`getPresetConfig()` détecte le GPU via `WEBGL_debug_renderer_info` et choisit
parmi `ultra | low | medium | high`. Chaque module de rendu prend `q: QualityConfig`
en constructeur et adapte son détail (segments, post-FX, instances). Un moniteur
FPS adaptatif baisse `resScale` runtime puis downgrade le preset si nécessaire.

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
  cameraOffset: { x; y; z };   // angle/distance de la caméra
}
```

### Thèmes existants

| ID | Fichier | Statut |
|---|---|---|
| `neon` | `themes/neon.ts` | **Défaut**, gratuit. Cyberpunk d'origine. |
| `sanctuaire` | `themes/sanctuaire.ts` | Cosmétique #1, mystic mauve/or. |

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

### 5. (Plus tard) Boutique

Quand le système de boutique sera prêt (intégration au trophy wallet), il
suffira d'ajouter au thème un `price: number` (ou similaire) et `THEMES`
servira d'inventaire global. La boutique listera, vérifiera l'ownership
serveur-side via la wallet, et conditionnera l'activation.

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

- **Shared TS deprecation** : `npm run build:shared` plante sur les flags
  `moduleResolution=node10` et `baseUrl` (warnings TypeScript 5.9+). C'est
  un bug pre-existant — n'affecte pas le typecheck du client (`npx tsc -p
  client/tsconfig.json --noEmit` passe propre). Pour le build complet :
  `cd client && npx vite build`.
- **`client/public/` est gitignoré**. Le dossier est régénéré au `predev`/
  `prebuild` par `sync-music`. N'y commitez rien à la main.
- **Suppression de branches sur le remote local** (`http://127.0.0.1:.../`) :
  retourne 403. Le sandbox autorise les push de commits mais pas les
  deletions. Pour cleaner les feature branches, demandez à l'utilisateur de
  le faire depuis sa machine ou via GitHub web.
- **Fichiers musicaux** : les `.mp3` source vivent dans `assets/music/` (pas
  dans `client/`). Le script `sync-music` les copie vers `client/public/`
  avec les noms attendus par les thèmes (`lobby-<id>.mp3`, `battle-<id>.mp3`).
- **Camera offset trop bas tue la lisibilité .io**. Ne descendez pas en
  dessous de ~45° d'inclinaison (offset Y/Z > 0.85). Le top-down strict
  est laid mais à 30° on perd la perception des menaces.

---

## Workflow git

- Pousser sur `main` direct est OK pour le owner du repo (pas de PR
  obligatoire pour ce projet).
- Branches de feature `claude/<task-name>` créées par les sessions, à
  cleaner après merge (depuis la machine du dev, pas le sandbox).
- Le déploiement (Render + Vercel) est déclenché automatiquement par tout
  push sur `main` — vérifier le build local avant.
