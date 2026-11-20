# Agents — draft de conception (2026-11-20)

Des personnages jouables qui ont chacun deux capacités, sur le modèle des
agents d'un jeu tactique, adaptés à Blade.io : une orbite de lames qui est
à la fois l'arme, l'armure et le score. Ce document fixe le design (rôles,
capacités, chiffres de départ, contre-jeux), la méthode d'équilibrage et
l'architecture technique. Les chiffres sont ceux de la première version :
ils vivent dans `shared/src/agents.ts` et se règlent au banc
(`tools/bench-agents.js`), puis sur la télémétrie.

## 1. Principes

1. **Des choix de côté, jamais de progression.** Tous les agents sont
   gratuits, dès la première partie, et aucun n'est meilleur qu'un autre :
   ils changent la façon de jouer, pas la puissance. Rien ne s'achète,
   rien ne se débloque : pas de pay-to-win, pas d'avantage aux anciens.
   Les skins restent indépendants des agents (un skin est une apparence,
   un agent un jeu de capacités).
2. **Lisible.** Toute capacité qui touche un autre joueur se voit avant
   d'agir (préavis au sol, zone tracée, aura) ou au moment même (recul,
   ralentissement signalé). Chaque agent a un emblème de forme distincte,
   la couleur n'est jamais la seule information.
3. **Un contre-jeu pour chaque capacité.** Aucune ne tue seule : elles
   créent une ouverture (vitesse, invisibilité, contrôle, information) que
   l'orbite et les lancers concrétisent. Voir la matrice du §6.
4. **L'économie des lames reste celle du jeu.** Une capacité ne crée pas
   de lames : elle en coûte (Salve), en fait tomber au sol, disputées
   (Onde), en protège (Égide), ou n'y touche pas. Les éclats de Rafale
   disparaissent à l'atterrissage.
5. **Les nouveaux venus restent protégés.** Les règles de grâce et de
   protection d'apparition s'appliquent à toutes les capacités : un joueur
   protégé n'est ni repoussé, ni ralenti, ni attiré, ni dépouillé. Un
   nouveau venu (un débutant, ou un joueur dans les 50 s qui suivent son
   apparition) n'a rien à craindre des capacités des bots : ils ne lancent
   rien vers lui, et ni leurs pièges, ni leurs puits, ni leurs Ondes, ni
   leurs Sonars ne le touchent. Ils le poursuivent comme avant les
   agents.
6. **Les règles de jeu restent au serveur.** Le client envoie une demande
   (« capacité 1 vers ce point »), le serveur décide. Seuls les effets sur
   le déplacement du joueur local sont prédits, avec la même fonction que
   le serveur (`stepMovement`), sinon chaque Éclair ferait un à-coup.

## 2. Ce que le joueur fait

| | Clavier / souris | Tactile |
|---|---|---|
| Capacité | **E** | bouton carré à l'emblème de l'agent, au-dessus de LANCER |
| Ultime | **R** | bouton rond, dont l'anneau se remplit avec la charge |
| Visée | curseur (comme les lancers) ; sans visée : sens de marche | glisser depuis le bouton (comme LANCER) ; tap : sens de marche |

E et R sont au même endroit en AZERTY et en QWERTY.

- **Choix de l'agent** au lobby (rangée de six emblèmes sous le pseudo,
  fiche de l'agent choisi : rôle, capacité, ultime ; en paysage sur
  téléphone, la rangée seule), retenu sur l'appareil. Changeable sur la
  carte de fin de vie : le nouvel agent part avec la vie suivante (pas en
  dernière équipe en vie, où la manche suivante remet tout le monde en
  jeu).
- **HUD** : deux emplacements en bas au centre au bureau (le chat est à
  gauche), au-dessus de LANCER et BOOST au toucher : emblème de la
  capacité et décompte de sa recharge, anneau de charge de l'ultime, son
  pourcentage, PRÊT quand il est plein, puis la durée de l'effet. La
  touche est écrite sur l'emplacement, le nom de la capacité dessous.
- **Repéré** : un joueur révélé par un Sonar ou un piège le lit dans un
  bandeau (« REPÉRÉ, un adversaire te voit pendant 4 s ») ; ralenti par un
  piège aussi. Sur la minimap, un adversaire caché que l'on voit (révélé,
  au contact) est cerclé.
- **Nametags** : l'emblème de l'agent devant le nom (on sait ce qu'on
  affronte).

## 3. Ultime : la charge

Une jauge de 0 à 100. L'ultime coûte 100 (un coût par agent est prévu
dans `shared/src/agents.ts`, pour l'équilibrage).

| Source | Charge |
|---|---|
| Chaque seconde en vie (en partie) | +1 |
| Élimination | +20 |
| Caisse brisée (coffre, puce, rack compris) | +5 |
| Power-up ramassé | +3 |

La charge **survit à la mort** (un joueur éliminé revient avec ce qu'il a
gagné : c'est un mécanisme de retour, pas une prime au plus fort) mais pas
à un changement d'agent (on ne passe pas un ultime chargé à un autre kit).
Sans élimination, un ultime toutes les 100 s environ ; un joueur qui se bat
bien, un peu plus souvent. Les sources sont volontairement plates : un
gros joueur ne charge pas plus vite qu'un petit à actions égales.

## 4. Les six agents

Quatre rôles : **Duelliste** (engager, poursuivre), **Contrôleur**
(façonner le terrain), **Initiateur** (information, ouverture),
**Gardien** (tenir, encaisser). Recharges et durées en secondes.

### VOLT — Duelliste · emblème : éclair
« Frappe vite, repart plus vite. »

- **Éclair** (capacité, recharge 8) : un bond dans la direction visée (à
  défaut, celle de la marche) : une impulsion de 46 u/s qui s'amortit
  comme un recul, soit ~8 u parcourus en une demi-seconde. Engager une
  orbite, esquiver un lancer, sortir d'un piège. Un clash pendant le bond
  le coupe (le recul est plafonné, comme aujourd'hui).
- **Surtension** (ultime, 6 s) : le boost ne coûte plus de lame (même à
  zéro lame) et Éclair se recharge en 1,5 s. Aura électrique visible de
  tous.
- *Contre-jeu* : le bond se voit (traînée), sa recharge est longue hors
  ultime ; Piège et Singularité le clouent, Égide le punit s'il fonce
  dans une orbite protégée.

### SAGAIE — Duelliste · emblème : fer de lance
« Tue à distance. »

- **Salve** (capacité, recharge 11) : trois lancers d'un coup, en éventail
  de ±10°, pour une lame : celle du centre est la lame extérieure (elle
  retombe et se ramasse comme tout lancer), les deux autres sont des éclats
  qui disparaissent en retombant.
- **Rafale** (ultime, 4 s) : les lancers ne coûtent plus de lame et se
  rechargent en 0,25 s au lieu de 0,5 : ce sont des éclats (Communes, un
  impact) qui disparaissent en retombant. Seize lancers au plus, à viser.
- *Contre-jeu* : tout est esquivable (projectiles à 38 u/s, portée 30 u) ;
  Égide et Bastion arrêtent les éclats sans perdre de lame ; Nuée cache la
  cible.

### BRUME — Contrôleur · emblème : volute
« Disparaît, fait disparaître. »

- **Nuée** (capacité, recharge 16) : un nuage de 6,5 u de rayon pendant
  7 s, au point visé (22 u au plus ; sans visée : à ses pieds). Comme un
  buisson : qui est dedans est caché à qui est dehors, sauf au contact des
  orbites. Pour fuir, couper une ligne de lancer, ou tendre une embuscade.
- **Éclipse** (ultime, 7 s) : Brume est cachée partout, comme dans un
  buisson (visible seulement au contact des orbites, et de ses alliés).
- *Contre-jeu* : Sonar et Piège révèlent à travers tout ; la règle du
  contact fait qu'on ne se bat jamais contre des lames invisibles ;
  Onde touche ce qu'on ne voit pas.

### VORTEX — Contrôleur · emblème : spirale
« Attire, ralentit, piège. »

- **Piège** (capacité, recharge 10) : posé à ses pieds, invisible des
  adversaires, armé après 1 s, deux au plus (le plus ancien saute), 60 s
  de vie. Un adversaire qui marche dessus est ralenti de 40 % pendant
  2,5 s et révélé à Vortex (et à ses alliés) pendant 4 s.
- **Singularité** (ultime) : un puits au point visé (24 u au plus ; sans
  visée : 10 u devant), 11 u de rayon, préavis de 0,5 s puis 3,5 s
  d'attraction vers le centre à 7 u/s (on marche à 11 : on s'en sort,
  lentement, ou au boost) ; les lames au sol y sont aspirées.
- *Contre-jeu* : le puits se voit avant d'agir ; Éclair et le boost en
  sortent ; Bastion y est insensible ; un piège se devine (sur le passage
  d'un Vortex qui fuit) et ne coûte aucune lame.

### VIGIE — Initiatrice · emblème : œil
« Voit tout, ouvre le combat. »

- **Sonar** (capacité, recharge 14) : révèle pendant 4 s tous les
  adversaires à 38 u, même cachés (buisson, Nuée, Éclipse, immeuble pour
  les bots), à Vigie et à ses alliés. Les joueurs repérés sont prévenus.
- **Onde** (ultime) : préavis de 0,6 s (cercle au sol, visible de tous)
  puis une onde de 12 u autour du point d'activation : les adversaires
  sont repoussés (recul maximal) et lâchent 20 % de leurs lames (12 au
  plus), qui tombent au sol, à prendre. La mécanique des obélisques du
  décor interactif, portée par un joueur.
- *Contre-jeu* : le préavis laisse le temps de sortir du cercle (Éclair,
  boost) ; Égide et Bastion protègent les lames ; Vigie doit se placer au
  cœur du combat pour la lancer.

### REMPART — Gardien · emblème : bouclier
« Tient la ligne. »

- **Égide** (capacité, recharge 15) : 2,5 s pendant lesquelles ses lames
  en orbite ne peuvent être ni brisées (clash, projectile) ni arrachées
  (Onde). Elles frappent normalement : un échange pendant l'Égide ne
  coûte rien à Rempart.
- **Bastion** (ultime, 5 s) : Égide, plus l'insensibilité au recul, au
  gel du clash, au ralentissement et à l'attraction ; Rempart avance à
  85 % de sa vitesse.
- *Contre-jeu* : tout est visible (bouclier autour de l'orbite) et court ;
  on s'écarte et on revient après ; Rempart est plus lent sous Bastion ;
  Éclipse et Nuée lui retirent sa cible.

## 5. Interactions avec le jeu existant

- **Power-ups** : se cumulent avec les capacités (Speed et Éclair
  s'additionnent : le bond passe par le recul, hors du plafond de vitesse
  du boost ; Bouclier et Égide : l'Égide prime, elle annule tout dégât).
- **Buissons** : Nuée et Éclipse suivent exactement leur règle ; Sonar et
  le Piège révèlent aussi les joueurs dans un buisson.
- **Modes équipe** : rien d'hostile ne touche un allié ; une révélation
  profite à toute l'équipe ; un allié caché reste visible de son équipe.
- **Classé** : les agents sont permis (ils sont gratuits et égaux) ; un
  drapeau par mode (`GameModeInfo.agents`) permet de les retirer d'un mode.
- **Quartier** (carte à murs) : tout fonctionne ; Singularité et Éclair
  respectent les murs (le déplacement passe par `stepMovement`).
- **Évènements de carte, décor interactif** : inchangés ; une caisse
  brisée charge l'ultime.
- **Débutants** : grâce et protection d'apparition s'appliquent à toutes
  les capacités ; une capacité offensive lancée met fin à la grâce de son
  auteur, comme un lancer. Aucune capacité de bot ne touche un nouveau
  venu (principe 5).

## 6. Qui contre qui

| ↓ face à → | Volt | Sagaie | Brume | Vortex | Vigie | Rempart |
|---|---|---|---|---|---|---|
| **Volt** | — | esquive, rattrape | — | sort du puits | sort de l'Onde | ✗ s'y brise |
| **Sagaie** | ✗ bondit trop | — | ✗ perd la cible | tire dans le puits | — | ✗ arrêtée |
| **Brume** | — | se cache | — | ✗ piégée | ✗ repérée | lui ôte sa cible |
| **Vortex** | ralentit, aspire | — | révèle | — | — | ✗ insensible |
| **Vigie** | — | — | révèle | — | — | ✗ lames protégées |
| **Rempart** | punit le bond | arrête les lancers | — | insensible | protège ses lames | — |

Chaque agent a au moins un bon et un mauvais duel : pas d'agent dominant.

## 7. Méthode d'équilibrage

1. **Budget.** Chaque ultime vaut, en lames, à peu près la même chose
   dans un combat type (cinq à douze lames gagnées, sauvées ou
   arrachées) ; chaque capacité s'utilise quatre à huit fois par minute.
2. **Banc** (`tools/bench-agents.js`) : rooms de bots seuls, agents
   répartis à parts égales, plusieurs graines ; par agent : score par
   minute, éliminations et morts par minute, durée de vie, pic de lames,
   usage des capacités. Critère : score par minute de chaque agent à
   ±15 % de la moyenne, rapport éliminations / morts entre 0,8 et 1,25.
   Les bots jouent les capacités avec des règles simples : le banc mesure
   leur puissance brute, pas le talent d'un joueur ; il écarte les
   déséquilibres grossiers.

   Résultats (32 graines × 10 min, 10 bots par room) : sans capacités,
   écart de 5 % (le bruit de la mesure) ; première version, 8 % (Volt
   devant, éliminations / morts 1,17 ; Sagaie derrière, 0,85, sa Salve
   coûtant trois lames) ; Éclair à 8 s et Salve à une lame, 12 % (Sagaie
   devant) ; Salve à 11 s, **7 %** (de −5 % pour Brume et Rempart à +7 %
   pour Sagaie, rapports éliminations / morts de 0,90 à 1,09).

   Bancs existants, avant et après les agents, mêmes graines :
   - débutant, vies de 30 s (8 graines) : 3,3 % de morts avant 30 s
     avant, 2,6 % après ; joueur qui revient : 13,6 % puis 12,4 % ;
   - débutant, temps avant sa première mort : médiane de 79 s avant et
     après sur les graines 9 à 24 ; sur les graines 1 à 8, 142 s puis
     86 s, mais cette médiane suit le nombre de sessions plafonnées à
     180 s (17 puis 13 sur ~38) : du bruit, à ce nombre de sessions. Un
     diagnostic des morts (qui tue, sous quel effet) n'en a trouvé aucune
     sous un piège ou dans un puits, une seule sous un effet d'agent ;
   - snowball (8 graines × 15 min) : règne médian du leader 22,5 s puis
     25 s, 101 puis 100 changements de leader par heure, record de lames
     par vie médian 9 et p90 27 dans les deux cas (p99 43 puis 45) ;
   - champions : inchangé (champions tombés sous les coups des bots) ;
   - coût du tick (60 bots, `BENCH_SEED=3`) : 0,91 ms puis 1,03 ms en
     moyenne (p99 1,9 puis 2,2 ms), 19 puis 19,9 Ko/s par client.
3. **Bancs existants** : survie d'un débutant (`bench-survival.js`, ne
   doit pas se dégrader), snowball (`bench-snowball.js`), coût du tick
   (`bench-server.js`).
4. **Télémétrie** : chaque fin de vie enregistre l'agent
   (`life_stats.agent`, migration 0015) ; la vue `life_stats_by_agent`
   compare les agents en parties publiques réelles.

## 8. Architecture

**Contrat partagé** (`shared/src/agents.ts`) : identifiants, rôles,
réglages chiffrés, charge de l'ultime, portée et point d'une capacité
(`castPoint`), effets actifs. `InputMessage.cast` (1 capacité, 2 ultime)
et `castX/castY` (vecteur visé depuis le joueur). `stepMovement` gagne une
impulsion d'entrée (Éclair), un multiplicateur de vitesse (Piège, Bastion),
des champs d'attraction (Singularité) et des sous-pas quand un pas dépasse
0,45 u (un bond ne traverse pas une barrière) ; `moveContextAt` construit
le même contexte au serveur et dans la prédiction.

**Serveur** :
- `Player` : `agent` (public), `abilityReadyAt`, `ultCharge`,
  `agentEffect`, `agentEffectUntil`, `slowUntil` (au joueur seul),
  `agentFx` (public : effets visibles), révélations (champ serveur).
- `ArenaState.zones` (`@view`) : nuages, pièges, puits, préavis d'Onde.
  Un piège n'est envoyé qu'à son poseur et à ses alliés.
- `systems/abilities.ts` (`AbilitySystem`) : demandes, recharges, charge
  de l'ultime, effets, zones, pièges, puits, Onde. Une demande voyage avec
  son input : appliquée au pas de cet input, comme la prédiction du
  client la rejoue.
- Collisions et projectiles : Égide (aucun dégât subi), Bastion (ni recul
  ni gel), éclats de Rafale (disparaissent à l'atterrissage, ne comptent
  ni comme perte ni comme butin).
- Zones d'intérêt, résumé et bots : « caché » = buisson, Nuée ou Éclipse ;
  « révélé » par Sonar ou Piège à un joueur et à son équipe.
- `systems/botAbilities.ts` : chaque bot reçoit un agent au hasard et joue
  ses capacités selon son action (poursuite, fuite, récolte) et son niveau.

**Client** :
- `agents/` : choix retenu (`agentStore.ts`), fiche et emblèmes
  (`info.ts`), couleurs (`looks.ts`, données comme les thèmes), choix au
  lobby et à la mort (`AgentPicker.ts`), HUD (`AbilityHud.ts`), effets
  dans la scène (`AbilityView.ts` : nuages, pièges, puits, auras ; une
  fumée s'éclaircit pour le joueur local qui est dedans), sons. Préavis de
  l'Onde : celui des obélisques (`PulseView`), tiré de la zone, reçue même
  quand Vigie est caché.
- Prédiction : impulsion d'Éclair à l'envoi de l'input, ralentissement et
  attraction lus dans l'état ; tout rejoué à la réconciliation.
- Shaders des effets dans la scène dès le lobby (« +0 en partie »).

**Tests** (`server/test/agents.test.ts`) : choix et validation, recharge,
charge et dépense de l'ultime, effet de chaque capacité, alliés et
protections épargnés, visibilité (Nuée, Éclipse, Sonar, Piège), prédiction
identique au serveur (Éclair, Piège, Singularité), bots qui lancent leurs
capacités.

## 9. Mise en service

- Activés dans tous les modes (`GameModeInfo.agents`).
- Migration Supabase 0015 (colonne `life_stats.agent`, vue
  `life_stats_by_agent`) : sans elle, la télémétrie s'écrit sans l'agent.
- Playtest à faire (liste dans `PLAN.md`) : sensation de chaque agent,
  lisibilité en combat, contrôles tactiles.

## 10. Plus tard

Des agents supplémentaires (un second Initiateur et un second Gardien
équilibreraient les rôles), un aperçu 3D des capacités dans la fiche,
des voix et des sons propres à chaque agent.
