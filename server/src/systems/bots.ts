import {
  BOT_MAX_TOTAL,
  BOT_MIN_PLAYERS,
  BOT_NAMES,
  BOT_THINK_INTERVAL,
  MAP_RADIUS,
  PLAYER_SPEED,
  THROW_PROJECTILE_MAX_RANGE,
  THROW_PROJECTILE_SPEED,
  WALL_KILL_THICKNESS,
} from "@bladeio/shared";
import { ArenaState } from "../state/ArenaState";
import { Player } from "../state/Player";

// Rayon de sécurité : marge confortable pour que ni le corps, ni les lames
// orbitantes ne touchent la zone de mort.
const BOT_SAFE_RADIUS = MAP_RADIUS - WALL_KILL_THICKNESS - 8;

// Clamp un point cible dans la zone safe.
function clampToSafe(x: number, y: number): { x: number; y: number } {
  const d = Math.hypot(x, y);
  if (d <= BOT_SAFE_RADIUS) return { x, y };
  const scale = BOT_SAFE_RADIUS / d;
  return { x: x * scale, y: y * scale };
}

// IA très simple pour les bots :
// - Si un ennemi vivant est plus faible (moins de lames) à portée → fonce
//   dessus pour l'enrouler avec ses lames.
// - Sinon, vise la lame au sol la plus proche.
// - Sinon, déambule vers un point random près du centre.
// - Boost si on a beaucoup de lames et qu'on poursuit quelqu'un.
// Re-décide toutes les BOT_THINK_INTERVAL secondes ; entre deux décisions
// les inputs sont gardés tels quels (économie de calcul).
export enum BotPersonality {
  Aggressive = 0,
  Farmer = 1,
  Hunter = 2,
  Camper = 3,
}

interface BotState {
  targetX: number;
  targetY: number;
  nextThinkAt: number;
  personality: BotPersonality;
  jitterAngle: number;
  fleeSign: number;
  actionType: string;
  // Hysteresis : ID du joueur cible courant. Le bot conserve cette cible
  // tant qu'elle reste pertinente, plutôt que de re-scorer à zéro chaque
  // tick. Évite l'oscillation entre cibles équivalentes — donne une
  // sensation d'"intention".
  currentTargetId: string | null;
  // Sinusoïde de courbure d'approche : déphasage individuel + signe
  // (-1/+1) → chaque bot prend un arc d'approche différent, ne fonce
  // jamais en ligne droite. Phase incrémentée par wall-clock.
  curveSign: number;
  curvePhaseOffset: number; // [0, 2π) initial seed
  // Niveau de menace ressenti (0..N) : nombre de lames perdues dans les
  // dernières 3s. Mis à jour à chaque decide(). >3 = "je prends cher"
  // → bias vers flee.
  threatLevel: number;
}

// Cache vélocité par joueur — une seule entrée par playerID, mise à jour
// à chaque tick du BotController. Permet aux bots de prédire les
// trajectoires avec la VRAIE vitesse (input + knockback + friction)
// au lieu de p.inputDx qui n'est qu'une intention sans grandeur.
interface VelocityCache {
  vx: number;
  vy: number;
  prevX: number;
  prevY: number;
  lastT: number; // secondes
}

// Calcule un point d'interception prédit pour un projectile partant de
// (origX, origY) à projSpeed contre une cible à (tgtX, tgtY) qui se déplace
// à (tgtVx, tgtVy). Itération à 2 passes pour raffiner — converge vite à
// l'échelle des distances de combat (12-30u). Au-delà la cible peut tourner
// donc précision marginale, peu utile.
function predictIntercept(
  origX: number, origY: number,
  tgtX: number, tgtY: number,
  tgtVx: number, tgtVy: number,
  projSpeed: number,
): { x: number; y: number; t: number } {
  let px = tgtX;
  let py = tgtY;
  let t = 0;
  for (let i = 0; i < 2; i++) {
    const dx = px - origX;
    const dy = py - origY;
    const d = Math.hypot(dx, dy);
    t = d / Math.max(0.001, projSpeed);
    px = tgtX + tgtVx * t;
    py = tgtY + tgtVy * t;
  }
  return { x: px, y: py, t };
}

export class BotController {
  private state = new Map<string, BotState>();
  // Vélocité lissée des joueurs (humans + bots) — utilisée pour les
  // prédictions d'intercept des throws et de chase. EMA avec alpha 0.7
  // sur le sample courant pour absorber le knockback / micro-jitter sans
  // figer les tournants brusques.
  private velocity = new Map<string, VelocityCache>();

  spawnBot(arena: ArenaState, spawnPoint: { x: number; y: number }): Player {
    const id = "bot_" + Math.random().toString(36).slice(2, 10);
    const p = new Player();
    p.id = id;
    const usedNames = new Set<string>();
    arena.players.forEach((player) => {
      if (player.alive) usedNames.add(player.name);
    });
    
    const availableNames = BOT_NAMES.filter(n => !usedNames.has(n));
    if (availableNames.length > 0) {
      p.name = availableNames[Math.floor(Math.random() * availableNames.length)];
    } else {
      // Fallback au cas où il y a plus de bots que de noms disponibles
      p.name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] + " II";
    }
    p.x = spawnPoint.x;
    p.y = spawnPoint.y;
    p.alive = true;
    p.spawnedAt = Date.now();
    p.spinPhase = Math.random() * Math.PI * 2;
    p.spinScale = 0.75 + Math.random() * 0.5;
    p.isBot = true;
    arena.players.set(id, p);
    return p;
  }

  desiredBotCount(arena: ArenaState): number {
    let humans = 0;
    let bots = 0;
    arena.players.forEach((p) => {
      if (p.isBot) bots++;
      else humans++;
    });
    const target = Math.max(0, BOT_MIN_PLAYERS - humans);
    return Math.min(BOT_MAX_TOTAL, target);
  }

  forEachBot(arena: ArenaState, fn: (p: Player) => void): void {
    arena.players.forEach((p) => {
      if (p.isBot) fn(p);
    });
  }

  update(dt: number, arena: ArenaState): void {
    const now = (Date.now() / 1000);
    // Mise à jour cache vélocité avant les décisions des bots — toutes les
    // prédictions d'intercept en dépendent.
    this.updateVelocityCache(arena, now);
    arena.players.forEach((p) => {
      if (!p.isBot || !p.alive) return;
      let st = this.state.get(p.id);
      if (!st) {
        const personality = Math.floor(Math.random() * 4) as BotPersonality;
        st = {
          targetX: p.x,
          targetY: p.y,
          nextThinkAt: 0,
          personality,
          jitterAngle: 0,
          fleeSign: Math.random() < 0.5 ? 1 : -1,
          actionType: "wander",
          currentTargetId: null,
          curveSign: Math.random() < 0.5 ? 1 : -1,
          curvePhaseOffset: Math.random() * Math.PI * 2,
          threatLevel: 0,
        };
        this.state.set(p.id, st);
      }
      if (now >= st.nextThinkAt) {
        // Reaction time jitter par personnalité : Hunter rapide (focused),
        // Aggressive moyen, Farmer plus lent (méthodique), Camper le plus
        // lent (réaction défensive). Cible 50-300ms de variance par-dessus
        // l'intervalle de base. Plus humain qu'une jitter uniforme.
        const reactionByPers =
          st.personality === BotPersonality.Hunter ? 0.05 :
          st.personality === BotPersonality.Aggressive ? 0.10 :
          st.personality === BotPersonality.Farmer ? 0.20 :
          0.30; // Camper
        st.nextThinkAt = now + BOT_THINK_INTERVAL + Math.random() * reactionByPers;
        this.decide(p, arena, st);
      }
      this.applyInput(p, st, now);
      // Évalue un throw opportuniste à chaque tick (le cooldown est géré
      // par processThrows). Pas de coût dispendieux : une boucle bornée
      // sur les joueurs + caisses, après alignement on shortcut.
      this.tryThrow(p, arena, st);
    });

    if (this.state.size > 32) {
      for (const id of [...this.state.keys()]) {
        if (!arena.players.has(id)) this.state.delete(id);
      }
    }
  }

  // Met à jour la vélocité lissée de chaque joueur. Appelé une fois par
  // tick au début de update(). EMA(0.7) pour absorber le micro-jitter du
  // knockback sans figer les tournants brusques. Skipper si le delta de
  // temps est trop court (< 50ms) → évite les divisions explosives.
  private updateVelocityCache(arena: ArenaState, now: number): void {
    arena.players.forEach((p) => {
      if (!p.alive) return;
      let v = this.velocity.get(p.id);
      if (!v) {
        this.velocity.set(p.id, { vx: 0, vy: 0, prevX: p.x, prevY: p.y, lastT: now });
        return;
      }
      const dt = now - v.lastT;
      if (dt < 0.05) return;
      const newVx = (p.x - v.prevX) / dt;
      const newVy = (p.y - v.prevY) / dt;
      v.vx = v.vx * 0.3 + newVx * 0.7;
      v.vy = v.vy * 0.3 + newVy * 0.7;
      v.prevX = p.x;
      v.prevY = p.y;
      v.lastT = now;
    });
    // GC les entrées orphelines périodiquement.
    if (this.velocity.size > arena.players.size * 1.5 + 4) {
      for (const id of [...this.velocity.keys()]) {
        if (!arena.players.has(id)) this.velocity.delete(id);
      }
    }
  }

  // Lit la vélocité en cache (zéro si absente). Helper qui évite des
  // `?.vx` partout dans les calculs de prédiction.
  private getVelocity(id: string): { vx: number; vy: number } {
    const v = this.velocity.get(id);
    return v ? { vx: v.vx, vy: v.vy } : { vx: 0, vy: 0 };
  }

  // Compte les lames perdues récemment (3s) — proxy pour "je prends cher".
  // Lit le buffer recentLosses du bot lui-même (rempli par clashes.ts à
  // chaque destruction d'une de ses lames).
  private recentDamageRate(bot: Player, nowMs: number): number {
    const cutoff = nowMs - 3000;
    let count = 0;
    for (const l of bot.recentLosses) {
      if (l.ts >= cutoff) count++;
    }
    return count;
  }

  private decide(bot: Player, arena: ArenaState, st: BotState): void {
    // Mise à jour du threat level avant le scoring : flee/chase/farm en
    // dépendent.
    st.threatLevel = this.recentDamageRate(bot, Date.now());

    const scores = [];

    // ── Priorité absolue : éviter le mur ──
    const wallAction = this.scoreAvoidWall(bot);
    if (wallAction) scores.push(wallAction);

    const fleeAction = this.scoreFlee(bot, arena, st);
    if (fleeAction) scores.push(fleeAction);

    const chaseAction = this.scoreChase(bot, arena, st);
    if (chaseAction) scores.push(chaseAction);

    const farmBladeAction = this.scoreFarmBlades(bot, arena, st);
    if (farmBladeAction) scores.push(farmBladeAction);

    const farmCrateAction = this.scoreFarmCrates(bot, arena, st);
    if (farmCrateAction) scores.push(farmCrateAction);

    const farmPowerupAction = this.scoreFarmPowerups(bot, arena, st);
    if (farmPowerupAction) scores.push(farmPowerupAction);

    scores.push(this.scoreWander(bot, arena, st));

    scores.sort((a, b) => b.score - a.score);
    const bestAction = scores[0];

    // Clamp la cible dans la safe zone pour ne jamais viser hors de la map.
    const safe = clampToSafe(bestAction.x, bestAction.y);
    st.targetX = safe.x;
    st.targetY = safe.y;
    st.actionType = bestAction.type;
    bot.inputBoost = bestAction.boost;

    // Si on n'a pas pris une action chase, libérer la commitment de cible
    // (sinon elle persiste et bias les futures décisions chase de manière
    // incorrecte alors que le bot a fait autre chose entre temps).
    if (bestAction.type !== "chase") {
      st.currentTargetId = null;
    }

    // Aim Jitter
    st.jitterAngle = (Math.random() - 0.5) * 0.5; // Up to ~14 degrees of error
  }

  private scoreFlee(bot: Player, arena: ArenaState, st: BotState) {
    let threatDx = 0;
    let threatDy = 0;
    let maxDanger = 0;

    arena.players.forEach((other) => {
      if (other.id === bot.id || !other.alive) return;
      if (other.bladeCount <= bot.bladeCount) return;

      const dx = bot.x - other.x;
      const dy = bot.y - other.y;
      const d = Math.hypot(dx, dy);

      const threatRadius = 25;
      if (d < threatRadius && d > 0.001) {
        const danger = (threatRadius - d) + (other.bladeCount - bot.bladeCount);
        maxDanger = Math.max(maxDanger, danger);
        threatDx += dx / d;
        threatDy += dy / d;
      }
    });

    if (maxDanger === 0) return null;

    let m = Math.hypot(threatDx, threatDy);
    if (m < 0.15) {
      let perpDx = 0;
      let perpDy = 0;
      arena.players.forEach((other) => {
        if (perpDx !== 0 || perpDy !== 0) return;
        if (other.id === bot.id || !other.alive) return;
        if (other.bladeCount <= bot.bladeCount) return;
        const dx = bot.x - other.x;
        const dy = bot.y - other.y;
        const d = Math.hypot(dx, dy);
        if (d < 25 && d > 0.001) {
          perpDx = -dy / d * st.fleeSign;
          perpDy = dx / d * st.fleeSign;
        }
      });
      threatDx = perpDx;
      threatDy = perpDy;
      m = Math.hypot(threatDx, threatDy) || 1;
    }

    // Bonus threat-aware : si le bot prend cher (≥ 3 lames perdues en 3s),
    // boost le flee score pour qu'il décide de fuir même contre un ennemi
    // à priori comparable. "Je suis blessé, je dois me regrouper".
    const threatBoost = st.threatLevel >= 3 ? st.threatLevel * 50 : 0;

    return {
      type: "flee",
      score: 1000 + maxDanger * 10 + threatBoost,
      x: bot.x + (threatDx / m) * 30,
      y: bot.y + (threatDy / m) * 30,
      // Plus enclin à boost en flee si déjà blessé.
      boost: bot.bladeCount > 2 && (maxDanger > 10 || st.threatLevel >= 4),
    };
  }

  private scoreChase(bot: Player, arena: ArenaState, st: BotState) {
    let bestScore = -1;
    let bestId: string | null = null;
    let targetX = 0, targetY = 0;
    let shouldBoost = false;

    let minBlades = 6;
    let aggroAdvantage = 3;

    if (st.personality === BotPersonality.Aggressive) {
      minBlades = 1;
      aggroAdvantage = -1;
    } else if (st.personality === BotPersonality.Hunter) {
      minBlades = 2;
      aggroAdvantage = 0;
    } else if (st.personality === BotPersonality.Farmer) {
      minBlades = 5;
      aggroAdvantage = 2;
    }

    if (bot.bladeCount < minBlades) return null;

    // Hysteresis de cible : bonus pour la cible courante. Empêche
    // l'oscillation entre deux cibles équivalentes (le bot reste engagé
    // avec celle qu'il poursuivait déjà). Bonus modeste — si une autre
    // cible est NETTEMENT meilleure (>20 d'écart), on switch quand même.
    const COMMITMENT_BONUS = 20;

    arena.players.forEach((other) => {
      if (other.id === bot.id || !other.alive) return;
      if (other.bladeCount + aggroAdvantage > bot.bladeCount) return;

      const dx = other.x - bot.x;
      const dy = other.y - bot.y;
      const d = Math.hypot(dx, dy);

      if (d > 80) return;

      let score = 80 + (bot.bladeCount - other.bladeCount) * 5 - d;

      if (st.personality === BotPersonality.Hunter) score += 20;
      if (st.personality === BotPersonality.Aggressive) score += 40;

      // Bonus commitment si on poursuivait déjà cette cible.
      if (other.id === st.currentTargetId) score += COMMITMENT_BONUS;

      // Anti-double-aggro
      let someoneCloser = false;
      arena.players.forEach((competitor) => {
        if (competitor.id === bot.id || !competitor.alive || !competitor.isBot) return;
        if (Math.hypot(competitor.x - other.x, competitor.y - other.y) < d * 0.8) {
          someoneCloser = true;
        }
      });
      if (someoneCloser) score -= 40;

      if (score > bestScore) {
        bestScore = score;
        bestId = other.id;
        // Aim au point d'interception : on prédit où l'ennemi sera quand on
        // arrive là-bas, pas sa position courante. Vitesse réelle (lissée)
        // depuis le cache, fallback sur l'input direction si la cible vient
        // d'apparaître. Lead time = d / PLAYER_SPEED (notre propre vitesse
        // d'approche, pas celle du projectile — on est en chase corps).
        const v = this.getVelocity(other.id);
        const leadT = d / Math.max(0.1, PLAYER_SPEED);
        targetX = other.x + v.vx * leadT;
        targetY = other.y + v.vy * leadT;
        shouldBoost = bot.bladeCount > 5 && d > 15 && d < 40 && st.personality !== BotPersonality.Camper;
      }
    });

    if (bestScore <= 0) return null;
    // Mémorise la cible pour le prochain tick (commitment).
    st.currentTargetId = bestId;
    return { type: "chase", score: bestScore, x: targetX, y: targetY, boost: shouldBoost };
  }

  private scoreFarmBlades(bot: Player, arena: ArenaState, st: BotState) {
    let bestScore = -1;
    let targetX = 0, targetY = 0;
    const farmRadius = bot.bladeCount < 6 ? 100 : 50;

    arena.blades.forEach((b) => {
      if (b.ownerId) return;
      const dx = b.x - bot.x;
      const dy = b.y - bot.y;
      const d = Math.hypot(dx, dy);

      if (d > farmRadius) return;

      let score = 40 - d * 0.5;
      if (st.personality === BotPersonality.Farmer) score += 20;
      if (bot.bladeCount < 3) score += 50;

      if (score > bestScore) {
        bestScore = score;
        targetX = b.x;
        targetY = b.y;
      }
    });

    if (bestScore <= 0) return null;
    return { type: "farm_blade", score: bestScore, x: targetX, y: targetY, boost: false };
  }

  private scoreFarmCrates(bot: Player, arena: ArenaState, st: BotState) {
    let bestScore = -1;
    let targetX = 0, targetY = 0;

    if (bot.bladeCount < 1) return null;

    arena.crates?.forEach((c) => {
      const dx = c.x - bot.x;
      const dy = c.y - bot.y;
      const d = Math.hypot(dx, dy);

      if (d > 60) return;

      let score = 35 - d * 0.5;
      if (st.personality === BotPersonality.Farmer) score += 25;

      if (score > bestScore) {
        bestScore = score;
        targetX = c.x;
        targetY = c.y;
      }
    });

    if (bestScore <= 0) return null;
    return { type: "farm_crate", score: bestScore, x: targetX, y: targetY, boost: false };
  }

  private scoreFarmPowerups(bot: Player, arena: ArenaState, st: BotState) {
    let bestScore = -1;
    let targetX = 0, targetY = 0;

    arena.powerups?.forEach((pu) => {
      const dx = pu.x - bot.x;
      const dy = pu.y - bot.y;
      const d = Math.hypot(dx, dy);

      if (d > 70) return;

      let score = 60 - d * 0.5;
      if (pu.type === 4 && bot.bladeCount < 5) score += 40;
      if (pu.type === 3) score += 20;

      if (score > bestScore) {
        bestScore = score;
        targetX = pu.x;
        targetY = pu.y;
      }
    });

    if (bestScore <= 0) return null;
    return { type: "farm_powerup", score: bestScore, x: targetX, y: targetY, boost: false };
  }

  private scoreWander(bot: Player, arena: ArenaState, st: BotState) {
    const distToTarget = Math.hypot(bot.x - st.targetX, bot.y - st.targetY);
    let tx = st.targetX;
    let ty = st.targetY;

    if (distToTarget < 5 || st.actionType !== "wander") {
      const r = Math.random() * (MAP_RADIUS - WALL_KILL_THICKNESS - 10);
      const a = Math.random() * Math.PI * 2;
      tx = Math.cos(a) * r;
      ty = Math.sin(a) * r;
    }

    let score = 10;
    if (st.personality === BotPersonality.Camper) score += 15;

    return { type: "wander", score, x: tx, y: ty, boost: false };
  }

  // Score « éviter le mur ». Se déclenche quand le bot entre dans la zone
  // de danger (entre BOT_SAFE_RADIUS - 5 et KILL_RADIUS). Plus il est
  // proche du bord, plus le score est élevé (dépasse le flee).
  private scoreAvoidWall(bot: Player) {
    const distFromCenter = Math.hypot(bot.x, bot.y);
    const dangerStart = BOT_SAFE_RADIUS - 5;

    if (distFromCenter < dangerStart) return null;

    const killRadius = MAP_RADIUS - WALL_KILL_THICKNESS;
    const urgency = Math.min(1, (distFromCenter - dangerStart) / (killRadius - dangerStart));

    // Viser vers le centre, proportionnel à l'urgence.
    const nx = distFromCenter > 0.001 ? -bot.x / distFromCenter : 0;
    const ny = distFromCenter > 0.001 ? -bot.y / distFromCenter : 0;

    return {
      type: "avoid_wall",
      score: 2000 + urgency * 1000, // Dépasse le flee (1000+)
      x: bot.x + nx * 25,
      y: bot.y + ny * 25,
      boost: urgency > 0.7 && bot.bladeCount > 1, // boost d'urgence
    };
  }

  private applyInput(bot: Player, st: BotState, now: number): void {
    const dx = st.targetX - bot.x;
    const dy = st.targetY - bot.y;
    const d = Math.hypot(dx, dy);

    if (d < 0.5) {
      bot.inputDx = 0;
      bot.inputDy = 0;
      return;
    }

    let angle = Math.atan2(dy, dx);
    angle += st.jitterAngle; // jitter de visée fixe par décision

    // Approche en courbe : en chase à moyenne distance (8-40u), on ajoute
    // une oscillation perpendiculaire qui module l'angle de marche. Au
    // lieu de foncer en ligne droite, le bot trace un arc. Amplitude
    // décroît avec la distance (effet plus marqué loin, presque nul de
    // près pour ne pas rater l'impact). Phase déterministe depuis now +
    // curvePhaseOffset → chaque bot oscille sur son propre cycle.
    if (st.actionType === "chase" && d > 8 && d < 40) {
      const t = now * 1.4 + st.curvePhaseOffset;
      const distAttenuation = Math.min(1, (d - 8) / 20); // 0 à d=8, 1 à d=28+
      const curveAmp = 0.32 * st.curveSign * distAttenuation; // ~18° max
      angle += Math.sin(t) * curveAmp;
    }

    let dirX = Math.cos(angle);
    let dirY = Math.sin(angle);

    // ── Filet de sécurité temps-réel ──
    // Entre deux décisions, le bot peut encore dériver vers le mur
    // (knockback, inertie). Si on est proche et qu'on se dirige vers
    // l'extérieur, on redirige immédiatement vers le centre.
    const distFromCenter = Math.hypot(bot.x, bot.y);
    if (distFromCenter > BOT_SAFE_RADIUS - 3 && distFromCenter > 0.001) {
      // Produit scalaire direction · radiale : >0 = on s'éloigne du centre
      const radX = bot.x / distFromCenter;
      const radY = bot.y / distFromCenter;
      const dot = dirX * radX + dirY * radY;
      if (dot > 0) {
        // Rediriger vers le centre
        dirX = -radX;
        dirY = -radY;
      }
    }

    bot.inputDx = dirX;
    bot.inputDy = dirY;
  }

  // Tente un lancer si un ennemi (ou une caisse) est dans le cône de tir
  // du bot. La direction de tir = direction de mouvement courante (le
  // serveur lit p.dirX/dirY au moment du throw, valeur que processThrows
  // verra après updateMovement). Aucun aim assist : si le bot regarde
  // ailleurs, le tir part ailleurs.
  private tryThrow(bot: Player, arena: ArenaState, st: BotState): void {
    const now = Date.now();
    if (bot.throwCooldownUntil > now) return;
    // Pas de tir en fuite (mauvaise direction) ni en errance/évitement
    // mur (rien à viser). Le bot tire surtout en chase ou en farm_crate.
    if (st.actionType === "flee" || st.actionType === "wander" || st.actionType === "avoid_wall") return;

    // Seuil de lames mini par personnalité : un bot qui n'a presque rien
    // ne gaspille pas une lame en projectile, il préfère farmer.
    let minBlades = 6;
    if (st.personality === BotPersonality.Aggressive) minBlades = 4;
    else if (st.personality === BotPersonality.Hunter) minBlades = 5;
    else if (st.personality === BotPersonality.Farmer) minBlades = 9;
    else if (st.personality === BotPersonality.Camper) minBlades = 7;
    if (bot.bladeCount < minBlades) return;

    // Direction de tir = direction de mouvement (= input). Si pas de
    // mouvement (bot en pause), pas de tir.
    const aimMag = Math.hypot(bot.inputDx, bot.inputDy);
    if (aimMag < 0.1) return;
    const ax = bot.inputDx / aimMag;
    const ay = bot.inputDy / aimMag;

    // Cône d'acceptation par personnalité. Plus serré = plus précis.
    let cosThreshold = 0.88; // ~28°
    if (st.personality === BotPersonality.Aggressive) cosThreshold = 0.82; // ~35°
    else if (st.personality === BotPersonality.Hunter) cosThreshold = 0.94; // ~20°

    // Plage de portée utile : trop près (<12) le projectile clash sur ses
    // propres lames ; au-delà de la portée max, la lame retombe au sol et
    // le tir est gaspillé (le bot ne touche rien). Petite marge anti-fuite
    // pour que la cible n'esquive pas trivialement en marchant en arrière.
    const minDist = 12;
    const maxDist = THROW_PROJECTILE_MAX_RANGE - 2;

    let foundTarget = false;

    arena.players.forEach((other) => {
      if (foundTarget) return;
      if (other.id === bot.id || !other.alive) return;
      if (other.spawnProtectionUntil > now) return;
      const dx = other.x - bot.x;
      const dy = other.y - bot.y;
      const d = Math.hypot(dx, dy);
      if (d < minDist || d > maxDist) return;
      // Lead aim au point d'interception : on aligne sur où la cible SERA
      // quand le projectile arrive (pas où elle est). Sans ça les bots
      // ratent toute cible en mouvement à >12u. La vitesse cible vient du
      // cache lissé (vraie vitesse incluant knockback, pas juste l'intent
      // input).
      const v = this.getVelocity(other.id);
      const intercept = predictIntercept(bot.x, bot.y, other.x, other.y, v.vx, v.vy, THROW_PROJECTILE_SPEED);
      const idx = intercept.x - bot.x;
      const idy = intercept.y - bot.y;
      const idd = Math.hypot(idx, idy);
      if (idd < 0.1) return;
      const cos = ax * (idx / idd) + ay * (idy / idd);
      if (cos < cosThreshold) return;
      // Vérifie aussi que l'intercept reste DANS la portée — si la cible
      // file, l'intercept peut sortir de maxDist et la lame finirait au sol.
      if (idd > maxDist) return;
      foundTarget = true;
    });

    // Caisses : seulement si pas de joueur trouvé. Caisses statiques donc
    // pas d'intercept à calculer — alignement direct avec la position.
    if (!foundTarget && (st.personality === BotPersonality.Farmer || st.personality === BotPersonality.Camper)) {
      arena.crates?.forEach((c) => {
        if (foundTarget) return;
        if (c.hp <= 0) return;
        const dx = c.x - bot.x;
        const dy = c.y - bot.y;
        const d = Math.hypot(dx, dy);
        if (d < minDist || d > maxDist) return;
        const cos = ax * (dx / d) + ay * (dy / d);
        if (cos < cosThreshold) return;
        foundTarget = true;
      });
    }

    if (foundTarget) bot.inputThrow = true;
  }

  cleanupDead(arena: ArenaState): void {
    const toRemove: string[] = [];
    arena.players.forEach((p) => {
      if (p.isBot && !p.alive) toRemove.push(p.id);
    });
    for (const id of toRemove) {
      const bladeIds: string[] = [];
      arena.blades.forEach((b) => {
        if (b.ownerId === id) bladeIds.push(b.id);
      });
      for (const bid of bladeIds) arena.blades.delete(bid);
      arena.players.delete(id);
      this.state.delete(id);
    }
  }
}
