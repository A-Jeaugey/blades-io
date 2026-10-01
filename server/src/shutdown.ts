// Arrêt en douceur (tâche T.3). Avant, un déploiement (pm2 restart) coupait
// toutes les parties sans prévenir, et les trophées de fin de vie, écrits
// sans attendre la réponse de Supabase, pouvaient se perdre à la sortie du
// processus.
//
// Sur SIGTERM ou SIGINT, Colyseus appelle onBeforeShutdown (attendu) avant
// de fermer les rooms : on y annonce le redémarrage aux joueurs, on refuse
// les nouvelles entrées, et on attend la fin du préavis, ou moins s'il n'y a
// plus aucun joueur humain. À la fermeture des rooms, chaque joueur encore
// en vie voit sa partie enregistrée (onLeave) ; onShutdown attend ces
// écritures avant de laisser le processus se terminer.

// Préavis donné aux joueurs. En production, ecosystem.config.js le fixe à
// 60 s (et laisse au processus plus que ce délai avant de le tuer :
// kill_timeout). Aucun par défaut : en développement, ts-node-dev relance le
// serveur à chaque modification et attendrait sinon le départ des joueurs.
export function restartNoticeMs(): number {
  const ms = Number(process.env.RESTART_NOTICE_MS ?? 0);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}
// Délai maximal accordé aux écritures en attente (Supabase) à la sortie.
const FLUSH_TIMEOUT_MS = 8_000;

export interface RestartAware {
  // Annonce l'heure (Date.now() du serveur) de l'arrêt.
  announceRestart(at: number): void;
  // Joueurs humains connectés.
  humanCount(): number;
}

const rooms = new Set<RestartAware>();
const pendingWrites = new Set<Promise<unknown>>();
let restartAt = 0;

export function registerRoom(room: RestartAware): void {
  rooms.add(room);
  if (restartAt) room.announceRestart(restartAt);
}

export function unregisterRoom(room: RestartAware): void {
  rooms.delete(room);
}

// Heure annoncée de l'arrêt, 0 s'il n'est pas en cours.
export function restartDeadline(): number {
  return restartAt;
}

// Écriture asynchrone (match, trophées) à laisser finir avant de quitter.
export function trackWrite(write: Promise<unknown>): void {
  pendingWrites.add(write);
  // Les deux branches : une écriture en échec ne doit pas laisser de rejet
  // non géré, qui ferait tomber le processus (finally() le propagerait).
  const done = () => pendingWrites.delete(write);
  write.then(done, done);
}

function humans(): number {
  let n = 0;
  for (const room of rooms) n += room.humanCount();
  return n;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function beforeShutdown(): Promise<void> {
  const notice = restartNoticeMs();
  restartAt = Date.now() + notice;
  console.log(`[blade.io] shutdown requested: ${humans()} player(s), closing in ${Math.round(notice / 1000)} s at most`);
  for (const room of rooms) room.announceRestart(restartAt);
  while (Date.now() < restartAt && humans() > 0) await sleep(500);
}

export async function afterShutdown(): Promise<void> {
  if (pendingWrites.size === 0) return;
  console.log(`[blade.io] waiting for ${pendingWrites.size} pending write(s)`);
  await Promise.race([Promise.allSettled([...pendingWrites]), sleep(FLUSH_TIMEOUT_MS)]);
}
