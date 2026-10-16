// Synchronisation entre clients : chaque écran montre les joueurs à
// l'instant du joueur local (InputTickClock, RemoteMotion), et une coupure
// réseau ne laisse plus de retard derrière elle (file d'inputs en retard).
// Clients simulés derrière quelques ticks de latence, comme dans
// prediction.test.ts.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  CENTRAL_PILLAR,
  INPUT_BACKLOG_KEEP,
  INPUT_BACKLOG_WINDOW_TICKS,
  InputTickClock,
  MAX_STEP_CREDIT,
  MoveInput,
  PLAYER_BODY_RADIUS,
  PLAYER_SPEED,
  REMOTE_EXTRAPOLATION_MAX_TICKS,
  RemoteMotion,
  SERVER_DT,
  VELOCITY_SYNC_SCALE,
} from "@bladeio/shared";
import { DT, FakeClock, seedRandom } from "./helpers";
import { TestRoom } from "./testRoom";

let clock: FakeClock;
let restoreRandom: () => void;

beforeEach(() => {
  clock = new FakeClock();
  restoreRandom = seedRandom(11);
});
afterEach(() => {
  clock.restore();
  restoreRandom();
});

const client = (id: string) => ({ sessionId: id, leave: () => {} });

interface Remote {
  tick: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

// Deux humains, chacun derrière `up` ticks de latence montante et `down`
// descendante. L'observateur (p1) dessine p2 à l'instant de son propre
// dernier input ; on compare à la position de p2 sur le serveur à ce tick.
function observe(
  ticks: number,
  input2: (tick: number) => MoveInput,
  up = 3,
  down = 3,
): { errors: number[]; shownTicks: number[] } {
  const r = new TestRoom(clock);
  const p1 = r.join("p1");
  const p2 = r.join("p2");
  p1.x = -40; p1.y = 30;
  p2.x = -40; p2.y = 50;
  const ticker = new InputTickClock();
  const motion = new RemoteMotion(p2.x, p2.y);
  const uplink: Array<{ at: number; id: string; msg: object }> = [];
  const downlink: Array<{ at: number; tick: number; ack: number; remote: Remote }> = [];
  const truth = new Map<number, { x: number; y: number }>();
  const shown: Array<{ tick: number; x: number; y: number }> = [];
  let seq = 0;
  for (let t = 0; t < ticks; t++) {
    seq++;
    uplink.push({ at: t + up, id: "p1", msg: { dx: 0, dy: 0, boost: false, seq } });
    uplink.push({ at: t + up, id: "p2", msg: { ...input2(t), seq } });
    while (uplink.length && uplink[0].at <= t) {
      const u = uplink.shift()!;
      r.room.handleInput(client(u.id), u.msg);
    }
    r.tick();
    truth.set(r.state.tick, { x: p2.x, y: p2.y });
    downlink.push({
      at: t + down,
      tick: r.state.tick,
      ack: p1.lastSeq,
      remote: { tick: r.state.tick, x: Math.fround(p2.x), y: Math.fround(p2.y), vx: p2.velX / VELOCITY_SYNC_SCALE, vy: p2.velY / VELOCITY_SYNC_SCALE },
    });
    while (downlink.length && downlink[0].at <= t) {
      const d = downlink.shift()!;
      ticker.onAck(d.ack, d.tick);
      motion.push(d.remote.tick, d.remote.x, d.remote.y, d.remote.vx, d.remote.vy);
    }
    if (!ticker.isReady) continue;
    const at = ticker.tickOf(seq);
    motion.update(at, DT);
    shown.push({ tick: at, x: motion.renderX, y: motion.renderY });
  }
  const errors: number[] = [];
  const shownTicks: number[] = [];
  for (const s of shown) {
    const real = truth.get(Math.round(s.tick));
    if (!real) continue;
    errors.push(Math.hypot(s.x - real.x, s.y - real.y));
    shownTicks.push(s.tick);
  }
  return { errors, shownTicks };
}

test("horloge des inputs : l'input n s'applique au tick n + écart mesuré", () => {
  const r = new TestRoom(clock);
  const p = r.join("p1");
  const ticker = new InputTickClock();
  const up = 4;
  const down = 3;
  const uplink: Array<{ at: number; seq: number }> = [];
  const downlink: Array<{ at: number; tick: number; ack: number }> = [];
  const appliedAt = new Map<number, number>();
  const predicted = new Map<number, number>();
  let last = 0;
  for (let t = 0; t < 240; t++) {
    uplink.push({ at: t + up, seq: t + 1 });
    while (uplink.length && uplink[0].at <= t) r.room.handleInput(client("p1"), { dx: 1, dy: 0, boost: false, seq: uplink.shift()!.seq });
    r.tick();
    if (p.lastSeq !== last) {
      for (let s = last + 1; s <= p.lastSeq; s++) appliedAt.set(s, r.state.tick);
      last = p.lastSeq;
    }
    downlink.push({ at: t + down, tick: r.state.tick, ack: p.lastSeq });
    while (downlink.length && downlink[0].at <= t) {
      const d = downlink.shift()!;
      ticker.onAck(d.ack, d.tick);
    }
    if (ticker.isReady && t > 60) predicted.set(t + 1, ticker.tickOf(t + 1));
  }
  let checked = 0;
  for (const [s, at] of predicted) {
    const real = appliedAt.get(s);
    if (real === undefined) continue;
    assert.ok(Math.abs(at - real) < 1e-6, `input ${s} : prévu au tick ${at}, appliqué au ${real}`);
    checked++;
  }
  assert.ok(checked > 100, `${checked} inputs vérifiés`);
});

test("joueur distant : à l'instant du joueur local, collé au serveur en ligne droite", () => {
  // Sans boost : à court de lames, le boost s'arrête, et ce changement de
  // vitesse est un virage comme un autre.
  const { errors } = observe(240, () => ({ dx: 1, dy: 0, boost: false }));
  const settled = errors.slice(30);
  assert.ok(settled.length > 150);
  const worst = Math.max(...settled);
  assert.ok(worst < 0.01, `écart max ${worst.toFixed(4)} u en ligne droite`);
});

test("joueur distant : un virage se corrige sans saut, puis l'écart retombe à zéro", () => {
  const turnAt = 120;
  const { errors, shownTicks } = observe(320, (t) => (t < turnAt ? { dx: 1, dy: 0, boost: false } : { dx: 0, dy: 1, boost: false }));
  // Au pire, l'extrapolation a continué tout droit le temps d'un
  // aller-retour (6 ticks ici, plus un patch) : à angle droit, un écart de
  // vitesse de √2 fois la marche, sur 7 ticks.
  const worst = Math.max(...errors);
  assert.ok(worst <= PLAYER_SPEED * Math.SQRT2 * 7 * SERVER_DT + 1e-6, `écart max ${worst.toFixed(3)} u au virage`);
  const late = errors.filter((_, i) => shownTicks[i] > turnAt + 60);
  assert.ok(late.length > 50 && Math.max(...late) < 0.01, "recalé après le virage");
});

test("joueur distant : extrapolation bornée, téléportation sans lissage", () => {
  const m = new RemoteMotion(0, 0);
  m.push(100, 0, 0, 10, 0);
  m.update(100 + 1000, DT);
  assert.ok(Math.abs(m.renderX - 10 * REMOTE_EXTRAPOLATION_MAX_TICKS * SERVER_DT) < 1e-9, `borné : ${m.renderX}`);
  // Réapparition à l'autre bout de la carte : pas d'écart à absorber.
  m.push(1101, 120, -80, 0, 0);
  m.update(1101, DT);
  assert.equal(m.renderX, 120);
  assert.equal(m.renderY, -80);
});

test("joueur distant : jamais dessiné dans le pilier qu'il longe", () => {
  const m = new RemoteMotion(-3, 0);
  m.push(10, -(CENTRAL_PILLAR.radius + PLAYER_BODY_RADIUS + 0.2), 0, 11, 0);
  m.update(10 + REMOTE_EXTRAPOLATION_MAX_TICKS, DT);
  const d = Math.hypot(m.renderX - CENTRAL_PILLAR.x, m.renderY - CENTRAL_PILLAR.y);
  assert.ok(d >= CENTRAL_PILLAR.radius + PLAYER_BODY_RADIUS - 1e-6, `à ${d.toFixed(3)} u du centre du pilier`);
});

test("vitesse envoyée : déplacement réel du pas, nulle quand les inputs s'arrêtent", () => {
  const r = new TestRoom(clock);
  const p = r.join("p1");
  // Contre le pilier : il pousse, il n'avance pas.
  p.x = -(CENTRAL_PILLAR.radius + PLAYER_BODY_RADIUS); p.y = 0;
  let seq = 0;
  for (let i = 0; i < 10; i++) {
    r.room.handleInput(client("p1"), { dx: 1, dy: 0, boost: false, seq: ++seq });
    r.tick();
  }
  assert.ok(Math.abs(p.moveVx) < 0.05, `contre le pilier : ${p.moveVx}`);
  // En terrain libre, puis plus aucun input (coupure).
  p.x = -40; p.y = 30;
  for (let i = 0; i < 10; i++) {
    r.room.handleInput(client("p1"), { dx: 1, dy: 0, boost: false, seq: ++seq });
    r.tick();
  }
  assert.ok(Math.abs(p.moveVx - PLAYER_SPEED) < 1e-6, `en terrain libre : ${p.moveVx}`);
  assert.equal(p.velX, PLAYER_SPEED * VELOCITY_SYNC_SCALE, "envoyée en entier");
  r.tick(4);
  assert.equal(p.moveVx, 0, "coupure : les autres ne l'extrapolent plus");
  assert.equal(p.velX, 0);
});

// Coupure réseau : TCP retient le flux jusqu'à la retransmission, puis livre
// tout d'un coup. Le crédit absorbe MAX_STEP_CREDIT pas ; le reste ne doit
// pas rester en file pour toujours.
test("file en retard : après une coupure, le retard ne reste pas", () => {
  const r = new TestRoom(clock);
  const p = r.join("p1");
  p.x = -40; p.y = 30;
  let seq = 0;
  const send = () => r.room.handleInput(client("p1"), { dx: 1, dy: 0, boost: false, seq: ++seq });
  for (let i = 0; i < 30; i++) { send(); r.tick(); }
  // 300 ms sans rien reçu, puis les 18 inputs d'un bloc.
  const stall = 18;
  for (let i = 0; i < stall; i++) r.tick();
  for (let i = 0; i < stall; i++) send();
  send();
  r.tick();
  assert.equal(p.inputQueue.length, stall + 1 - MAX_STEP_CREDIT, "surplus en file après la coupure");
  for (let i = 0; i < INPUT_BACKLOG_WINDOW_TICKS * 2; i++) { send(); r.tick(); }
  assert.ok(p.inputQueue.length <= INPUT_BACKLOG_KEEP, `file : ${p.inputQueue.length}`);
  // Acquittés jusqu'au dernier appliqué ou abandonné : rien à rejouer pour
  // le client au-delà de ce qui reste en file.
  assert.equal(p.lastSeq, seq - p.inputQueue.length);
});

test("file en retard : la gigue ordinaire ne perd aucun input", () => {
  const r = new TestRoom(clock);
  const p = r.join("p1");
  p.x = -60; p.y = 30;
  const x0 = p.x;
  // Un input par tick, livré avec 2 à 6 ticks de retard, dans l'ordre (TCP).
  const sent = 240;
  const arrivals: number[] = [];
  let prev = 0;
  for (let k = 0; k < sent; k++) {
    prev = Math.max(prev, k + 2 + Math.floor(Math.random() * 5));
    arrivals.push(prev);
  }
  let next = 0;
  for (let t = 0; t < sent + 20; t++) {
    while (next < sent && arrivals[next] <= t) {
      next++;
      r.room.handleInput(client("p1"), { dx: 1, dy: 0, boost: false, seq: next });
    }
    r.tick();
  }
  const applied = (p.x - x0) / (PLAYER_SPEED * SERVER_DT);
  assert.ok(Math.abs(applied - sent) < 1e-6, `${applied.toFixed(3)} pas appliqués pour ${sent} inputs`);
});

