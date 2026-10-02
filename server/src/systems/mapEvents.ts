import {
  BladeRarity,
  CRATE_MIN_DIST_FROM_PLAYER,
  DECOR_COLLIDERS,
  GOLDEN_DURATION_MS,
  GOLDEN_RADIUS,
  GOLDEN_WARNING_MS,
  GROUND_BLADE_TTL_MS,
  LEGENDARY_CRATE_HP,
  LEGENDARY_CRATE_MAX_MS,
  LEGENDARY_CRATE_REACH,
  MAP_EVENT_END_MARGIN_MS,
  MAP_EVENT_INTERVAL_MAX_MS,
  MAP_EVENT_INTERVAL_MIN_MS,
  MAP_EVENT_REACH_MARGIN,
  MapEventKind,
  RAIN_BLADES,
  RAIN_DURATION_MS,
  RAIN_RADIUS,
  RAIN_RARITY_WEIGHTS,
  RAIN_WARNING_MS,
  RARITY_HP,
} from "@bladeio/shared";
import { ArenaState } from "../state/ArenaState";
import { Blade } from "../state/Blade";
import { Crate } from "../state/Crate";
import { Player } from "../state/Player";
import { randomId } from "../utils/ids";
import type { BotGoal } from "./bots";
import { updateScore } from "./scoring";
import { LOOT_WALL_MARGIN, zoneInner } from "./spawnPoint";

// Bilan d'un évènement fini, pour la télémétrie (table map_events,
// migration 0012) : combien de joueurs étaient là, combien sont venus.
export interface MapEventOutcome {
  kind: "rain" | "crate" | "golden";
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
};

// Une pluie ou une caisse tombe vers cette distance du joueur humain le
// plus proche : à portée pendant l'annonce, sans tomber sur personne.
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

// Évènements de carte (tâche 4.4) : un à la fois, toutes les 90 à 120 s,
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

  // Nouvelle partie (arène vidée, caisse comprise) : plus d'évènement en
  // cours ; la minuterie repart au tick suivant (s'il y a un humain), pour
  // le délai habituel.
  reset(state: ArenaState): void {
    this.clear(state);
    this.nextAt = 0;
  }

  // phaseEndsAt : fin de la partie d'un mode à échéance, 0 sinon.
  update(state: ArenaState, now: number, phaseEndsAt: number, onEnd: (o: MapEventOutcome) => void): void {
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
    else if (ev.kind === MapEventKind.Crate) over = this.updateCrate(state, now);
    else if (ev.kind === MapEventKind.Golden) over = this.updateGolden(state, now);
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
    this.dropped = 0;
    this.golden.clear();
    this.seenHumans.clear();
    this.seenBots.clear();
    this.reachedHumans.clear();
    this.reachedBots.clear();
  }

  // Un autre que le précédent, au hasard ; faux s'il n'a pas pu commencer
  // (aucun humain en vie, pas de place).
  private start(state: ArenaState, now: number): boolean {
    const humans: Player[] = [];
    state.players.forEach((p) => {
      if (p.alive && !p.isBot) humans.push(p);
    });
    if (humans.length === 0) return false;
    const kinds = [MapEventKind.Rain, MapEventKind.Crate, MapEventKind.Golden].filter((k) => k !== this.lastKind);
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    const ev = state.mapEvent;
    if (kind === MapEventKind.Golden) {
      ev.x = 0;
      ev.y = 0;
      ev.radius = GOLDEN_RADIUS;
      ev.startsAt = now + GOLDEN_WARNING_MS;
      ev.endsAt = ev.startsAt + GOLDEN_DURATION_MS;
    } else {
      // Caisse : là où les bots vont aussi (LOOT_WALL_MARGIN).
      const margin = kind === MapEventKind.Rain ? RAIN_RADIUS + 6 : LOOT_WALL_MARGIN;
      const spot = this.pickSpot(state, humans, margin, kind === MapEventKind.Crate);
      if (!spot) return false;
      ev.x = spot.x;
      ev.y = spot.y;
      if (kind === MapEventKind.Rain) {
        ev.radius = RAIN_RADIUS;
        ev.startsAt = now + RAIN_WARNING_MS;
        ev.endsAt = ev.startsAt + RAIN_DURATION_MS;
      } else {
        const c = new Crate();
        c.id = randomId();
        c.x = spot.x;
        c.y = spot.y;
        c.hp = LEGENDARY_CRATE_HP;
        c.maxHp = LEGENDARY_CRATE_HP;
        c.legendary = true;
        state.crates.set(c.id, c);
        ev.crateId = c.id;
        ev.radius = 0;
        ev.startsAt = now;
        ev.endsAt = now + LEGENDARY_CRATE_MAX_MS;
      }
    }
    ev.kind = kind;
    this.announcedAt = now;
    return true;
  }

  // Le meilleur de quelques tirages dans l'arène du moment : hors du décor,
  // ni sur un joueur ni sur une caisse, vers EVENT_TARGET_DIST du joueur
  // humain le plus proche.
  private pickSpot(state: ArenaState, humans: Player[], margin: number, crate: boolean): { x: number; y: number } | null {
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
        if (p.alive && Math.hypot(p.x - x, p.y - y) < (crate ? CRATE_MIN_DIST_FROM_PLAYER : EVENT_MIN_DIST)) blocked = true;
      });
      if (crate) state.crates.forEach((c) => { if (Math.hypot(c.x - x, c.y - y) < 6) blocked = true; });
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

  // Présents, et venus jusqu'à la zone (ou la caisse) : la télémétrie
  // mesure la part des joueurs que l'évènement a attirés.
  private track(state: ArenaState): void {
    const ev = state.mapEvent;
    const crate = ev.kind === MapEventKind.Crate ? state.crates.get(ev.crateId) : undefined;
    const reach = crate ? LEGENDARY_CRATE_REACH : ev.radius + MAP_EVENT_REACH_MARGIN;
    const cx = crate ? crate.x : ev.x;
    const cy = crate ? crate.y : ev.y;
    state.players.forEach((p) => {
      if (!p.alive) return;
      (p.isBot ? this.seenBots : this.seenHumans).add(p.id);
      const dx = p.x - cx;
      const dy = p.y - cy;
      if (dx * dx + dy * dy <= reach * reach) (p.isBot ? this.reachedBots : this.reachedHumans).add(p.id);
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

  // Finie à sa destruction (butin : CrateSystem.destroyCrate), ou retirée
  // si personne ne l'a cassée à temps.
  private updateCrate(state: ArenaState, now: number): boolean {
    const ev = state.mapEvent;
    if (!state.crates.has(ev.crateId)) return true;
    if (now < ev.endsAt) return false;
    state.crates.delete(ev.crateId);
    return true;
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

  // Bots : la pluie et la caisse les attirent comme une récolte proche, la
  // zone dorée ceux qui sont assez armés ; une fois dedans, ils y restent
  // de préférence (score au-dessus de l'errance). Même échelle que les
  // autres actions (cf. BotGoal).
  botGoal(bot: Player, state: ArenaState): BotGoal | null {
    const ev = state.mapEvent;
    if (ev.kind === MapEventKind.Crate) {
      const c = state.crates.get(ev.crateId);
      if (!c) return null;
      const d = Math.hypot(c.x - bot.x, c.y - bot.y);
      return d > 150 ? null : { x: c.x, y: c.y, score: 85 - d * 0.2, boost: false };
    }
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
}
