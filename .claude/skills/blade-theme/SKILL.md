---
name: blade-theme
description: Create a complete cosmetic theme for blades.io (palette, ground shader, decor variant, lights, blade material, ambient FX, music) and generate matching Suno v5.5 music prompts (lobby + battle). Use whenever the user asks to add a new theme to the game (e.g. "fais un thème glace", "ajoute Forge Vermeille", "let's do a desert biome", "nouveau thème"). Walks through palette design, decor variant choice, ground shader signature, registration, sync-music wiring, and outputs the two Suno prompts in the project's established format.
---

# Blade Theme — création d'un thème cosmétique pour blades.io

Workflow complet pour ajouter un thème (identité visuelle + sonore d'une map) au système `themes/` du repo.

## Prérequis

Lis `CLAUDE.md` à la racine du repo pour le contexte général. Sections critiques :
- **Système de thèmes** (anatomie, ce qui change vs reste fixe)
- **Lisibilité : le contrat de thème** (tâche 6.3) — `client/src/themes/readability.ts`
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

**Les 4 raretés ont des familles de teinte universelles** (décision D4, `RARITY_FAMILIES` dans `readability.ts`) : la rareté se lit pareil sur toutes les cartes. Le thème choisit seulement la nuance :

| Rareté | Famille | Plage OKLCH | Exemples |
|---|---|---|---|
| Common | blanc / argent | C ≤ 0,05, L ≥ 0,88 | `#ffffff` (Néon), `#e8e2da` acier (Forge) |
| Rare | bleu, du cyan à l'azur | H 200° à 265°, C ≥ 0,11 | `#00e5ff`, `#3c9dff` |
| Epic | violet | H 280° à 320°, C ≥ 0,14 | `#7c5cff`, `#b480ff` |
| Legendary | or / ambre | H 55° à 100°, C ≥ 0,11, L ≥ 0,78 | `#ffc83d`, `#ffc56b` |

Écart CIEDE2000 ≥ 20 entre deux raretés. Pour un thème chaud, ne PAS prendre les teintes du thème pour les raretés : la Forge avait ses lames couleur de lave et elles disparaissaient sur le sol (elle utilise maintenant les couleurs de revenu de l'acier). La légendaire reste or, donc c'est le sol qui s'adapte.

Couleurs requises (cf. `Theme.palette` dans `Theme.ts`) :
- **clearColor** : fond du renderer (très sombre)
- **fogColor** : brouillard, souvent proche du clearColor
- **boundary** : mur de mort, un rouge franc (H 345° à 40°), loin de toute rareté
- **rarityColor[Common→Legendary]** : dans les familles ci-dessus
- **powerUpColor[5 types]** : 5 teintes distinctes lisibles à 50% zoom
- **fx.{crateHit, crateDestroy, death, clash, tierUpHi, tierUpLo, …}** : bursts de particules
- **playerLocal/Remote** : 3 teintes par côté (primary/accent/accentDim)
- **crate** : primary/emissive/edge

**Règle d'or** : pas plus de 5-6 couleurs structurelles, le reste = variations.

**Couleurs réservées au gameplay** : rien dans le sol ni dans les particules d'ambiance ne ressemble à une rareté ou aux couleurs de menace (`DANGER_COLOR` rouge, `PREY_COLOR` vert). Les particules (`ambient.wisps.colors`) : jamais blanc, bleu, violet ou or de lame.

### 3. Decor variant — réutiliser ou créer

90% des cas : **réutiliser `cyber` ou `spirit`** retinté. Plus rapide, suffisant.

Créer un nouveau `kind` (ex : `glacial`, `molten`) seulement si la géométrie elle-même doit changer (cristaux qui sortent du sol, machines, plantes carnivores). Si nouveau kind :
1. Étendre `DecorVariant` dans `themes/Theme.ts`
2. Créer `create<Kind>Decor()` dans `client/src/scene/Decor.ts`
3. Ajouter au dispatch dans `createDecor()`

### 4. Ground shader — la signature visuelle

Chaque thème doit avoir un sol identifiable au premier coup d'œil, mais **sombre et calme** : c'est le fond sur lequel on lit les lames. **3 variantes obligatoires** : `fragRich`, `fragSimple`, `fragFlat`.

**Couleurs du sol déclarées** dans `ground.colors` (hex tel qu'à l'écran) : `base` (la dominante, luminance ≤ 0,03) et un motif par clé, à son plus fort (luminance ≤ 0,12). `Ground.ts` les passe en uniforms : `base` → `uBase`, `crack` → `uCrack`. Dans les shaders : **aucune couleur en dur** (`vec3(0.4, 0.1, 0.9)` est refusé) et **seulement des `mix()`** entre ces couleurs, poids de 0 à 1 (pas de `col += uCrack * 1.6` : ça sort des couleurs déclarées). `Ground.ts` plafonne la luminance et convertit vers l'espace de sortie, pour les 3 niveaux.

Des motifs fins (lignes, veines, éclats) plutôt que de grandes nappes claires : la Forge d'avant couvrait la moitié du sol de lave orange vif, les Profondeurs d'aurore verte.

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

Uniforms : les couleurs viennent de `ground.colors` (déclarer `uniform vec3 uXxx;` dans chaque niveau qui s'en sert, sinon le shader ne compile pas à ce niveau ; le contrôle le signale). `uTime` (rich seulement) et `uRadius` sont fournis par `Ground.ts`.

### 5. Lighting + blade material

- **Ambient color** : LA teinte qui colore tous les matériaux PBR — choisir la couleur d'ambiance qui doit baigner la scène
- **Key/Rim** : light principale + contre-jour, couleurs qui découpent les silhouettes
- **Blade shininess** : 80 (acier net) → 30 (éthéré). Forge polie ≈ 70, glace ≈ 60, fungal ≈ 30
- **Blade specular** : teinte du highlight (cohérente avec ambient/key)
- **Pas de caméra** : le cadrage n'est plus un réglage de thème. Il décide de ce qu'on voit, donc c'est une constante de gameplay (`CAMERA_*` dans `shared/src/constants.ts`), la même pour tous les thèmes (pas d'avantage acheté).

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

**Prix** : un thème non listé dans le catalogue `SHOP_ITEMS` de `shared/src/shop.ts` est gratuit et possédé par tous. Pour un thème payant, y ajouter `"<id>": { id: "<id>", kind: "theme", price: <trophées> }` (grille actuelle : 1500 / 3500 / 6000). C'est la seule source de prix acceptée par le serveur.

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

Étendre `client/package.json` script `sync-music` pour copier les .mp3 source depuis `assets/music/` :
```js
const tracks = [
  ['Neon Lobby.mp3',           'lobby-neon.mp3'],
  ['Neon Battle.mp3',          'battle-neon.mp3'],
  ['Sanctuaire Lobby.mp3',     'lobby-sanctuaire.mp3'],
  ['Sanctuaire Battle.mp3',    'battle-sanctuaire.mp3'],
  ['<Theme> Lobby.mp3',        'lobby-<id>.mp3'],     // ← nouvelles lignes
  ['<Theme> Battle.mp3',       'battle-<id>.mp3'],
];
```

Dans `themes/<id>.ts` : `music: { lobby: "lobby-<id>.mp3", battle: "battle-<id>.mp3" }`. L'utilisateur dépose les `.mp3` source dans `assets/music/` à la racine du repo avec ces noms exacts.

### 11. Vérification, build + commit

```bash
npm run check:themes                # contrat de lisibilité (la CI le lance aussi)
cd client
npx tsc -p tsconfig.json --noEmit  # typecheck
npx vite build                      # vérifie que les shaders compilent
```

`check:themes` doit afficher OK pour le nouveau thème ; chaque écart nomme la règle et les couleurs en cause.

Commit + push (sur main si autorisé pour la session, sinon feature branch).

## Anti-patterns à éviter

- ❌ Hardcoder une couleur en dehors de `themes/<id>.ts` (toute couleur de rendu doit venir du thème actif via `getActiveTheme()`)
- ❌ Mettre des positions de collision dans le thème (ces données sont dans `shared/`, immuables entre thèmes pour l'équité gameplay)
- ❌ Ne fournir qu'un seul niveau de ground shader (les 3 sont obligatoires : `rich`, `simple`, `flat`)
- ❌ Trop de wisps (>100) — fatigue l'œil, concurrence le combat
- ❌ Choisir une couleur très saturée/brillante pour Common (rareté la plus fréquente — doit rester discrète sinon l'écran sature)
- ❌ Sortir une rareté de sa famille (rose légendaire, orange rare…) ou reprendre la couleur d'une rareté dans le sol ou les particules
- ❌ Un sol clair ou de grandes nappes lumineuses (luminance plafonnée de toute façon par `Ground.ts`)
- ❌ Suno prompts avec 5+ références (mélange mal sur v5.5, dilue le mood)
- ❌ Ajouter le thème à la racine du dropdown sans avoir testé que les 3 niveaux de qualité tournent (rich/simple/flat sont des paths critiques)

## Références internes

- Anatomie du système : `CLAUDE.md` § "Système de thèmes"
- Template vierge avec TODOs : `client/src/themes/_template.ts`
- Exemple thème spirit : `client/src/themes/sanctuaire.ts`
- Exemple thème cyber : `client/src/themes/neon.ts`
- Interface formelle : `client/src/themes/Theme.ts`
- Contrat de lisibilité : `client/src/themes/readability.ts`, contrôle `tools/check-themes.mjs`
