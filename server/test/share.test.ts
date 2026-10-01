// Partage et groupes (tâche 5.5) : balises d'aperçu des liens, accès par
// identifiant de room.
import { test } from "node:test";
import assert from "node:assert/strict";
import { injectOgTags, ogRequestInfo, ogTags } from "../src/http/ogTags";
import { FakeClock } from "./helpers";
import { TestRoom } from "./testRoom";

// Requête express minimale : ce que lit ogRequestInfo.
function req(opts: { host?: string; proto?: string; query?: Record<string, unknown>; lang?: string } = {}): any {
  return {
    protocol: opts.proto ?? "https",
    query: opts.query ?? {},
    get: (h: string) => (h.toLowerCase() === "host" ? opts.host ?? "blade.example.com" : undefined),
    acceptsLanguages: (...langs: string[]) => {
      if (!opts.lang) return langs[0];
      return langs.find((l) => opts.lang!.startsWith(l)) ?? false;
    },
  };
}

const content = (html: string, key: string) => html.match(new RegExp(`(?:property|name)="${key}" content="([^"]*)"`))?.[1];

test("balises par défaut : adresses absolues, anglais sans préférence, français sinon", () => {
  const en = ogTags(ogRequestInfo(req(), undefined));
  assert.equal(content(en, "og:image"), "https://blade.example.com/og.jpg");
  assert.equal(content(en, "og:url"), "https://blade.example.com/");
  assert.equal(content(en, "og:title"), "blade.io — Spin to survive");
  assert.equal(content(en, "twitter:card"), "summary_large_image");
  const fr = ogTags(ogRequestInfo(req({ lang: "fr-FR" }), undefined));
  assert.equal(content(fr, "og:title"), "blade.io — Tourne pour survivre");
  assert.equal(content(fr, "og:locale"), "fr_FR");
  // PUBLIC_URL l'emporte sur l'hôte de la requête, chemin compris.
  const pub = ogTags(ogRequestInfo(req({ host: "10.0.0.5:2567", proto: "http" }), "https://jeu.example.org/blades"));
  assert.equal(content(pub, "og:image"), "https://jeu.example.org/blades/og.jpg");
});

test("liens d'invitation : salon privé et arène d'un ami", () => {
  const room = ogTags(ogRequestInfo(req({ query: { room: "ab3cd" } }), undefined));
  assert.equal(content(room, "og:title"), "Join my private room AB3CD · blade.io");
  assert.equal(content(room, "og:url"), "https://blade.example.com/?room=AB3CD");
  const join = ogTags(ogRequestInfo(req({ query: { join: "xY_9-kQ2a" }, lang: "fr" }), undefined));
  assert.equal(content(join, "og:title"), "Rejoins-moi dans l'arène · blade.io");
  assert.equal(content(join, "og:url"), "https://blade.example.com/?join=xY_9-kQ2a");
});

test("paramètres et hôte douteux ignorés, texte échappé", () => {
  const evil = ogTags(ogRequestInfo(req({ query: { room: "\"><script>", join: ["a", "b"] } }), undefined));
  assert.equal(content(evil, "og:title"), "blade.io — Spin to survive");
  assert.ok(!evil.includes("<script>"));
  const badHost = ogTags(ogRequestInfo(req({ host: "evil.com\"><b" }), undefined));
  assert.equal(content(badHost, "og:image"), "/og.jpg");
  assert.equal(content(badHost, "og:url"), undefined);
  // L'apostrophe passe telle quelle dans un attribut entre guillemets.
  const fr = ogTags({ base: null, lang: "fr", room: null, join: "abcd" });
  assert.equal(content(fr, "og:title"), "Rejoins-moi dans l'arène · blade.io");
});

test("injection dans index.html : seul le bloc balisé change", () => {
  const html = "<head>\n<title>Blade.io</title>\n<!-- og:start -->\n<meta property=\"og:title\" content=\"x\" />\n<!-- og:end -->\n</head>";
  const out = injectOgTags(html, { base: "https://b.example/", lang: "en", room: null, join: null });
  assert.ok(out.startsWith("<head>\n<title>Blade.io</title>\n<!-- og:start -->"));
  assert.ok(out.endsWith("<!-- og:end -->\n</head>"));
  assert.equal(content(out, "og:title"), "blade.io — Spin to survive");
  assert.equal((out.match(/og:title/g) ?? []).length, 1);
  // Sans marqueurs : inchangé.
  assert.equal(injectOgTags("<head></head>", { base: null, lang: "en", room: null, join: null }), "<head></head>");
});

test("rejoindre par identifiant : un salon privé exige son code", async () => {
  const clock = new FakeClock();
  try {
    const priv = new TestRoom(clock, { code: "ABCDE" });
    await assert.rejects(priv.room.onAuth({}, { name: "eve", code: "" }), (e: any) => e.code === 403 && e.message === "wrong_room");
    await assert.rejects(priv.room.onAuth({}, { name: "eve" }), (e: any) => e.code === 403);
    assert.equal((await priv.room.onAuth({}, { name: "bob", code: "abcde" })).name, "bob");
    const pub = new TestRoom(clock);
    assert.equal((await pub.room.onAuth({}, { name: "amy", code: "" })).name, "amy");
    await assert.rejects(pub.room.onAuth({}, { name: "amy", code: "ABCDE" }), (e: any) => e.code === 403);
  } finally {
    clock.restore();
  }
});
