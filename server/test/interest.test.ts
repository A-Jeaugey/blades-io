// Zone d'intérêt et buissons côté serveur (tâche 2.4). On décode ce que le
// serveur envoie réellement à un client, comme le ferait un client modifié.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { Decoder } from "@colyseus/schema";
import { BUSHES, VIEW_RADIUS_MAX, VIEW_RADIUS_MIN } from "@bladeio/shared";
import { ArenaState } from "../src/state/ArenaState";
import { Player } from "../src/state/Player";
import { InterestManager } from "../src/systems/interest";
import { FakeClock, addGroundBlade, addPlayer, giveBlade, seedRandom } from "./helpers";
import { TestRoom } from "./testRoom";

let clock: FakeClock;
let restoreRandom: () => void;

beforeEach(() => {
  clock = new FakeClock();
  restoreRandom = seedRandom(5);
});
afterEach(() => {
  clock.restore();
  restoreRandom();
});

// État complet tel que le reçoit ce client (vue filtrée), décodé.
function received(r: TestRoom, sessionId: string): ArenaState {
  const client = { sessionId, view: (r.room as any).interest.viewers.get(sessionId).view };
  const bytes: Buffer = r.room._serializer.getFullState(client);
  const state = new ArenaState();
  new Decoder(state).decode(bytes, { offset: 1 });
  return state;
}

function place(p: Player, x: number, y: number): void {
  p.x = x;
  p.y = y;
}

test("zone d'intérêt : un client ne reçoit que les joueurs proches et leurs lames", () => {
  const r = new TestRoom(clock);
  const me = r.join("me");
  const near = r.join("near");
  const far = r.join("far");
  place(me, 0, -100);
  place(near, 40, -100);
  place(far, 0, 100);
  const ground = addGroundBlade(r.state, { x: 20, y: -90 });
  const farGround = addGroundBlade(r.state, { x: 0, y: 110 });
  r.tick(2); // vues recalculées un tick sur deux
  const st = received(r, "me");
  assert.deepEqual([...st.players.keys()].sort(), ["me", "near"]);
  const owners = new Set<string>();
  st.blades.forEach((b) => owners.add(b.ownerId));
  assert.ok(owners.has("me") && owners.has("near") && !owners.has("far"));
  assert.ok(st.blades.has(ground.id));
  assert.ok(!st.blades.has(farGround.id));
  // L'autre s'éloigne : il quitte la vue au tick suivant, ses lames aussi.
  place(near, 60, 100);
  r.tick(2); // vues recalculées un tick sur deux
  const after = received(r, "me");
  assert.deepEqual([...after.players.keys()], ["me"]);
  after.blades.forEach((b) => assert.notEqual(b.ownerId, "near"));
});

test("buissons : un joueur caché n'est pas envoyé, sauf quand les orbites peuvent se toucher", () => {
  const r = new TestRoom(clock);
  const me = r.join("me");
  const hidden = r.join("hidden");
  const bush = BUSHES[0];
  place(hidden, bush.x, bush.y);
  place(me, bush.x, bush.y + 25);
  r.tick(2); // vues recalculées un tick sur deux
  assert.ok(!received(r, "me").players.has("hidden"), "le joueur caché a été envoyé");
  // Le caché, lui, voit l'observateur (il n'est pas dans un buisson).
  assert.ok(received(r, "hidden").players.has("me"));
  // À portée de contact des orbites : visible, pour ne pas se battre
  // contre des lames invisibles.
  place(me, bush.x, bush.y + 6);
  r.tick(2); // vues recalculées un tick sur deux
  assert.ok(received(r, "me").players.has("hidden"));
  // Sorti du buisson : visible de loin.
  place(me, bush.x, bush.y + 25);
  place(hidden, bush.x + bush.radius + 3, bush.y);
  r.tick(2); // vues recalculées un tick sur deux
  assert.ok(received(r, "me").players.has("hidden"));
});

test("zone d'intérêt : rayon annoncé par le client, borné", () => {
  const r = new TestRoom(clock);
  const me = r.join("me");
  const other = r.join("other");
  place(me, 0, -120);
  place(other, 0, 10);
  const interest = (r.room as any).interest as InterestManager;
  interest.setRadius("me", VIEW_RADIUS_MIN);
  r.tick(2); // vues recalculées un tick sur deux
  assert.ok(!received(r, "me").players.has("other"));
  // Un client modifié ne peut pas demander plus que le maximum.
  interest.setRadius("me", 1e6);
  r.tick(2); // vues recalculées un tick sur deux
  assert.ok(received(r, "me").players.has("other"));
  place(other, 0, -120 + VIEW_RADIUS_MAX + 40);
  r.tick(2); // vues recalculées un tick sur deux
  assert.ok(!received(r, "me").players.has("other"));
  interest.setRadius("me", Number.NaN);
  interest.setRadius("me", "200");
  r.tick(2); // vues recalculées un tick sur deux
  assert.ok(!received(r, "me").players.has("other"));
});

test("évènements ciblés : envoyés aux seuls clients concernés", () => {
  const state = new ArenaState();
  const interest = new InterestManager();
  const inbox = new Map<string, string[]>();
  const mk = (id: string, x: number, y: number) => {
    const p = addPlayer(state, { id, x, y, blades: 3 });
    inbox.set(id, []);
    interest.addViewer({ sessionId: id, send: (type: string) => inbox.get(id)!.push(type) } as any, p);
    return p;
  };
  const a = mk("a", 0, -100);
  const b = mk("b", 30, -100);
  mk("far", 0, 150);
  interest.update(state);
  interest.send("clash", {}, { players: [a.id, b.id] });
  interest.send("pickup", {}, { to: [a.id] });
  interest.send("crateHit", {}, { at: { x: 0, y: 140 } });
  const blade = giveBlade(state, b);
  interest.update(state);
  interest.send("bladeDestroyed", {}, { blade: blade.id });
  assert.deepEqual(inbox.get("a"), ["clash", "pickup", "bladeDestroyed"]);
  assert.deepEqual(inbox.get("b"), ["clash", "bladeDestroyed"]);
  assert.deepEqual(inbox.get("far"), ["crateHit"]);
});

test("résumé : classement complet, minimap sans les joueurs cachés", () => {
  const r = new TestRoom(clock);
  const me = r.join("me");
  const hidden = r.join("hidden");
  place(me, 0, -100);
  place(hidden, BUSHES[1].x, BUSHES[1].y);
  addGroundBlade(r.state, { x: 12, y: 34, rarity: 3 });
  const summary = r.room.buildSummary();
  assert.deepEqual(summary.board.map((e: any[]) => e[0]).sort(), ["hidden", "me"]);
  assert.deepEqual(summary.map.map((e: any[]) => summary.board[e[0]][0]), ["me"]);
  assert.deepEqual(summary.legendaries, [[12, 34]]);
});

test("mode debug : pas d'orbites de joueurs cachés dans les trames", () => {
  // Tout client peut demander les trames de debug : elles ne doivent pas
  // servir de wallhack.
  const r = new TestRoom(clock);
  const me = r.join("me");
  const hidden = r.join("hidden");
  const bush = BUSHES[3];
  place(hidden, bush.x, bush.y);
  place(me, bush.x, bush.y + 25);
  const frames: any[] = [];
  r.room.clients.push({ sessionId: "me", send: (type: string, msg: any) => { if (type === "debugOrbits") frames.push(msg); } });
  r.room.debugOrbitClients.add("me");
  r.tick(4);
  assert.ok(frames.length > 0);
  for (const f of frames) {
    assert.ok(!("hidden" in f.owners), "orbite d'un joueur caché envoyée");
    for (const row of f.blades) assert.notEqual(row[1], "hidden");
  }
  place(hidden, bush.x + bush.radius + 3, bush.y);
  r.tick(4);
  assert.ok("hidden" in frames[frames.length - 1].owners);
});
