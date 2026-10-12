import {
  BladeRarity,
  CHIP_CRATE_HP,
  CHIP_CRATE_MAX_MS,
  CHIP_HITBOX,
  CRATE_DROP_SPEED,
  CrateKind,
  DECOR_COLLIDERS,
  DropState,
  GOLDEN_DURATION_MS,
  GOLDEN_RADIUS,
  GOLDEN_WARNING_MS,
  GROUND_BLADE_TTL_MS,
  MAP_EVENT_END_MARGIN_MS,
  MAP_EVENT_INTERVAL_MAX_MS,
  MAP_EVENT_INTERVAL_MIN_MS,
  MAP_EVENT_REACH_MARGIN,
  MapEventKind,
  PROCESSOR_EXPLODE_CHANCE,
  PROCESSOR_REACH,
  PROCESSOR_SPREAD_MS,
  PROCESSOR_WARNING_MS,
  ProcessorImpactEvent,
  RAIN_BLADES,
  RAIN_DURATION_MS,
  RAIN_RADIUS,
  RAIN_RARITY_WEIGHTS,
  RAIN_WARNING_MS,
  RARITY_HP,
  VAULT_CENTER_DIST,
  VAULT_HITBOX,
  VAULT_HP,
  VAULT_MAX_MS,
  VAULT_REACH,
  processorCount,
} from "@bladeio/shared";
import { ArenaState } from "../state/ArenaState";
import { Blade } from "../state/Blade";
import { Crate } from "../state/Crate";
import { MapEventDrop } from "../state/MapEvent";
import { Player } from "../state/Player";
import { randomId } from "../utils/ids";
import type { BotGoal } from "./bots";
import { updateScore } from "./scoring";
import { eventLoot, scatterLoot } from "./crates";
import { LOOT_WALL_MARGIN, areaShare, zoneInner } from "./spawnPoint";

// Bilan d'un évènement fini, pour la télémétrie (table map_events,
// migration 0012, 'processors' depuis la 0014) : combien de joueurs
// étaient là, combien sont venus.
export interface MapEventOutcome {
  kind: "rain" | "crate" | "golden" | "processors";
  durationMs: number;
  humans: number;
  humansReached: number;
  bots: number;
  botsReached: number;
}

const KIND_NAMES: Record<number, MapEventOutcome["kind"]> = {
  [MapEventKind.Rain]: "rain",
  [MapEventKind.Crate]: "crate",
  [MapEventKind.Golden]: "golden",
  [MapEventKind.Processors]: "processors",
};

const EVENT_KINDS: number[] = [MapEventKind.Rain, MapEventKind.Crate, MapEventKind.Golden, MapEventKind.Processors];

// Une pluie tombe vers cette distance du joueur humain le plus proche : à
// portée pendant l'annonce, sans tomber sur personne.
const EVENT_TARGET_DIST = 70;
const EVENT_MIN_DIST = 20;
// Sans humain en vie (room de bots, entracte), on réessaie plus tard.
const RETRY_MS = 10_000;

function insideAnyDecor(x: number, y: number, margin: number): boolean {
  for (let i = 0; i < DECOR_COLLIDERS.length; i++) {
    const d = DECOR_COLLIDERS[i];
    const r = d.radius + margin;
    if ((x - d.x) * (x - d.x) + (y - d.y) * (y - d.y) < r * r) return true;
  }
  return false;
}

function hasHuman(state: ArenaState): boolean {
  let found = false;
  state.players.forEach((p) => {
    if (!p.isBot) found = true;
  });
  return found;
}

function pickRainRarity(): BladeRarity {
  const r = Math.random();
  let acc = 0;
  for (const entry of RAIN_RARITY_WEIGHTS) {
    acc += entry.weight;
    if (r <= acc) return entry.rarity;
  }
  return BladeRarity.Common;
}

// Évènements de carte (tâche 4.4) : un à la fois, toutes les 50 à 70 s,
// dans les modes qui en ont (GameModeInfo.mapEvents). La room appelle
// update() à chaque tick de jeu, après le calcul des scores (la zone dorée
// double ce qui vient d'être gagné), et reset() à chaque nouvelle partie.
export class MapEventSystem {
  private nextAt = 0;
  private lastKind: number = MapEventKind.None;
  private announcedAt = 0;
  private dropped = 0;
  // Zone dorée : score de chaque joueur présent au tick précédent.
  private golden = new Map<string, number>();
  // Télémétrie : présents et venus pendant l'évènement.
  private seenHumans = new Set<string>();
  private seenBots = new Set<string>();
  private reachedHumans = new Set<string>();
  private reachedBots = new Set<string>();

  // Nouvelle partie (arène vidée, coffre et puces compris) : plus
  // d'évènement en cours ; la minuterie repart au tick suivant (s'il y a un
  // humain), pour le délai habituel.
  reset(state: ArenaState): void {
    this.clear(state);
    this.nextAt = 0;
  }

  // phaseEndsAt : fin de la partie d'un mode à échéance, 0 sinon.
  // onImpact : impact d'une puce (chute de processeurs), pour l'effet.
  update(
    state: ArenaState,
    now: number,
    phaseEndsAt: number,
    onEnd: (o: MapEventOutcome) => void,
    onImpact?: (ev: ProcessorImpactEvent) => void,
  ): void {
    const ev = state.mapEvent;
    if (ev.kind === MapEventKind.None) {
      // Sans humain dans la room, ni minuterie ni tirage : une room de bots
      // seuls joue exactement comme avant (bancs). La minuterie part à
      // l'arrivée du premier.
      if (!hasHuman(state)) {
        this.nextAt = 0;
        return;
      }
      if (this.nextAt === 0) this.schedule(now);
      if (now < this.nextAt) return;
      const late = phaseEndsAt > 0 && phaseEndsAt - now < MAP_EVENT_END_MARGIN_MS;
      if (late || !this.start(state, now)) this.nextAt = now + RETRY_MS;
      return;
    }
    this.track(state);
    let over = false;
    if (ev.kind === MapEventKind.Rain) over = this.updateRain(state, now);
    else if (ev.kind === MapEventKind.Crate) over = this.updateVault(state, now);
    else if (ev.kind === MapEventKind.Golden) over = this.updateGolden(state, now);
    else if (ev.kind === MapEventKind.Processors) over = this.updateProcessors(state, now, onImpact);
    if (!over) return;
    onEnd({
      kind: KIND_NAMES[ev.kind],
      durationMs: now - this.announcedAt,
      humans: this.seenHumans.size,
      humansReached: this.reachedHumans.size,
      bots: this.seenBots.size,
      botsReached: this.reachedBots.size,
    });
    this.clear(state);
    this.schedule(now);
  }

  // Triche de test (/event, salon privé) et tests : l'évènement voulu tout
  // de suite, à la place de celui en cours, qui s'arrête sans bilan (son
  // coffre ou ses puces sont retirés). Faux s'il n'a pas pu commencer
  // (aucun humain en vie, pas de place) : la minuterie reprend alors.
  force(state: ArenaState, now: number, kind: number): boolean {
    if (!EVENT_KINDS.includes(kind)) return false;
    const ev = state.mapEvent;
    if (ev.crateId) state.crates.delete(ev.crateId);
    ev.drops.forEach((d) => { if (d.crateId) state.crates.delete(d.crateId); });
    this.clear(state);
    if (this.start(state, now, kind)) return true;
    this.nextAt = 0;
    return false;
  }

  private schedule(now: number): void {
    this.nextAt = now + MAP_EVENT_INTERVAL_MIN_MS + Math.random() * (MAP_EVENT_INTERVAL_MAX_MS - MAP_EVENT_INTERVAL_MIN_MS);
  }

  private clear(state: ArenaState): void {
    const ev = state.mapEvent;
    if (ev.kind !== MapEventKind.None) this.lastKind = ev.kind;
    ev.kind = MapEventKind.None;
    ev.x = 0;
    ev.y = 0;
    ev.radius = 0;
    ev.startsAt = 0;
    ev.endsAt = 0;
    ev.crateId = "";
    if (ev.drops.length > 0) ev.drops.clear();
    this.dropped = 0;
    this.golden.clear();
    this.seenHumans.clear();
    this.seenBots.clear();
    this.reachedHumans.clear();
    this.reachedBots.clear();
  }

  // Un autre que le précédent, au hasard (ou celui demandé) ; faux s'il
  // n'a pas pu commencer (aucun humain en vie, pas de place).
  private start(state: ArenaState, now: number, forced: number = MapEventKind.None): boolean {
    const humans: Player[] = [];
    state.players.forEach((p) => {
      if (p.alive && !p.isBot) humans.push(p);
    });
    if (humans.length === 0) return false;
    let kind = forced;
    if (kind === MapEventKind.None) {
      const kinds = EVENT_KINDS.filter((k) => k !== this.lastKind);
      kind = kinds[Math.floor(Math.random() * kinds.length)];
    }
    const ev = state.mapEvent;
    if (kind === MapEventKind.Golden) {
      ev.x = 0;
      ev.y = 0;
      ev.radius = GOLDEN_RADIUS;
      ev.startsAt = now + GOLDEN_WARNING_MS;
      ev.endsAt = ev.startsAt + GOLDEN_DURATION_MS;
    } else if (kind === MapEventKind.Rain) {
      const spot = this.pickSpot(state, humans, RAIN_RADIUS + 6);
      if (!spot) return false;
      ev.x = spot.x;
      ev.y = spot.y;
      ev.radius = RAIN_RADIUS;
      ev.startsAt = now + RAIN_WARNING_MS;
      ev.endsAt = ev.startsAt + RAIN_DURATION_MS;
    } else if (kind === MapEventKind.Crate) {
      const spot = this.pickVaultSpot(state);
      if (!spot) return false;
      const c = new Crate();
      c.id = randomId();
      c.x = spot.x;
      c.y = spot.y;
      c.hp = VAULT_HP;
      c.maxHp = VAULT_HP;
      c.kind = CrateKind.Vault;
      c.expiresAt = now + VAULT_MAX_MS;
      state.crates.set(c.id, c);
      ev.crateId = c.id;
      ev.x = spot.x;
      ev.y = spot.y;
      ev.radius = 0;
      ev.startsAt = now;
      ev.endsAt = now + VAULT_MAX_MS;
    } else if (kind === MapEventKind.Processors) {
      const spots = this.pickDropSpots(state, processorCount(areaShare(state)));
      if (spots.length === 0) return false;
      const n = spots.length;
      for (let i = 0; i < n; i++) {
        const d = new MapEventDrop();
        d.x = spots[i].x;
        d.y = spots[i].y;
        d.at = now + PROCESSOR_WARNING_MS + (n > 1 ? Math.round((i * PROCESSOR_SPREAD_MS) / (n - 1)) : 0);
        ev.drops.push(d);
      }
      ev.x = 0;
      ev.y = 0;
      ev.radius = 0;
      ev.startsAt = ev.drops[0].at;
      ev.endsAt = ev.drops[n - 1].at;
    } else {
      return false;
    }
    ev.kind = kind;
    this.announcedAt = now;
    return true;
  }

  // Le meilleur de quelques tirages dans l'arène du moment : hors du décor,
  // ni sur un joueur, vers EVENT_TARGET_DIST du joueur humain le plus
  // proche.
  private pickSpot(state: ArenaState, humans: Player[], margin: number): { x: number; y: number } | null {
    const zone = zoneInner(state, margin);
    if (zone <= 0) return null;
    let best: { x: number; y: number } | null = null;
    let bestErr = Infinity;
    for (let i = 0; i < 16; i++) {
      const r = Math.sqrt(Math.random()) * zone;
      const a = Math.random() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (insideAnyDecor(x, y, 3)) continue;
      let blocked = false;
      state.players.forEach((p) => {
        if (p.alive && Math.hypot(p.x - x, p.y - y) < EVENT_MIN_DIST) blocked = true;
      });
      if (blocked) continue;
      let near = Infinity;
      for (const h of humans) near = Math.min(near, Math.hypot(h.x - x, h.y - y));
      const err = Math.abs(near - EVENT_TARGET_DIST);
      if (err < bestErr) {
        bestErr = err;
        best = { x, y };
      }
    }
    return best;
  }

  // Coffre-fort : à VAULT_CENTER_DIST du centre, à côté du pilier central,
  // dans une direction tirée au hasard. Hors de tout collider du décor
  // (son pied aussi, où retombent les lancers), de préférence ni sur un
  // joueur ni sur une caisse ; à défaut, la première direction libre de
  // décor.
  private pickVaultSpot(state: ArenaState): { x: number; y: number } | null {
    if (VAULT_CENTER_DIST + VAULT_HITBOX > zoneInner(state, 0)) return null;
    const a0 = Math.random() * Math.PI * 2;
    let fallback: { x: number; y: number } | null = null;
    for (let i = 0; i < 12; i++) {
      const a = a0 + (i * Math.PI * 2) / 12;
      const x = Math.cos(a) * VAULT_CENTER_DIST;
      const y = Math.sin(a) * VAULT_CENTER_DIST;
      if (insideAnyDecor(x, y, VAULT_HITBOX + 1.5)) continue;
      fallback ??= { x, y };
      let blocked = false;
      state.players.forEach((p) => {
        if (p.alive && Math.hypot(p.x - x, p.y - y) < VAULT_HITBOX + 3) blocked = true;
      });
      state.crates.forEach((c) => { if (Math.hypot(c.x - x, c.y - y) < VAULT_HITBOX + 3) blocked = true; });
      if (!blocked) return { x, y };
    }
    return fallback;
  }

  // Points d'impact d'une chute de processeurs, répartis dans l'arène :
  // chacun, le plus loin des précédents parmi quelques tirages (le premier
  // au hasard). Là où les bots vont aussi (LOOT_WALL_MARGIN), hors du
  // décor, de préférence ni sur un joueur ni sur une caisse.
  private pickDropSpots(state: ArenaState, count: number): Array<{ x: number; y: number }> {
    const zone = zoneInner(state, LOOT_WALL_MARGIN);
    const out: Array<{ x: number; y: number }> = [];
    if (zone <= 0) return out;
    for (let k = 0; k < count; k++) {
      let best: { x: number; y: number } | null = null;
      let bestScore = -Infinity;
      for (let i = 0; i < 20; i++) {
        const r = Math.sqrt(Math.random()) * zone;
        const a = Math.random() * Math.PI * 2;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (insideAnyDecor(x, y, CHIP_HITBOX + 2)) continue;
        let score = Infinity;
        for (const o of out) score = Math.min(score, Math.hypot(o.x - x, o.y - y));
        let crowded = false;
        state.players.forEach((p) => {
          if (p.alive && Math.hypot(p.x - x, p.y - y) < CHIP_HITBOX + 4) crowded = true;
        });
        state.crates.forEach((c) => { if (Math.hypot(c.x - x, c.y - y) < 6) crowded = true; });
        // Encombré : seulement faute de mieux.
        if (crowded) score = (score === Infinity ? 1e6 : score) - 1e7;
        if (score > bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
      if (best) out.push(best);
    }
    return out;
  }

  // Présents, et venus jusqu'à la zone, au coffre ou à une puce : la
  // télémétrie mesure la part des joueurs que l'évènement a attirés.
  private track(state: ArenaState): void {
    const ev = state.mapEvent;
    const crate = ev.kind === MapEventKind.Crate ? state.crates.get(ev.crateId) : undefined;
    const drops = ev.kind === MapEventKind.Processors ? ev.drops : null;
    const reach = crate ? VAULT_REACH : drops ? PROCESSOR_REACH : ev.radius + MAP_EVENT_REACH_MARGIN;
    const cx = crate ? crate.x : ev.x;
    const cy = crate ? crate.y : ev.y;
    const r2 = reach * reach;
    state.players.forEach((p) => {
      if (!p.alive) return;
      (p.isBot ? this.seenBots : this.seenHumans).add(p.id);
      let reached = false;
      if (drops) {
        drops.forEach((d) => {
          if ((p.x - d.x) * (p.x - d.x) + (p.y - d.y) * (p.y - d.y) <= r2) reached = true;
        });
      } else {
        reached = (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy) <= r2;
      }
      if (reached) (p.isBot ? this.reachedBots : this.reachedHumans).add(p.id);
    });
  }

  // Les lames tombent au fil de la phase active, à intervalles réguliers.
  private updateRain(state: ArenaState, now: number): boolean {
    const ev = state.mapEvent;
    if (now < ev.startsAt) return false;
    const due = Math.min(RAIN_BLADES, Math.floor(((now - ev.startsAt) / RAIN_DURATION_MS) * RAIN_BLADES) + 1);
    while (this.dropped < due) {
      this.dropBlade(state, now);
      this.dropped++;
    }
    return now >= ev.endsAt;
  }

  private dropBlade(state: ArenaState, now: number): void {
    const ev = state.mapEvent;
    let x = ev.x;
    let y = ev.y;
    for (let i = 0; i < 5; i++) {
      const r = Math.sqrt(Math.random()) * ev.radius;
      const a = Math.random() * Math.PI * 2;
      x = ev.x + Math.cos(a) * r;
      y = ev.y + Math.sin(a) * r;
      if (!insideAnyDecor(x, y, 1)) break;
    }
    const rarity = pickRainRarity();
    const b = new Blade();
    b.id = randomId();
    b.rarity = rarity;
    b.hp = RARITY_HP[rarity];
    b.x = x;
    b.y = y;
    // Le temps de la voir tomber ; puis elle expire comme le butin.
    b.pickupLockUntil = now + 300;
    b.expiresAt = now + GROUND_BLADE_TTL_MS;
    state.blades.set(b.id, b);
  }

  // Fini à son ouverture (butin : CrateSystem.destroyCrate), ou retiré si
  // personne ne l'a ouvert à temps (CrateSystem l'expire déjà ; ici pour
  // le cas où il n'aurait pas tourné).
  private updateVault(state: ArenaState, now: number): boolean {
    const ev = state.mapEvent;
    if (!state.crates.has(ev.crateId)) return true;
    if (now < ev.endsAt) return false;
    state.crates.delete(ev.crateId);
    return true;
  }

  // Chaque puce à son heure : explosée (lames éparpillées) ou entière au
  // sol (une caisse). Fini quand toutes sont tombées et qu'aucune ne reste
  // entière (cassée ou disparue au bout de CHIP_CRATE_MAX_MS).
  private updateProcessors(state: ArenaState, now: number, onImpact?: (ev: ProcessorImpactEvent) => void): boolean {
    let pending = false;
    state.mapEvent.drops.forEach((d) => {
      if (d.state === DropState.Falling) {
        if (now < d.at) {
          pending = true;
          return;
        }
        this.impact(state, d, now, onImpact);
      }
      if (d.state === DropState.Standing) {
        // Disparue au bout de CHIP_CRATE_MAX_MS : CrateSystem l'expire
        // déjà, ici pour le cas où il n'aurait pas tourné.
        const c = state.crates.get(d.crateId);
        if (c && c.expiresAt > 0 && now >= c.expiresAt) state.crates.delete(d.crateId);
        if (state.crates.has(d.crateId)) pending = true;
        else {
          d.state = DropState.Gone;
          d.crateId = "";
        }
      }
    });
    return !pending;
  }

  private impact(state: ArenaState, d: MapEventDrop, now: number, onImpact?: (ev: ProcessorImpactEvent) => void): void {
    if (Math.random() < PROCESSOR_EXPLODE_CHANCE) {
      d.state = DropState.Exploded;
      // Plus violent que l'ouverture d'une caisse : de ~1,5 à ~6 u.
      scatterLoot(state, d.x, d.y, eventLoot(CrateKind.Chip), 0.4, CRATE_DROP_SPEED * 0.65, CRATE_DROP_SPEED * 1.3, 300);
      onImpact?.({ x: d.x, y: d.y, exploded: true });
      return;
    }
    const c = new Crate();
    c.id = randomId();
    c.x = d.x;
    c.y = d.y;
    c.hp = CHIP_CRATE_HP;
    c.maxHp = CHIP_CRATE_HP;
    c.kind = CrateKind.Chip;
    c.expiresAt = now + CHIP_CRATE_MAX_MS;
    state.crates.set(c.id, c);
    d.state = DropState.Standing;
    d.crateId = c.id;
    onImpact?.({ x: d.x, y: d.y, exploded: false, crateId: c.id });
  }

  // Ce qu'un joueur gagne dans la zone (élimination, lames, caisses,
  // survie…) compte double : à chaque tick, l'écart de score depuis le
  // tick précédent est ajouté une seconde fois. Rien de rétroactif à
  // l'entrée ; une nouvelle vie repart de zéro.
  private updateGolden(state: ArenaState, now: number): boolean {
    const ev = state.mapEvent;
    if (now >= ev.startsAt) {
      const r2 = ev.radius * ev.radius;
      state.players.forEach((p) => {
        const dx = p.x - ev.x;
        const dy = p.y - ev.y;
        if (!p.alive || dx * dx + dy * dy > r2) {
          this.golden.delete(p.id);
          return;
        }
        const last = this.golden.get(p.id);
        if (last !== undefined && p.score > last) {
          p.bonusScore += p.score - last;
          updateScore(p);
        }
        this.golden.set(p.id, p.score);
      });
    }
    return now >= ev.endsAt;
  }

  // Bots : la pluie, le coffre et les puces les attirent comme une récolte
  // proche, la zone dorée ceux qui sont assez armés ; une fois dedans, ils
  // y restent de préférence (score au-dessus de l'errance). Même échelle
  // que les autres actions (cf. BotGoal).
  botGoal(bot: Player, state: ArenaState): BotGoal | null {
    const ev = state.mapEvent;
    if (ev.kind === MapEventKind.Crate) {
      const c = state.crates.get(ev.crateId);
      if (!c) return null;
      const d = Math.hypot(c.x - bot.x, c.y - bot.y);
      return d > 150 ? null : { x: c.x, y: c.y, score: 85 - d * 0.2, boost: false };
    }
    if (ev.kind === MapEventKind.Processors) return this.processorGoal(bot, state);
    if (ev.kind !== MapEventKind.Rain && ev.kind !== MapEventKind.Golden) return null;
    const d = Math.hypot(ev.x - bot.x, ev.y - bot.y);
    if (d > 120) return null;
    if (ev.kind === MapEventKind.Golden) {
      if (bot.bladeCount < 4) return null;
      return { x: ev.x, y: ev.y, score: d < ev.radius * 0.8 ? 30 : 70 - d * 0.2, boost: false };
    }
    // Pluie : jusqu'à la zone ; dedans, la récolte prend le relais.
    if (d < ev.radius * 0.6) return null;
    return { x: ev.x, y: ev.y, score: 95 - d * 0.3, boost: false };
  }

  // Chute de processeurs : la puce la plus proche, encore à tomber (il
  // l'attend sur place) ou entière au sol (il la casse) ; les lames d'une
  // puce explosée, la récolte s'en charge.
  private processorGoal(bot: Player, state: ArenaState): BotGoal | null {
    let best: { x: number; y: number; d: number; falling: boolean } | null = null;
    state.mapEvent.drops.forEach((drop) => {
      let x = drop.x;
      let y = drop.y;
      if (drop.state === DropState.Standing) {
        const c = state.crates.get(drop.crateId);
        if (!c) return;
        x = c.x;
        y = c.y;
      } else if (drop.state !== DropState.Falling) {
        return;
      }
      const d = Math.hypot(x - bot.x, y - bot.y);
      if (!best || d < best.d) best = { x, y, d, falling: drop.state === DropState.Falling };
    });
    const b = best as { x: number; y: number; d: number; falling: boolean } | null;
    if (!b || b.d > 120) return null;
    if (b.falling && b.d < 3) return { x: b.x, y: b.y, score: 30, boost: false };
    return { x: b.x, y: b.y, score: (b.falling ? 90 : 85) - b.d * (b.falling ? 0.3 : 0.2), boost: false };
  }
}
