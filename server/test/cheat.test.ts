// Triche de test (/blades dans le chat) : en salon privé seulement, et si
// le serveur l'autorise (CHEATS=1 dans son environnement).
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { BladeRarity, CheatResult, CrateKind, INITIAL_BLADE_COUNT, MAX_BLADES_PER_PLAYER, MapEventKind } from "@bladeio/shared";
import { FakeClock, ownedBlades, seedRandom } from "./helpers";
import { TestRoom } from "./testRoom";

let clock: FakeClock;
let restoreRandom: () => void;

beforeEach(() => {
  clock = new FakeClock();
  restoreRandom = seedRandom(11);
  process.env.CHEATS = "1";
});
afterEach(() => {
  clock.restore();
  restoreRandom();
  delete process.env.CHEATS;
});

// Envoie la demande comme le client et rend les réponses du serveur.
function cheat(r: TestRoom, sessionId: string, msg: object): CheatResult[] {
  const replies: CheatResult[] = [];
  r.room.handleCheat({ sessionId, send: (_type: string, res: CheatResult) => replies.push(res) }, msg);
  return replies;
}

test("triche : 50 lames par défaut en salon privé, de la rareté demandée", () => {
  const r = new TestRoom(clock, { code: "TESTS" });
  const p = r.join("a");
  assert.deepEqual(cheat(r, "a", {}), [{ ok: true, blades: 50 }]);
  assert.equal(ownedBlades(r.state, p).length, INITIAL_BLADE_COUNT + 50);
  assert.deepEqual(cheat(r, "a", { blades: 5, rarity: BladeRarity.Legendary }), [{ ok: true, blades: 5 }]);
  assert.equal(ownedBlades(r.state, p).filter((b) => b.rarity === BladeRarity.Legendary).length, 5);
  // Rareté inconnue : lames communes.
  cheat(r, "a", { blades: 2, rarity: 9 });
  assert.equal(ownedBlades(r.state, p).filter((b) => b.rarity === BladeRarity.Common).length, INITIAL_BLADE_COUNT + 52);
  r.tick();
  assert.equal(p.bladeCount, INITIAL_BLADE_COUNT + 57);
});

test("triche : plafond de lames, même pour deux demandes dans le même tick", () => {
  const r = new TestRoom(clock, { code: "TESTS" });
  const p = r.join("a");
  cheat(r, "a", { blades: MAX_BLADES_PER_PLAYER - INITIAL_BLADE_COUNT - 100 });
  assert.deepEqual(cheat(r, "a", { blades: 400 }), [{ ok: true, blades: 100 }]);
  assert.equal(ownedBlades(r.state, p).length, MAX_BLADES_PER_PLAYER);
  assert.deepEqual(cheat(r, "a", { blades: 1 }), [{ ok: false, reason: "full" }]);
});

test("triche : refusée en partie publique, sans CHEATS=1, ou une fois mort", () => {
  const pub = new TestRoom(clock);
  const a = pub.join("a");
  assert.deepEqual(cheat(pub, "a", { blades: 50 }), [{ ok: false, reason: "public" }]);
  assert.equal(ownedBlades(pub.state, a).length, INITIAL_BLADE_COUNT);
  const priv = new TestRoom(clock, { code: "TESTS" });
  const b = priv.join("b");
  delete process.env.CHEATS;
  assert.deepEqual(cheat(priv, "b", { blades: 50 }), [{ ok: false, reason: "disabled" }]);
  process.env.CHEATS = "1";
  priv.room.killPlayer(b, null, "wall");
  assert.deepEqual(cheat(priv, "b", { blades: 50 }), [{ ok: false, reason: "dead" }]);
});

// /event (évènements de carte) : essais au navigateur sans attendre la
// minuterie ; l'évènement en cours s'arrête, son coffre est retiré.
test("triche : /event lance l'évènement voulu tout de suite, en salon privé et dans un mode qui en a", () => {
  const r = new TestRoom(clock, { code: "TESTS" });
  r.join("a");
  assert.deepEqual(cheat(r, "a", { event: "vault" }), [{ ok: true, event: "vault" }]);
  assert.equal(r.state.mapEvent.kind, MapEventKind.Crate);
  const vault = r.state.mapEvent.crateId;
  assert.equal(r.state.crates.get(vault)?.kind, CrateKind.Vault);
  assert.deepEqual(cheat(r, "a", { event: "processors" }), [{ ok: true, event: "processors" }]);
  assert.equal(r.state.mapEvent.kind, MapEventKind.Processors);
  assert.equal(r.state.crates.has(vault), false);
  assert.deepEqual(cheat(r, "a", { event: "rain" }), [{ ok: true, event: "rain" }]);
  assert.deepEqual(cheat(r, "a", { event: "golden" }), [{ ok: true, event: "golden" }]);
  assert.equal(r.state.mapEvent.kind, MapEventKind.Golden);
  assert.deepEqual(cheat(r, "a", { event: "meteor" }), [{ ok: false, reason: "noEvents" }]);
  const ctf = new TestRoom(clock, { code: "TESTC", mode: "ctf" });
  ctf.join("b");
  assert.deepEqual(cheat(ctf, "b", { event: "vault" }), [{ ok: false, reason: "noEvents" }]);
  const pub = new TestRoom(clock);
  pub.join("c");
  assert.deepEqual(cheat(pub, "c", { event: "vault" }), [{ ok: false, reason: "public" }]);
  assert.equal(pub.state.mapEvent.kind, MapEventKind.None);
});
