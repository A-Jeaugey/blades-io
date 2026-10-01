// Défis quotidiens et hebdomadaires (tâche 5.3). Trois défis par jour (un
// facile, un moyen, un difficile) et un par semaine, les mêmes pour tout le
// monde, tirés d'après la date. Remis à zéro à minuit, heure de Paris (la
// semaine, le lundi). Le serveur les fait avancer à chaque fin de vie en
// room publique et crédite la récompense en trophées, donc en XP (5.2).

export type ChallengeMetric =
  | "throws" | "crates" | "kills" | "powerups" | "lives" | "survivalTotal"
  | "biggerKills" | "leaderKills" | "peakBlades" | "lifeSurvival" | "leader";

// Cumul sur la période, ou meilleure vie.
export const METRIC_MODE: Record<ChallengeMetric, "add" | "max"> = {
  throws: "add",
  crates: "add",
  kills: "add",
  powerups: "add",
  lives: "add",
  survivalTotal: "add",
  biggerKills: "add",
  leaderKills: "add",
  peakBlades: "max",
  lifeSurvival: "max",
  leader: "max",
};

export type ChallengeTier = "easy" | "medium" | "hard";

export interface ChallengeDef {
  // Clé de texte : `challenge.<id>`, avec {n} = target.
  id: string;
  metric: ChallengeMetric;
  target: number;
  // Trophées (et donc XP) à la réussite.
  reward: number;
  tier: ChallengeTier;
}

export const DAILY_CHALLENGES: readonly ChallengeDef[] = [
  { id: "throws", metric: "throws", target: 20, reward: 30, tier: "easy" },
  { id: "crates", metric: "crates", target: 5, reward: 30, tier: "easy" },
  { id: "powerups", metric: "powerups", target: 4, reward: 30, tier: "easy" },
  { id: "lives", metric: "lives", target: 5, reward: 25, tier: "easy" },
  { id: "survivalTotal", metric: "survivalTotal", target: 600, reward: 30, tier: "easy" },
  { id: "kills", metric: "kills", target: 3, reward: 40, tier: "medium" },
  { id: "peakBlades", metric: "peakBlades", target: 40, reward: 40, tier: "medium" },
  { id: "lifeSurvival", metric: "lifeSurvival", target: 240, reward: 40, tier: "medium" },
  { id: "biggerKills", metric: "biggerKills", target: 1, reward: 50, tier: "hard" },
  { id: "leaderKills", metric: "leaderKills", target: 1, reward: 60, tier: "hard" },
  { id: "leader", metric: "leader", target: 1, reward: 50, tier: "hard" },
];

export const WEEKLY_CHALLENGES: readonly ChallengeDef[] = [
  { id: "weekKills", metric: "kills", target: 25, reward: 250, tier: "hard" },
  { id: "weekCrates", metric: "crates", target: 40, reward: 200, tier: "hard" },
  { id: "weekThrows", metric: "throws", target: 200, reward: 200, tier: "hard" },
  { id: "weekSurvival", metric: "survivalTotal", target: 3600, reward: 250, tier: "hard" },
  { id: "weekPowerups", metric: "powerups", target: 30, reward: 200, tier: "hard" },
];

const TIMEZONE = "Europe/Paris";

// Date de Paris (année, mois, jour, jour de semaine 1-7 avec lundi = 1).
function parisParts(date: Date): { y: number; m: number; d: number; wd: number; h: number; mi: number; s: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short", hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday")) + 1;
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), wd, h: Number(get("hour")), mi: Number(get("minute")), s: Number(get("second")) };
}

const pad = (n: number) => String(n).padStart(2, "0");

// « 2026-10-01 »
export function parisDayKey(date: Date): string {
  const p = parisParts(date);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

// Semaine ISO (lundi à dimanche) : « 2026-W40 ».
export function parisWeekKey(date: Date): string {
  const p = parisParts(date);
  // Jeudi de la semaine : son année est celle de la semaine ISO.
  const day = Date.UTC(p.y, p.m - 1, p.d);
  const thursday = new Date(day + (4 - p.wd) * 86400000);
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((thursday.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${pad(week)}`;
}

// Prochain changement de clé (minuit de Paris, ou lundi minuit pour la
// semaine). Les jours de changement d'heure durent 23 ou 25 h : on part de
// l'heure de Paris, puis on recale à la minute près.
function nextChange(date: Date, key: (d: Date) => string, days: number): Date {
  const p = parisParts(date);
  const elapsed = ((p.h * 60 + p.mi) * 60 + p.s) * 1000 + date.getUTCMilliseconds();
  let t = date.getTime() - elapsed + days * 86400000;
  const current = key(date);
  // Au plus une heure d'écart (changement d'heure) : on avance ou recule
  // par pas d'une minute jusqu'à la frontière exacte.
  while (key(new Date(t)) === current) t += 60000;
  while (key(new Date(t - 60000)) !== current) t -= 60000;
  return new Date(t);
}

export function nextParisMidnight(date: Date): Date {
  return nextChange(date, parisDayKey, 1);
}

export function nextParisWeek(date: Date): Date {
  const p = parisParts(date);
  return nextChange(date, parisWeekKey, 8 - p.wd);
}

// Tirage déterministe (FNV-1a puis mulberry32) : mêmes défis pour tous.
function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deux défis de survie le même jour feraient doublon.
const familyOf = (c: ChallengeDef): string =>
  c.metric === "survivalTotal" || c.metric === "lifeSurvival" ? "survival" : c.metric;

// Un facile, un moyen, un difficile.
export function dailyChallenges(dayKey: string): ChallengeDef[] {
  const next = rng(`day:${dayKey}`);
  const picked: ChallengeDef[] = [];
  for (const tier of ["easy", "medium", "hard"] as ChallengeTier[]) {
    const used = new Set(picked.map(familyOf));
    const pool = DAILY_CHALLENGES.filter((c) => c.tier === tier && !used.has(familyOf(c)));
    picked.push(pool[Math.floor(next() * pool.length)]);
  }
  return picked;
}

export function weeklyChallenge(weekKey: string): ChallengeDef {
  const next = rng(`week:${weekKey}`);
  return WEEKLY_CHALLENGES[Math.floor(next() * WEEKLY_CHALLENGES.length)];
}

// Ce qu'une vie apporte à chaque métrique.
export interface LifeChallengeStats {
  throws: number;
  crates: number;
  kills: number;
  powerups: number;
  survivalSeconds: number;
  // Éliminations d'un joueur qui avait plus de lames au début de l'échange.
  biggerKills: number;
  // Éliminations du leader (prime versée).
  leaderKills: number;
  peakBlades: number;
  // A porté la couronne pendant la vie.
  wasLeader: boolean;
}

export function lifeValue(metric: ChallengeMetric, life: LifeChallengeStats): number {
  switch (metric) {
    case "throws": return life.throws;
    case "crates": return life.crates;
    case "kills": return life.kills;
    case "powerups": return life.powerups;
    case "lives": return 1;
    case "survivalTotal": return Math.floor(life.survivalSeconds);
    case "biggerKills": return life.biggerKills;
    case "leaderKills": return life.leaderKills;
    case "peakBlades": return life.peakBlades;
    case "lifeSurvival": return Math.floor(life.survivalSeconds);
    case "leader": return life.wasLeader ? 1 : 0;
  }
}

// État d'un défi pour un joueur (GET /api/challenges).
export interface ChallengeState extends ChallengeDef {
  progress: number;
  completed: boolean;
}

// Serveur → joueur : défis réussis par la vie qui vient de finir.
export interface ChallengeDoneEvent {
  challenges: Array<{ challenge: string; reward: number }>;
}

export interface ChallengesResponse {
  day: { key: string; resetsAt: string; challenges: ChallengeState[] };
  week: { key: string; resetsAt: string; challenge: ChallengeState };
}
