import { PROFILE_RECENT_GAMES, ProfileGame, ProfileStats, countsAsGame } from "@bladeio/shared";
import { getBest } from "./personalBest";

// Statistiques locales (tâche 5.1) : les cumuls du profil d'un compte,
// gardés dans ce navigateur pour les invités. Rooms publiques seulement,
// comme le record personnel. Les vies jouées connecté y entrent aussi : le
// profil s'en sert si le serveur ne répond pas.

const KEY = "blade.stats";

export interface LifeRecord {
  score: number;
  kills: number;
  maxBlades: number;
  survivalSeconds: number;
  crates: number;
  powerups: number;
}

interface Stored {
  games: number;
  kills: number;
  bestScore: number;
  bestKills: number;
  bestBlades: number;
  survivalSeconds: number;
  bestSurvivalSeconds: number;
  crates: number;
  powerups: number;
  firstPlayedAt: string | null;
  recent: ProfileGame[];
}

const COUNTERS = [
  "games", "kills", "bestScore", "bestKills", "bestBlades",
  "survivalSeconds", "bestSurvivalSeconds", "crates", "powerups",
] as const;

function empty(): Stored {
  return {
    games: 0, kills: 0, bestScore: 0, bestKills: 0, bestBlades: 0,
    survivalSeconds: 0, bestSurvivalSeconds: 0, crates: 0, powerups: 0,
    firstPlayedAt: null, recent: [],
  };
}

const whole = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

// Stockage indisponible ou plein (navigation privée, données bloquées) :
// les statistiques valent pour la session.
let cached: Stored | null = null;
let writable = true;

function parse(raw: any): Stored {
  const s = empty();
  if (!raw || typeof raw !== "object") return s;
  for (const k of COUNTERS) s[k] = whole(raw[k]);
  s.firstPlayedAt = typeof raw.firstPlayedAt === "string" ? raw.firstPlayedAt : null;
  if (Array.isArray(raw.recent)) {
    s.recent = raw.recent
      .filter((g: any) => g && typeof g.at === "string")
      .slice(0, PROFILE_RECENT_GAMES)
      .map((g: any) => ({
        score: whole(g.score), kills: whole(g.kills), maxBlades: whole(g.maxBlades),
        survivalSeconds: whole(g.survivalSeconds), at: g.at,
      }));
  }
  return s;
}

// Relu à chaque accès : un autre onglet a pu jouer entre-temps (sinon la
// dernière écriture effaçait ses parties). Le cache ne sert que si le
// stockage ne répond pas.
function load(): Stored {
  if (!writable && cached) return cached;
  try {
    cached = parse(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    if (!cached) cached = empty();
  }
  return cached;
}

// Fin d'une vie en room publique.
export function recordLocalLife(life: LifeRecord, now: Date = new Date()): void {
  if (!countsAsGame(life.score, life.kills, life.maxBlades)) return;
  const s = load();
  const score = whole(life.score);
  const kills = whole(life.kills);
  const maxBlades = whole(life.maxBlades);
  const survival = whole(life.survivalSeconds);
  const at = now.toISOString();
  s.games++;
  s.kills += kills;
  s.bestScore = Math.max(s.bestScore, score);
  s.bestKills = Math.max(s.bestKills, kills);
  s.bestBlades = Math.max(s.bestBlades, maxBlades);
  s.survivalSeconds += survival;
  s.bestSurvivalSeconds = Math.max(s.bestSurvivalSeconds, survival);
  s.crates += whole(life.crates);
  s.powerups += whole(life.powerups);
  if (!s.firstPlayedAt) s.firstPlayedAt = at;
  s.recent.unshift({ score, kills, maxBlades, survivalSeconds: survival, at });
  s.recent.length = Math.min(s.recent.length, PROFILE_RECENT_GAMES);
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    writable = false;
  }
}

export function getLocalStats(): ProfileStats {
  const s = load();
  return {
    games: s.games,
    kills: s.kills,
    // Le record personnel (tâche 3.4) précède ces statistiques : il compte
    // les vies d'avant.
    bestScore: Math.max(s.bestScore, getBest()),
    bestKills: s.bestKills,
    bestBlades: s.bestBlades,
    avgSurvivalSeconds: s.games > 0 ? Math.round(s.survivalSeconds / s.games) : 0,
    bestSurvivalSeconds: s.bestSurvivalSeconds,
    crates: s.crates,
    powerups: s.powerups,
    firstPlayedAt: s.firstPlayedAt,
    rank: null,
    // Solde invité, lu à part (cf. ProfilePanel).
    xp: null,
    recent: s.recent.slice(),
  };
}
