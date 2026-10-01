// Chat et modération (tâche 5.6) : filtre de mots, pseudos, silence imposé
// et signalements.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAT_AUTO_MUTE_MS, censorChat, nameProblem } from "@bladeio/shared";
import * as supabase from "../src/auth/supabase";
import { FakeClock } from "./helpers";
import { TestRoom } from "./testRoom";

test("chat : insultes masquées en anglais et en français, variantes comprises", () => {
  const cases: Array<[string, string]> = [
    ["you are a fucking idiot", "you are a ******* idiot"],
    ["espèce de connard", "espèce de *******"],
    ["sale pute", "sale ****"],
    ["ENCULÉ va", "****** va"],
    ["n1gg3r", "******"],
    ["Sh1t happens", "**** happens"],
    ["$alope", "******"],
    ["fuuuuuck", "********"],
    ["f u c k you", "* * * * you"],
    ["t'es un f.d.p", "t'es un *****"],
    ["go kill yourself", "go **** ********"],
    ["motherfucker", "************"],
  ];
  for (const [input, expected] of cases) {
    const r = censorChat(input);
    assert.equal(r.text, expected, input);
    assert.ok(r.hits > 0, input);
  }
});

test("chat : pas de faux positifs sur les mots courants", () => {
  for (const ok of [
    "computer dispute reputation", "le Niger et le Nigeria", "torpedo", "assassin classe passage",
    "technique unique panique", "un fichier", "une salopette", "ébranler", "un cocktail, Hancock",
    "je suis en retard", "du fromage râpé", "Putin", "Dickens", "Pornic", "pros and cons", "GG wp !",
  ]) {
    const r = censorChat(ok);
    assert.equal(r.hits, 0, ok);
    assert.equal(r.text, ok);
  }
});

test("pseudos : insultes, noms réservés, écritures mêlées", () => {
  for (const n of ["xXFuckXx", "N1gg3r", "Sal_Ope", "LeConnard", "FDP", "Ｆｕｃｋ"]) assert.equal(nameProblem(n), "offensive", n);
  for (const n of ["Admin", "Mod_Bob", "Blade.io", "Moderateur"]) assert.equal(nameProblem(n), "reserved", n);
  // А cyrillique, Α grec : « Alpha » usurpé.
  for (const n of ["Аlpha", "Αlpha", "Kestрel"]) assert.equal(nameProblem(n), "mixed", n);
  for (const n of ["Alpha", "Kestrel", "Ζεύς", "Владимир", "Jean-Luc", "Niger", "Torpedo_99", "Computer", "Hancock"]) {
    assert.equal(nameProblem(n), null, n);
  }
});

function fakeClient(sessionId: string) {
  const sent: Array<{ type: string; msg: any }> = [];
  return { sessionId, sent, send: (type: string, msg: any) => sent.push({ type, msg }) };
}

test("pseudos en jeu : refusés remplacés, pleine chasse ramenée au latin", () => {
  const clock = new FakeClock();
  try {
    const r = new TestRoom(clock);
    const names = ["Admin", "xXFuckXx", "Аlpha", "Ｋｅｓｔｒｅｌ", "Alpha"].map((n, i) => {
      r.room.onJoin({ sessionId: `p${i}` }, {}, { userId: null, username: null, guestId: null, name: n });
      return r.state.players.get(`p${i}`)!.name;
    });
    for (const n of names.slice(0, 3)) assert.match(n, /^Anon\d+$/);
    assert.deepEqual(names.slice(3), ["Kestrel", "Alpha"]);
  } finally {
    clock.restore();
  }
});

test("chat de la room : masqué pour tous, /me, silence après trois messages masqués", () => {
  const clock = new FakeClock();
  try {
    const r = new TestRoom(clock);
    r.join("alice");
    const alice = fakeClient("alice");
    r.room.handleChat(alice, { text: "putain de bot" });
    r.room.handleChat(alice, { text: "danse", action: true });
    const chats = r.eventsOf("chat");
    assert.equal(chats[0].text, "****** de bot");
    assert.equal(chats[0].action, undefined);
    assert.equal(chats[1].action, true);
    // Texte d'origine gardé pour un signalement.
    assert.equal(r.state.players.get("alice")!.recentChat[0].text, "putain de bot");
    clock.advance(6000);
    r.room.handleChat(alice, { text: "merde" });
    assert.equal(alice.sent.length, 0);
    r.room.handleChat(alice, { text: "fuck" });
    assert.deepEqual(alice.sent, [{ type: "chatMuted", msg: { seconds: CHAT_AUTO_MUTE_MS / 1000 } }]);
    assert.equal(r.eventsOf("chat").length, 4);
    // Réduit au silence : plus rien ne part, le joueur est prévenu.
    clock.advance(6000);
    r.room.handleChat(alice, { text: "bonjour" });
    assert.equal(r.eventsOf("chat").length, 4);
    assert.equal(alice.sent.at(-1)!.type, "chatMuted");
    clock.advance(CHAT_AUTO_MUTE_MS);
    r.room.handleChat(alice, { text: "bonjour" });
    assert.equal(r.eventsOf("chat").at(-1).text, "bonjour");
    // Morte, elle parle encore.
    r.state.players.get("alice")!.alive = false;
    r.room.handleChat(alice, { text: "gg" });
    assert.equal(r.eventsOf("chat").at(-1).text, "gg");
  } finally {
    clock.restore();
  }
});

test("signalements : journalisés avec les derniers messages, une fois par joueur, plafonnés", async () => {
  const clock = new FakeClock();
  const inserted: any[] = [];
  const saved = { admin: supabase.getAdminClient, log: console.log };
  (supabase as any).getAdminClient = () => ({ from: (table: string) => ({ insert: async (row: any) => { inserted.push({ table, row }); return { error: null }; } }) });
  console.log = () => {};
  try {
    const r = new TestRoom(clock);
    r.join("bob");
    r.join("eve");
    const bob = fakeClient("bob");
    r.room.handleChat(fakeClient("eve"), { text: "t'es un connard" });
    r.room.handleReport(bob, { targetId: "eve", reason: "  insultes \n répétées " });
    r.room.handleReport(bob, { targetId: "eve" });
    r.room.handleReport(bob, { targetId: "bob" });
    r.room.handleReport(bob, { targetId: "personne" });
    await new Promise((res) => setImmediate(res));
    assert.deepEqual(bob.sent.map((s) => s.msg.status), ["ok", "duplicate", "unknown", "unknown"]);
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].table, "reports");
    assert.equal(inserted[0].row.target_name, "eve");
    assert.equal(inserted[0].row.reporter_name, "bob");
    assert.equal(inserted[0].row.reason, "insultes répétées");
    assert.deepEqual(inserted[0].row.recent_messages.map((m: any) => m.text), ["t'es un connard"]);
    // Cinq signalements par tranche de dix minutes.
    for (let i = 0; i < 5; i++) r.join(`t${i}`);
    for (let i = 0; i < 5; i++) r.room.handleReport(bob, { targetId: `t${i}` });
    assert.deepEqual(bob.sent.slice(4).map((s) => s.msg.status), ["ok", "ok", "ok", "ok", "limited"]);
    clock.advance(600_001);
    r.room.handleReport(bob, { targetId: "t4" });
    assert.equal(bob.sent.at(-1)!.msg.status, "ok");
  } finally {
    (supabase as any).getAdminClient = saved.admin;
    console.log = saved.log;
    clock.restore();
  }
});
