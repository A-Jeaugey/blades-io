import {
  BOT_MAX_TOTAL,
  BOT_MIN_PLAYERS,
  BOT_NAMES,
  BOT_THINK_INTERVAL,
  MAP_RADIUS,
  THROW_PROJECTILE_MAX_RANGE,
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
}

export class BotController {
  private state = new Map<string, BotState>();

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
    arena.players.forEach((p) => {
      if (!p.isBot || !p.alive) return;
      let st = this.state.get(p.id);
      if (!st) {
        st = {
          targetX: p.x,
          targetY: p.y,
          nextThinkAt: 0,
          personality: Math.floor(Math.random() * 4) as BotPersonality,
          jitterAngle: 0,
          fleeSign: Math.random() < 0.5 ? 1 : -1,
          actionType: "wander",
        };
        this.state.set(p.id, st);
      }
      if (now >= st.nextThinkAt) {
        st.nextThinkAt = now + BOT_THINK_INTERVAL + (Math.random() * 0.1); // Reaction time jitter
        this.decide(p, arena, st);
      }
      this.applyInput(p, st);
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

  private decide(bot: Player, arena: ArenaState, st: BotState): void {
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

    return {
      type: "flee",
      score: 1000 + maxDanger * 10,
      x: bot.x + (threatDx / m) * 30,
      y: bot.y + (threatDy / m) * 30,
      boost: bot.bladeCount > 2 && maxDanger > 10,
    };
  }

  private scoreChase(bot: Player, arena: ArenaState, st: BotState) {
    let bestScore = -1;
    let targetX = 0, targetY = 0;
    let shouldBoost = false;

    let minBlades = 6;
    let aggroAdvantage = 3;

    if (st.personality === BotPersonality.Aggressive) {
      minBlades = 1;
      aggroAdvantage = -1; // Peut attaquer quelqu'un qui a 1 lame de plus
    } else if (st.personality === BotPersonality.Hunter) {
      minBlades = 2;
      aggroAdvantage = 0; // Attaque à armes égales
    } else if (st.personality === BotPersonality.Farmer) {
      minBlades = 5;
      aggroAdvantage = 2;
    }

    if (bot.bladeCount < minBlades) return null;

    arena.players.forEach((other) => {
      if (other.id === bot.id || !other.alive) return;
      if (other.bladeCount + aggroAdvantage > bot.bladeCount) return;

      const dx = other.x - bot.x;
      const dy = other.y - bot.y;
      const d = Math.hypot(dx, dy);

      if (d > 80) return;

      // Score de base plus élevé pour encourager le combat
      let score = 80 + (bot.bladeCount - other.bladeCount) * 5 - d;

      if (st.personality === BotPersonality.Hunter) {
        score += 20; // Les hunters aiment chasser
      }
      if (st.personality === BotPersonality.Aggressive) {
        score += 40; // Les agressifs foncent dans le tas
      }

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
        const speed = 11;
        const futureX = other.x + (other.inputDx || 0) * speed * (d / speed) * 0.5;
        const futureY = other.y + (other.inputDy || 0) * speed * (d / speed) * 0.5;
        targetX = futureX;
        targetY = futureY;
        shouldBoost = bot.bladeCount > 5 && d > 15 && d < 40 && st.personality !== BotPersonality.Camper;
      }
    });

    if (bestScore <= 0) return null;
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

  private applyInput(bot: Player, st: BotState): void {
    const dx = st.targetX - bot.x;
    const dy = st.targetY - bot.y;
    const d = Math.hypot(dx, dy);
    
    if (d < 0.5) {
      bot.inputDx = 0;
      bot.inputDy = 0;
      return;
    }

    let angle = Math.atan2(dy, dx);
    angle += st.jitterAngle; // Apply jitter

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
      const cos = ax * (dx / d) + ay * (dy / d);
      if (cos < cosThreshold) return;
      foundTarget = true;
    });

    // Caisses : seulement si pas de joueur trouvé. Une lame jetée dans une
    // caisse fait progresser sa destruction (et flatte le score). Les
    // farmers/campers privilégient la caisse.
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
