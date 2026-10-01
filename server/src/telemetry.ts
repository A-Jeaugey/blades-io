// Télémétrie de gameplay (tâche 4.8) : une ligne par fin de vie d'un joueur
// humain dans la table Supabase life_stats
// (supabase/migrations/0005_life_stats.sql), pour équilibrer sur des
// chiffres : durée des premières vies, causes de mort, poids du boost, des
// lancers… Rien d'identifiant pour les invités ; l'id de compte pour les
// joueurs connectés. Sans Supabase, rien n'est écrit.
import type { GameModeId, KillCause } from "@bladeio/shared";
import { getAdminClient } from "./auth/supabase";
import { trackWrite } from "./shutdown";

// Fin de vie : mort (lames en orbite, lancer, bordure), départ en vie
// (retour au menu), connexion perdue sans retour, redémarrage du serveur,
// fin de la partie d'un mode qui en a une (tâche 7.3, migration 0011).
export type LifeEnd = KillCause | "quit" | "disconnect" | "restart" | "match_end";

export interface LifeRecord {
  roomPrivate: boolean;
  gameMode: GameModeId;
  userId: string | null;
  lifeIndex: number;
  newcomer: boolean;
  durationMs: number;
  cause: LifeEnd;
  killerKind: "player" | "bot" | null;
  killerTier: number | null;
  // Rapport de force au début de l'échange (cf. bladesBeforeFight).
  killerBlades: number | null;
  victimBlades: number;
  maxBlades: number;
  maxTier: number;
  score: number;
  kills: number;
  throws: number;
  throwHits: number;
  boostMs: number;
  // Période de grâce ou sa rampe encore active (tâche 3.2).
  inGrace: boolean;
  humans: number;
  bots: number;
  // Contre-mesures au snowball (tâche 4.2) : la vie finit en leader, temps
  // passé leader, prime versée à son tueur, tueur au moins deux fois plus
  // petit.
  wasLeader: boolean;
  leaderMs: number;
  bounty: number;
  underdog: boolean;
}

// L'écriture part en arrière-plan, suivie pour être attendue à l'arrêt du
// serveur ; la boucle de jeu ne l'attend jamais.
export function recordLife(rec: LifeRecord): void {
  trackWrite(insertLife(rec));
}

async function insertLife(rec: LifeRecord): Promise<void> {
  const admin = getAdminClient();
  if (!admin) return;
  try {
    const { error } = await admin.from("life_stats").insert({
      room_private: rec.roomPrivate,
      // Colonne de la migration 0011, 'ffa' par défaut : écrite pour les
      // autres modes seulement, l'arène s'enregistre aussi sans la migration.
      ...(rec.gameMode !== "ffa" ? { game_mode: rec.gameMode } : {}),
      user_id: rec.userId,
      life_index: small(rec.lifeIndex),
      newcomer: rec.newcomer,
      duration_ms: Math.max(0, Math.round(rec.durationMs)),
      cause: rec.cause,
      killer_kind: rec.killerKind,
      killer_tier: rec.killerTier,
      killer_blades: rec.killerBlades === null ? null : small(rec.killerBlades),
      victim_blades: small(rec.victimBlades),
      max_blades: small(rec.maxBlades),
      max_tier: small(rec.maxTier),
      score: Math.max(0, Math.round(rec.score)),
      kills: small(rec.kills),
      throws: small(rec.throws),
      throw_hits: small(rec.throwHits),
      boost_ms: Math.max(0, Math.round(rec.boostMs)),
      in_grace: rec.inGrace,
      humans: small(rec.humans),
      bots: small(rec.bots),
      was_leader: rec.wasLeader,
      leader_ms: Math.max(0, Math.round(rec.leaderMs)),
      bounty: small(rec.bounty),
      underdog: rec.underdog,
    });
    if (error) warn(error.message);
  } catch (e) {
    warn((e as Error).message);
  }
}

// Colonnes smallint.
function small(n: number): number {
  return Math.max(0, Math.min(32767, Math.round(n)));
}

// Un avertissement par minute au plus : si la migration n'est pas appliquée,
// chaque mort échouerait.
let lastWarnAt = 0;
function warn(message: string): void {
  const now = Date.now();
  if (now - lastWarnAt < 60_000) return;
  lastWarnAt = now;
  console.warn("[blade.io] life_stats insert failed:", message);
}
