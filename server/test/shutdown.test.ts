// Arrêt en douceur (tâche T.3) : annonce aux rooms, refus des nouvelles
// entrées, attente des joueurs, puis des écritures en attente.
//
// Les tests partagent l'état du module (un seul arrêt par processus ; node
// --test isole chaque fichier) : ils s'enchaînent dans l'ordre, l'annonce
// du redémarrage en dernier.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RestartAware, afterShutdown, beforeShutdown, registerRoom, restartDeadline, restartNoticeMs, trackWrite } from "../src/shutdown";
import { FakeClock } from "./helpers";
import { TestRoom } from "./testRoom";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("afterShutdown attend les écritures en cours, y compris celles qui échouent", async () => {
  let done = 0;
  trackWrite(sleep(60).then(() => { done++; }));
  // Un rejet ne doit ni faire tomber le processus (rejet non géré) ni
  // interrompre l'attente des autres écritures.
  trackWrite(sleep(30).then(() => { done++; throw new Error("supabase indisponible"); }));
  await afterShutdown();
  assert.equal(done, 2);
});

test("hors redémarrage, les entrées sont acceptées", async () => {
  const clock = new FakeClock();
  clock.restore();
  const r = new TestRoom(clock);
  assert.equal(restartDeadline(), 0);
  const auth = await r.room.onAuth({}, { name: "alice" });
  assert.equal(auth.name, "alice");
});

test("beforeShutdown prévient les rooms, refuse les entrées et rend la main quand les joueurs sont partis", async () => {
  // Horloge réelle : beforeShutdown attend en temps réel.
  const clock = new FakeClock();
  clock.restore();
  const r = new TestRoom(clock);
  let humans = 1;
  const announced: number[] = [];
  const other: RestartAware = { announceRestart: (at) => announced.push(at), humanCount: () => humans };
  registerRoom(other);

  // Préavis de production (ecosystem.config.js).
  process.env.RESTART_NOTICE_MS = "60000";
  assert.equal(restartNoticeMs(), 60_000);
  const t0 = Date.now();
  const shutdown = beforeShutdown();
  // L'annonce part tout de suite, avant la première attente.
  const at = restartDeadline();
  assert.ok(at >= t0 + 60_000 && at <= Date.now() + 60_000);
  assert.deepEqual(announced, [at]);
  assert.deepEqual(r.events.filter((e) => e.type === "restart").map((e) => e.message), [{ at }]);
  assert.equal(r.room.locked, true);

  // Plus personne n'entre, ni dans une room existante, ni dans une room
  // créée pendant le préavis (prévenue dès sa création).
  await assert.rejects(r.room.onAuth({}, { name: "bob" }), (e: any) => e.code === 503 && e.message === "server_restarting");
  const late = new TestRoom(clock);
  assert.deepEqual(late.events.filter((e) => e.type === "restart").map((e) => e.message), [{ at }]);

  // Tant qu'un joueur est là, on attend ; dès qu'il part, on ferme sans
  // attendre la fin du préavis.
  let finished = false;
  void shutdown.then(() => { finished = true; });
  await sleep(700);
  assert.equal(finished, false);
  humans = 0;
  await shutdown;
  assert.ok(Date.now() - t0 < 3000);
});
