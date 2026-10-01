// Loadout cosmétique géré par le serveur (tâche 6.1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LOADOUT, validateLoadout } from "@bladeio/shared";
import { FakeClock } from "./helpers";
import { TestRoom } from "./testRoom";

const none = { level: 1, owns: () => false };

test("équipement validé : existe, va dans cet emplacement, appartient au joueur", () => {
  for (const raw of [null, undefined, "robot", 42, []]) assert.deepEqual(validateLoadout(raw, none), DEFAULT_LOADOUT);
  // Débloqué au niveau 2.
  assert.equal(validateLoadout({ skin: "recrue" }, none).skin, "");
  assert.equal(validateLoadout({ skin: "recrue" }, { level: 2, owns: () => false }).skin, "recrue");
  // Vendu : seulement s'il a été acheté.
  assert.equal(validateLoadout({ skin: "robot" }, { level: 99, owns: () => false }).skin, "");
  assert.equal(validateLoadout({ skin: "robot" }, { level: 1, owns: (id) => id === "robot" }).skin, "robot");
  // Mauvais emplacement, inconnu, clés du prototype, thème de carte.
  const rich = { level: 99, owns: () => true };
  assert.deepEqual(
    validateLoadout({ skin: "pulse", trail: "recrue", bladeSkin: "__proto__", killFx: "constructor" }, rich),
    DEFAULT_LOADOUT,
  );
  assert.equal(validateLoadout({ skin: "sanctuaire" }, rich).skin, "");
  assert.deepEqual(
    validateLoadout({ skin: "recrue", bladeSkin: "pulse", trail: "comete", killFx: "confettis" }, rich),
    { skin: "recrue", bladeSkin: "pulse", trail: "comete", killFx: "confettis" },
  );
});

test("au join : l'équipement retenu est synchronisé ; l'effet d'élimination suit le tueur", () => {
  const clock = new FakeClock();
  try {
    const r = new TestRoom(clock);
    const join = (id: string, loadout: unknown, xp: number, owned: string[]) => {
      r.room.onJoin({ sessionId: id }, { loadout }, { userId: null, username: null, guestId: null, name: id, xp, owned });
      return r.state.players.get(id)!;
    };
    const wanted = { skin: "robot", bladeSkin: "pulse", trail: "comete", killFx: "confettis" };
    // Niveau 1, rien d'acheté : tout revient à la base.
    const newbie = join("newbie", wanted, 0, []);
    assert.deepEqual([newbie.skin, newbie.bladeSkin, newbie.trail, newbie.killFx], ["", "", "", ""]);
    // Niveau 2 (100 XP) et le robot acheté : tout est gardé.
    const vet = join("vet", wanted, 100, ["robot"]);
    assert.deepEqual([vet.skin, vet.bladeSkin, vet.trail, vet.killFx], ["robot", "pulse", "comete", "confettis"]);
    vet.spawnProtectionUntil = 0;
    newbie.spawnProtectionUntil = 0;
    (r.room as any).killPlayer(newbie, vet, "blades");
    (r.room as any).killPlayer(vet, newbie, "blades");
    const kills = r.eventsOf("playerKilled");
    assert.equal(kills[0].killFx, "confettis");
    assert.equal(kills[1].killFx, undefined);
  } finally {
    clock.restore();
  }
});
