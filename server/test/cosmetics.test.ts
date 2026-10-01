// Loadout cosmétique géré par le serveur (tâche 6.1) et catalogue (6.2).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COSMETICS,
  COSMETIC_SLOTS,
  DEFAULT_LOADOUT,
  SHOP_ITEMS,
  cosmeticsOf,
  cosmeticsUnlocked,
  getCosmetic,
  getShopItem,
  validateLoadout,
} from "@bladeio/shared";
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

test("catalogue : chaque cosmétique se débloque au niveau ou s'achète, jamais les deux", () => {
  for (const def of Object.values(COSMETICS)) {
    const item = getShopItem(def.id);
    if (def.level !== undefined) {
      assert.equal(item, undefined, `${def.id} : débloqué au niveau ${def.level} et vendu`);
      assert.ok(Number.isInteger(def.level) && def.level >= 2, `${def.id} : niveau ${def.level}`);
    } else {
      // Sans prix, un item sans niveau ne serait à personne.
      assert.ok(item && item.price > 0, `${def.id} : ni niveau ni prix`);
      assert.equal(item.kind, def.slot, `${def.id} : vendu dans le mauvais emplacement`);
    }
  }
  // Les articles cosmétiques de la boutique existent, au bon emplacement ;
  // les thèmes de carte n'en sont pas.
  for (const item of Object.values(SHOP_ITEMS)) {
    if (item.kind === "theme") assert.equal(getCosmetic(item.id), undefined, item.id);
    else assert.equal(getCosmetic(item.id)?.slot, item.kind, item.id);
  }
  // Identifiants uniques : un doublon serait écrasé en silence.
  const total = COSMETIC_SLOTS.reduce((n, slot) => n + cosmeticsOf(slot).length, 0);
  assert.equal(Object.keys(COSMETICS).length, total);
  // Volumes de la tâche 6.2, dont au moins un item gratuit et un vendu par
  // emplacement.
  const range: Record<string, [number, number]> = { skin: [6, 10], bladeSkin: [4, 6], trail: [4, 4], killFx: [3, 3] };
  for (const slot of COSMETIC_SLOTS) {
    const defs = cosmeticsOf(slot);
    assert.ok(defs.length >= range[slot][0] && defs.length <= range[slot][1], `${slot} : ${defs.length}`);
    assert.ok(defs.some((d) => d.level !== undefined) && defs.some((d) => d.level === undefined), slot);
  }
});

test("déblocages d'un passage de niveau (carte de fin de vie)", () => {
  const ids = (from: number, to: number) => cosmeticsUnlocked(from, to).map((d) => d.id);
  assert.deepEqual(ids(1, 2), ["recrue", "pulse", "comete", "confettis"]);
  assert.deepEqual(ids(2, 2), []);
  assert.deepEqual(ids(9, 10), ["ninja"]);
  // Plusieurs niveaux d'un coup : tout ce qui est entre les deux.
  assert.deepEqual(ids(4, 12), ["sentinelle", "ninja", "stries", "aurore"]);
  // Rien d'acheté ne se débloque.
  assert.ok(cosmeticsUnlocked(1, 1000).every((d) => getShopItem(d.id) === undefined));
});
