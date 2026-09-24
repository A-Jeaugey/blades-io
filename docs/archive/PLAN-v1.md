# Cahier des charges — Spinning Blades

Document vivant : chaque case est cochée au fur et à mesure de l'avancement.

---

## Module 1 — Bots (priorité 1)

### 1.1 Augmenter la population de bots

- [x] Population minimale de **15** joueurs totaux (humains + bots)
- [x] Cap maximum de bots limité à **10**
- [x] Lorsqu'il y a 5 humains, il y a 10 bots. Chaque humain supplémentaire remplace un bot.
- [x] Test : room vide → 10 bots apparaissent (et non 15, on est capé à 10 bots)
- [x] Test : 6 humains connectés → 9 bots présents

### 1.2 IA par système de scoring

- [x] Remplacer le système de décision actuel (if/else en cascade) par un **scoring multi-facteurs**
- [x] Chaque action candidate (fuir, chasser, farmer, attraper un power-up, casser une caisse, se cacher) reçoit un score
- [x] Le bot exécute l'action au score le plus haut

### 1.3 Comportements humains

- [x] **Personnalités** : chaque bot a un profil aléatoire (Agressif, Fermier, Chasseur, Campeur) qui influence ses scores
- [x] **Réaction imparfaite** : délai de 50–300 ms avant de changer de cible
- [x] **Aim jitter** : légère erreur d'angle sur le déplacement, proportionnelle à la distance
- [x] **Esquive perpendiculaire** : en fuite, le bot ajoute une déviation latérale au lieu de fuir en ligne droite
- [x] **Conscience des power-ups** : le bot évalue les power-ups selon leur rareté et son besoin (peu de lames → priorité aux Blades/Shield)
- [x] **Conscience des caisses** : bot fort + caisse proche + pas de menace → il va la casser
- [x] **Anticipation** : le bot vise la position future estimée de sa cible
- [x] **Boost intelligent** : boost uniquement pour fermer une distance critique ou fuir un coup mortel
- [x] **Anti-double-aggro** : si un autre bot vise déjà la même cible et est plus proche, le bot change de cible
- [x] **Bushes tactiques** : un bot blessé ou faible se cache dans un bush proche (base posée dans le wander)

### 1.4 Performance

- [ ] Vérifier que le tick serveur reste < 30 ms avec 25 bots actifs
- [ ] Optimiser si nécessaire (cache des distances, réduction des boucles)

---

## Module 2 — Système de lames (priorité 2)

### 2.1 Dynamique et placement des lames

- [x] **Supprimer la fusion des lames** : Retirer du code la logique gérant la fusion automatique des lames (ainsi que les anciens comportements liés).
- [x] **Vitesse de rotation dynamique** : Plus le joueur possède de lames, plus la vitesse de rotation de l'ensemble de ses lames augmente.
- [x] **Densité des cercles** : Augmenter le nombre maximum de lames par cercle et par rang (les cercles successifs accueillent plus de lames).

### 2.2 Lancer de lame

Nouvelle action active : le joueur peut **lancer** une de ses lames comme un projectile.

- [x] Contrôles : `Espace` ou clic droit (PC), bouton "THROW" (mobile, à droite du boost)
- [x] Appui unique (pas de maintien/répétition)
- [x] Cooldown de 0.5 s entre chaque lancer
- [x] La lame la plus extérieure (anneau le plus éloigné) est sélectionnée et détachée
- [x] La lame part en ligne droite dans la direction du joueur
- [x] Collision avec joueurs et caisses ennemis
- [x] Dégâts basés sur la rareté de la lame
- [x] Common/Rare : se détruisent au premier impact
- [x] Epic : traverse 1 cible
- [x] Legendary : traverse 2 cibles
- [x] Effet visuel : traînée néon colorée selon la rareté + son au lancer et à l'impact

### 2.3 Adaptation des bots

- [x] Les bots peuvent aussi lancer des lames (si la cible est alignée et que le bot a assez de lames)



---

## Module 4 — Bushes "Glitch Fields" (priorité 3)

Mécanique inchangée : les bushes cachent les joueurs et leurs lames des autres. Seul le **visuel** est refait pour coller au thème cyberpunk.

- [ ] Nouveau visuel : zone de **pixels corrompus** avec distorsion chromatique
- [ ] Dôme bas avec effet de displacement et aberration chromatique
- [ ] Particules digitales flottantes (petits cubes/glyphes qui s'élèvent du sol)
- [ ] Halo cyan/violet pulsant
- [ ] Son de glitch/static à l'entrée et à la sortie (optionnel)
- [ ] Burst de particules glitch quand un joueur traverse la zone
- [ ] Visible de loin (attire l'attention), opaque vu de l'extérieur

---

## Module 5 — Structures de map (priorité 3)

La map est trop vide. Ajouter du **décor cyberpunk thématique** sans changer la forme ni la taille de l'arène.

### 5.1 Catalogue de structures

- [ ] **Holo-billboards** : pylônes avec panneaux lumineux animés (~3 instances)
- [ ] **Neon arches** : arches lumineuses, collidables, en groupes de 2-3 (~2 clusters)
- [ ] **Server racks** : blocs cubiques avec LEDs clignotantes, collidables (~6 instances)
- [ ] **Drone pads** : disques émissifs au sol avec drone animé au-dessus, non collidables (~4 instances)
- [ ] **Data shards** : cristaux flottants émissifs (~12 instances)

### 5.2 Intégration

- [ ] Les colliders des nouvelles structures ne doivent pas bloquer le spawn, le ramassage d'items ou le pathing des bots
- [ ] Densité raisonnable (~25 structures totales) pour garder la map lisible

### 5.3 Border

- [ ] Pas de changement pour l'instant (validé)

---

## Module 6 — Bugfixes (priorité 1.5)

Bugs identifiés à corriger avant de développer les nouvelles fonctionnalités :

### 6.1 Fuite des bots bloquée

- [x] Quand un bot est encerclé par deux menaces opposées parfaitement, les vecteurs de fuite s'annulent et le bot reste immobile au lieu de fuir
- [x] Le bot doit toujours réussir à fuir (déviation latérale ou bruit directionnel)

### 6.2 Double-ramassage de Power-ups

- [x] Si deux joueurs sont très proches d'un même power-up, les deux peuvent le ramasser sur la même frame
- [x] Un seul joueur doit pouvoir ramasser un power-up donné

### 6.3 Bots trop prudents

- [x] Les bots n'attaquent que s'ils ont 3 lames de plus que leur cible → à forces égales ils s'ignorent
- [x] Ajouter une part d'aléatoire pour que certains bots soient plus agressifs même sans avantage net

---

## Module 7 — Exigences non-fonctionnelles

Objectifs à respecter en continu pendant tout le développement :

### 7.1 Performances serveur

- Chaque tick serveur ne doit pas dépasser **30 ms** (pour 60 joueurs / 25 bots / centaines de lames)
- Les collisions doivent rester fluides malgré la densité accrue (bots + nombre élevé de lames)

### 7.2 Scalabilité

- Le matchmaking distribue les joueurs sur des rooms de 60 joueurs max, en créant de nouvelles rooms automatiquement

### 7.3 Expérience client

- Support transparent Touch / Souris / Clavier sur tous les appareils
- Au moins **60 FPS sur mobile** — les VFX (glitch fields, etc.) doivent s'adapter au niveau de qualité choisi par le joueur

---

## Suivi

Chaque module = un ou plusieurs commits. À chaque modification, on coche les cases.

Ordre d'exécution recommandé :

1. Module 6 (Bugfixes) — Corrections indispensables des mécaniques de base
2. ~~Module 1 (Bots) — Bloquant pour tester le reste avec une vraie densité~~
3. Module 2 (Lames) — Cœur du gameplay, plusieurs itérations probables
4. Module 3 (Leaderboard) — Quick win, peut être glissé entre 1 et 2
5. Module 4 (Bushes) — Cosmétique
6. Module 5 (Map structures) — Cosmétique, le plus long
7. Module 7 (Non-fonctionnel) — Objectif continu

---

## Décisions actées

- **Bots** : 15 joueurs totaux minimum, 10 bots maximum, un humain remplace un bot au-delà de 5 humains
- **Map** : forme/taille inchangées, border conservée
- **Lames — dynamique** : Vitesse de rotation croissante avec le nombre de lames, et plus de lames par cercle/rang
- **Lames — throw** : action active, cooldown 0.5 s, lame extérieure consommée
- **Bushes** : thème Glitch Fields
- **Visuel global** : cyberpunk néon conservé
- **Leaderboard** : score composite `kills×50 + maxBlades×1 + survivalSec×0.5 + crates×10 + powerups×5`

---

## Backlog post-V1 (en attente)

Améliorations validées en concept mais pas encore planifiées en sprint.

### Module 8 — Chat & commandes

- [ ] **Panneau de chat en bas à gauche** — overlay non-intrusif, semi-transparent, fade in/out automatique après inactivité
- [ ] **Input texte** : touche Entrée ouvre/ferme la zone de saisie ; texte limité (e.g. 200 chars)
- [ ] **Diffusion via Colyseus** : message broadcast à toute la room, rate-limit serveur-side (~3 messages / 5s par joueur)
- [ ] **Filtrage** : longueur max, anti-spam, blacklist mots interdits, mute par session pour les abusers
- [ ] **Commandes slash** : `/help`, `/me <action>`, `/r <code>` (changer de room), `/mute <pseudo>`, etc. — préfixe `/` parsé client-side, commandes admin gardées pour plus tard
- [ ] **Affichage** : nom du joueur (couleur de son skin), texte du message, timestamp relatif. Auto-scroll avec scrollback
- [ ] **Mobile-friendly** : keyboard ne masque pas le jeu, taille de texte adaptée

### Module 9 — Modes de jeu

Actuellement seul le mode FFA (free-for-all) existe. À ajouter :

- [ ] **Team Deathmatch** — 2 équipes (ex : rouge vs bleu), score par équipe = somme des kills, victoire à X kills ou timer. Skin auto-tinté par équipe pour reconnaissance rapide
- [ ] **Capture the Flag** — un objet "drapeau" au centre, le ramasser puis le rapporter à sa base = point. Bridé pour qui le porte (vitesse réduite, pas de boost ?)
- [ ] **Last Team Standing** — élimination par équipe, dernier groupe vivant gagne, respawn limité
- [ ] **Free-for-All** — actuel, gardé en mode par défaut
- [ ] **Architecture serveur** : un type de mode par room (filterBy mode), choix au moment du CREATE ROOM, pas en plein match. Le score persisté inclut le mode (`matches` table → colonne `game_mode`)
- [ ] **Map symétrique pour les modes équipe** : les positions de spawn/objectifs doivent garantir l'équité (pas d'avantage de map à l'équipe rouge ou bleue)
- [ ] **UI de fin de match** : tableau des scores par équipe + MVP par équipe
