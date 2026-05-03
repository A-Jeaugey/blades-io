---
name: blade-theme
description: Create a complete cosmetic theme for blades.io (palette, ground shader, decor variant, lights, blade material, ambient FX, music) and generate matching Suno v5.5 music prompts (lobby + battle). Use whenever the user asks to add a new theme to the game (e.g. "fais un thème glace", "ajoute Forge Vermeille", "let's do a desert biome", "nouveau thème"). Walks through palette design, decor variant choice, ground shader signature, registration, sync-music wiring, and outputs the two Suno prompts in the project's established format.
---

# Blade Theme — création d'un thème cosmétique pour blades.io

Workflow complet pour ajouter un thème (identité visuelle + sonore d'une map) au système `themes/` du repo.

## Prérequis

Lis `CLAUDE.md` à la racine du repo pour le contexte général. Sections critiques :
- **Système de thèmes** (anatomie, ce qui change vs reste fixe)
- **Comment ajouter un nouveau thème** (recette officielle)

## Process — ordre exact

### 1. Discussion du concept (avant de coder)

Aligner avec l'utilisateur sur :

- **Identité** : 1-2 mots qui résument ("volcanique aggressif", "cristalline serein", "Ghibli pastoral")
- **Axe chromatique** : viser un contraste avec les thèmes existants. Si la boutique n'a que des thèmes cool dominants, le prochain doit être chaud (et inversement). Vérifier les `THEMES` actuels dans `themes/index.ts`.
- **Mood** : intensité (calme → frénétique), atmosphère (paisible → menaçante)
- **3 références ciné/jeu/musique** : aident à ancrer le mood pour le shader ET pour Suno

Output : 5-6 mots-clés validés par l'utilisateur avant d'écrire du code.

### 2. Palette — règles structurantes

**Logique des 4 raretés** : la rareté la plus rare doit ressortir IMMÉDIATEMENT. Souvent = teinte chaude au milieu d'une palette froide (ou inverse pour les thèmes chauds → Legendary blanc-chaud dans une palette de feu).

Couleurs requises (cf. `Theme.palette` dans `Theme.ts`) :
- **clearColor** : fond du renderer (très sombre)
- **fogColor** : brouillard, souvent proche du clearColor
- **boundary** : mur de mort, doit attirer l'œil (saturé contrasté)
- **rarityColor[Common→Legendary]** : 4 niveaux avec progression visible
- **powerUpColor[5 types]** : 5 teintes distinctes lisibles à 50% zoom
- **fx.{crateHit, crateDestroy, death, clash, tierUpHi, tierUpLo, …}** : bursts de particules
- **playerLocal/Remote** : 3 teintes par côté (primary/accent/accentDim)
- **crate** : primary/emissive/edge

**Règle d'or** : pas plus de 5-6 couleurs structurelles, le reste = variations.

### 3. Decor variant — réutiliser ou créer

90% des cas : **réutiliser `cyber` ou `spirit`** retinté. Plus rapide, suffisant.

Créer un nouveau `kind` (ex : `glacial`, `molten`) seulement si la géométrie elle-même doit changer (cristaux qui sortent du sol, machines, plantes carnivores). Si nouveau kind :
1. Étendre `DecorVariant` dans `themes/Theme.ts`
2. Créer `create<Kind>Decor()` dans `client/src/scene/Decor.ts`
3. Ajouter au dispatch dans `createDecor()`

### 4. Ground shader — la signature visuelle

Chaque thème doit avoir un sol identifiable au premier coup d'œil. **3 variantes obligatoires** : `fragRich`, `fragSimple`, `fragFlat`.

Patterns prouvés :

| Pattern | Effet | Exemple |
|---|---|---|
| Grille double échelle | géométrique tech | Néon (`grid(world, 4u) + grid(world, 20u) + pulse`) |
| FBM brume + wisps | organique éthéré | Sanctuaire (FBM nappes + spots lumineux + cercles rituels) |
| Lava cracks | bandes lumineuses étroites | `smoothstep(0.43, 0.5, fbm) - smoothstep(0.5, 0.57, fbm)` |
| Tessellation cristalline | facettes dures | Voronoi cells + edge highlight (`abs(d1 - d2)`) |

**Toujours ajouter le dithering anti-banding** sur les gradients étendus :
```glsl
float dither = (hash(gl_FragCoord.xy + uTime * 60.0) - 0.5) / 255.0;
col += vec3(dither);
```

Uniforms theme-spécifiques : déclarés dans le shader + fournis par `buildExtraUniforms(detail)`. `uTime` (rich seulement) et `uRadius` sont gérés par `Ground.ts`.

### 5. Lighting + blade material + camera

- **Ambient color** : LA teinte qui colore tous les matériaux PBR — choisir la couleur d'ambiance qui doit baigner la scène
- **Key/Rim** : light principale + contre-jour, couleurs qui découpent les silhouettes
- **Blade shininess** : 80 (acier net) → 30 (éthéré). Forge polie ≈ 70, glace ≈ 60, fungal ≈ 30
- **Blade specular** : teinte du highlight (cohérente avec ambient/key)
- **Camera offset** : Y entre 19-22, Z entre 16-17. Plus Y/Z grand = plus top-down = plus lisible mais moins immersif. Sweet spot 48-54° (≈ atan(Y/Z)).

### 6. Ambient FX

- `wisps: null` si le thème n'en a pas besoin (cas Néon — la grille remplit l'ambiance)
- `wisps: { counts, colors, drift }` sinon. Counts modérés (60/40/25/12 max) — trop concurrence le combat.
- Pour des particules qui montent (embers) plutôt que dérivent : actuellement le système ne supporte que drift latéral, soit accepter le drift, soit étendre `AmbientWisps` avec un `vy` configurable.

### 7. Génération du fichier

Copier `client/src/themes/_template.ts` → `client/src/themes/<id>.ts`. ID en kebab-case court (`forge-vermeille`, `glacial`, `jardin-cendre`). Remplir TOUS les TODO. Renommer `TEMPLATE_THEME` → `<ID>_THEME`.

### 8. Enregistrement

Dans `client/src/themes/index.ts` :
```ts
import { YOURTHEME_THEME } from "./your-theme";
export const THEMES: Record<string, Theme> = {
  ...,
  [YOURTHEME_THEME.id]: YOURTHEME_THEME,
};
```

Le dropdown de Settings le détecte automatiquement via `listThemes()`.

### 9. Music — Suno v5.5 prompts

Générer **2 prompts** : lobby (ambient/calm) + battle (intense/driving). Format établi du projet :

```
<genre subgenre subgenre>, <référence A> meets <référence B> meets <référence C>,
<BPM> BPM, <key> <mode>, <mood phrase>, instrumental no vocals,
<arrangement description>, <instrument 1>, <instrument 2>, <instrument 3>,
<percussion description>, <texture/effects>, <reverb/stereo notes>,
no <unwanted 1> no <unwanted 2> no <unwanted 3>, feels like <vibe sentence>,
<paint adjectives>

[Instrumental]
[Intro]
[Main Theme]
[Build]
[Drop]
[Bridge]
[Final Drop]
[Outro]
[loop friendly]
```

**Conventions v5.5 du projet** :
- **3 références exactement** par prompt (pas 2, pas 4 — v5.5 mélange mal au-delà)
- **Anti-instructions explicites** (`no electric guitars`, `no synth`, `no dubstep`) — v5.5 les respecte vraiment
- **Instruments nommés individuellement**, jamais "orchestral" générique
- **Modes modaux** plutôt que `minor`/`major` plat (D dorian, F# phrygian, A aeolian) — donne la couleur sans être triste/joyeux
- **`painterly`** comme adjectif final → mix moins compressé, plus organique
- **`[loop friendly]`** à la fin → meilleures transitions outro→intro

**Différences lobby vs battle** :

| | Lobby | Battle |
|---|---|---|
| BPM | 65-85 | 125-150 |
| Mood | sparse, contemplatif, anticipation | urgent, driving, action |
| Instruments lead | flûte, harpe, célesta | violon solo, brass, choir wordless |
| Percussion | "no drums" ou très subtil | taiko/frame drums + claps |
| Reverb | lourd cathédrale | grand cinéma |
| Vibe phrase | "feels like waiting before X" | "feels like X-ing not war anthem" |

### 10. sync-music script

Étendre `client/package.json` script `sync-music` pour copier les .mp3 source :
```js
const tracks = [
  ['Room-Ready Match (2).mp3', 'lobby-neon.mp3'],
  ['Neon Boxing Tape (1).mp3', 'battle-neon.mp3'],
  ['Sanctuaire Lobby.mp3',     'lobby-sanctuaire.mp3'],
  ['Sanctuaire Battle.mp3',    'battle-sanctuaire.mp3'],
  ['<Theme> Lobby.mp3',        'lobby-<id>.mp3'],     // ← nouvelles lignes
  ['<Theme> Battle.mp3',       'battle-<id>.mp3'],
];
```

Dans `themes/<id>.ts` : `music: { lobby: "lobby-<id>.mp3", battle: "battle-<id>.mp3" }`. L'utilisateur dépose les `.mp3` source à la racine du repo avec ces noms exacts.

### 11. Build + commit

```bash
cd client
npx tsc -p tsconfig.json --noEmit  # typecheck
npx vite build                      # vérifie que les shaders compilent
```

Commit + push (sur main si autorisé pour la session, sinon feature branch).

## Anti-patterns à éviter

- ❌ Hardcoder une couleur en dehors de `themes/<id>.ts` (toute couleur de rendu doit venir du thème actif via `getActiveTheme()`)
- ❌ Mettre des positions de collision dans le thème (ces données sont dans `shared/`, immuables entre thèmes pour l'équité gameplay)
- ❌ Ne fournir qu'un seul niveau de ground shader (les 3 sont obligatoires : `rich`, `simple`, `flat`)
- ❌ Trop de wisps (>100) — fatigue l'œil, concurrence le combat
- ❌ Choisir une couleur très saturée/brillante pour Common (rareté la plus fréquente — doit rester discrète sinon l'écran sature)
- ❌ Suno prompts avec 5+ références (mélange mal sur v5.5, dilue le mood)
- ❌ Ajouter le thème à la racine du dropdown sans avoir testé que les 3 niveaux de qualité tournent (rich/simple/flat sont des paths critiques)

## Références internes

- Anatomie du système : `CLAUDE.md` § "Système de thèmes"
- Template vierge avec TODOs : `client/src/themes/_template.ts`
- Exemple thème spirit : `client/src/themes/sanctuaire.ts`
- Exemple thème cyber : `client/src/themes/neon.ts`
- Interface formelle : `client/src/themes/Theme.ts`
