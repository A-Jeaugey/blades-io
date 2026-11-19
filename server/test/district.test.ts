import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DISTRICT_MAP,
  FACADE_MODULE,
  PLAYER_BODY_RADIUS,
  SERVER_DT,
  THROW_PROJECTILE_SPEED,
  mapBlocked,
  mapForMode,
  mapSegmentHit,
  resolveMapCollision,
  stepMovement,
  type MapBox,
} from "@bladeio/shared";
import { navIslands, navToward } from "../src/systems/nav";
import { FakeClock, seedRandom } from "./helpers";
import { TestRoom } from "./testRoom";

const map = DISTRICT_MAP;

function overlap(a: MapBox, b: MapBox, slack: number): boolean {
  return Math.abs(a.x - b.x) < a.hw + b.hw - slack && Math.abs(a.y - b.y) < a.hh + b.hh - slack;
}

test("quartier : seul le mode district a une carte à murs", () => {
  assert.equal(mapForMode("district"), map);
  for (const id of ["ffa", "rounds", "tdm", "lts", "ctf", "ranked", "nope"]) assert.equal(mapForMode(id), null);
});

test("quartier : bâtiments au module, sans recouvrement, symétriques", () => {
  for (const b of map.buildings) {
    for (const v of [b.x0, b.x1, b.y0, b.y1]) assert.equal(Math.abs(v % FACADE_MODULE), 0, `côté hors module : ${JSON.stringify(b)}`);
    assert.ok(b.x1 > b.x0 && b.y1 > b.y0 && b.floors >= 1);
    assert.ok(
      map.buildings.some((o) => o.x0 === -b.x1 && o.x1 === -b.x0 && o.y0 === b.y0 && o.y1 === b.y1 && o.floors === b.floors),
      "bâtiment sans reflet",
    );
  }
  const n = map.buildings.length;
  const boxes = map.boxes.slice(0, n);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      assert.ok(!overlap(boxes[i], boxes[j], 0.01), `bâtiments ${i} et ${j} l'un dans l'autre`);
    }
  }
  // L'enceinte ferme la carte : aucun point de son bord n'est libre.
  for (let v = -map.half; v <= map.half; v += 1) {
    for (const [x, y] of [[v, map.half + 1], [v, -map.half - 1], [map.half + 1, v], [-map.half - 1, v]]) {
      assert.ok(map.boxes.some((b) => Math.abs(x - b.x) <= b.hw && Math.abs(y - b.y) <= b.hh), `enceinte ouverte en ${x}, ${y}`);
    }
  }
});

test("quartier : mobilier hors des murs, dans la zone jouable, sans empilement", () => {
  const n = map.buildings.length;
  const buildings = map.boxes.slice(0, n);
  const furniture = map.boxes.slice(n);
  for (const f of furniture) {
    assert.ok(Math.abs(f.x) + f.hw <= map.half && Math.abs(f.y) + f.hh <= map.half, `meuble hors zone : ${JSON.stringify(f)}`);
    for (const b of buildings) assert.ok(!overlap(f, b, 0.05), `meuble dans un mur : ${JSON.stringify(f)}`);
  }
  for (let i = 0; i < furniture.length; i++) {
    for (let j = i + 1; j < furniture.length; j++) {
      assert.ok(!overlap(furniture[i], furniture[j], 0.05), `meubles l'un dans l'autre : ${JSON.stringify(furniture[i])} ${JSON.stringify(furniture[j])}`);
    }
  }
  for (const c of map.circles) {
    assert.ok(!mapBlockedByBoxes(c.x, c.y, c.radius - 0.05), `borne ou lampadaire dans un obstacle : ${JSON.stringify(c)}`);
  }
});

// Un corps de rayon r mord-il sur un obstacle ? Distance au rectangle (coins
// arrondis), comme resolveMapCollision ; mapBlocked, lui, gonfle en carré.
function bodyInside(x: number, y: number, r: number): boolean {
  for (const b of map.boxes) {
    const ex = Math.max(0, Math.abs(x - b.x) - b.hw);
    const ey = Math.max(0, Math.abs(y - b.y) - b.hh);
    if (ex * ex + ey * ey < r * r) return true;
  }
  return map.circles.some((c) => Math.hypot(x - c.x, y - c.y) < c.radius + r);
}

function mapBlockedByBoxes(x: number, y: number, margin: number): boolean {
  return map.boxes.some((b) => Math.abs(x - b.x) < b.hw + margin && Math.abs(y - b.y) < b.hh + margin);
}

test("quartier : tout ce qui est libre se rejoint", () => {
  assert.equal(navIslands(map), 1, "une cour ou une ruelle est enfermée");
  // Entre un quart et la moitié de la zone jouable se parcourt : ni un
  // labyrinthe, ni un terrain vague.
  const share = map.walkArea / (map.half * map.half * 4);
  assert.ok(share > 0.45 && share < 0.75, `part libre ${share.toFixed(2)}`);
});

test("quartier : un corps ne traverse ni mur ni meuble, et glisse le long", () => {
  // Façade ouest de l'immeuble [32, 48] × [28, 48] : on marche dessus en biais.
  const body = { x: 29, y: 30, knockbackVx: 0, knockbackVy: 0 };
  for (let i = 0; i < 60; i++) {
    stepMovement(body, { dx: 0.8, dy: 0.6, boost: false }, { speed: false, frozen: false, canBoost: false, map }, SERVER_DT);
    assert.ok(!bodyInside(body.x, body.y, PLAYER_BODY_RADIUS - 0.01), `dans un obstacle en ${body.x}, ${body.y}`);
  }
  assert.ok(Math.abs(body.x - (32 - PLAYER_BODY_RADIUS)) < 1e-6, "arrêté par la façade");
  assert.ok(body.y > 34, "il a glissé le long du mur");
  // Coin d'immeuble : repoussé hors du coin, jamais dedans.
  const p = resolveMapCollision(map, 27.8, 7.8, PLAYER_BODY_RADIUS);
  assert.ok(Math.hypot(p.x - 28, p.y - 8) >= PLAYER_BODY_RADIUS - 1e-6);
  // Au cœur d'un immeuble : ressorti.
  const q = resolveMapCollision(map, 38, 14, PLAYER_BODY_RADIUS);
  assert.ok(!bodyInside(q.x, q.y, PLAYER_BODY_RADIUS - 0.01));
});

test("quartier : segments (lancers, vue) arrêtés par les murs", () => {
  // De la place vers l'est, à travers l'immeuble [28, 48] × [8, 20].
  const t = mapSegmentHit(map, 20, 14, 60, 14, 0, 0);
  assert.ok(Math.abs(20 + 40 * t - 28) < 1e-6, "arrêt sur la façade");
  // Le long de l'avenue : rien.
  assert.equal(mapSegmentHit(map, 30, 0, 40, 0, 0, 0), 1);
  // Un meuble arrête un lancer, pas la vue.
  assert.ok(map.props.some((p) => p.kind === "car" && p.x === 36 && p.y === 5.4), "la voiture de l'avenue");
  assert.ok(mapSegmentHit(map, 30, 5.4, 42, 5.4, 0, 0) < 1);
  assert.equal(mapSegmentHit(map, 30, 5.4, 42, 5.4, 6, 0), 1);
});

test("quartier : un bot contourne un immeuble", () => {
  // De part et d'autre de l'immeuble [28, 48] × [8, 20], sans ligne droite.
  let x = 38;
  let y = 5;
  const mem = {};
  let now = 0;
  for (let i = 0; i < 60 * 12 && Math.hypot(x - 38, y - 24) > 1; i++) {
    now += SERVER_DT * 1000;
    const w = navToward(map, mem, x, y, 38, 24, now);
    const d = Math.hypot(w.x - x, w.y - y) || 1;
    const body = { x, y, knockbackVx: 0, knockbackVy: 0 };
    stepMovement(body, { dx: (w.x - x) / d, dy: (w.y - y) / d, boost: false }, { speed: false, frozen: false, canBoost: false, map }, SERVER_DT);
    x = body.x;
    y = body.y;
  }
  assert.ok(Math.hypot(x - 38, y - 24) <= 1, `resté en ${x.toFixed(1)}, ${y.toFixed(1)}`);
});

test("quartier : une room joue sur la carte (apparitions, butin, bots)", () => {
  const clock = new FakeClock();
  const restore = seedRandom(7);
  try {
    const r = new TestRoom(clock, { code: "ABCDE", mode: "district", bots: true });
    assert.equal(r.state.mode, "district");
    assert.equal(r.state.map, map);
    const me = r.join("me");
    r.tick(2);
    assert.equal(r.state.mapRadius, map.radius);
    assert.ok(!mapBlocked(map, me.x, me.y, PLAYER_BODY_RADIUS));
    const start = new Map<string, { x: number; y: number }>();
    r.state.players.forEach((p) => start.set(p.id, { x: p.x, y: p.y }));
    assert.ok(start.size > 3, "des bots dans la partie");
    let far = 0;
    for (let s = 0; s < 30; s++) {
      r.tick(60);
      r.state.players.forEach((p) => {
        if (p.alive) assert.ok(!bodyInside(p.x, p.y, PLAYER_BODY_RADIUS - 0.05), `${p.name} dans un mur en ${p.x}, ${p.y}`);
      });
    }
    r.state.players.forEach((p) => {
      const from = start.get(p.id);
      if (p.isBot && from && Math.hypot(p.x - from.x, p.y - from.y) > 15) far++;
    });
    assert.ok(far >= 3, `les bots se déplacent dans les rues (${far})`);
    // Rien de ramassable dans un mur, ni caisse ni décor de l'arène ronde.
    let ground = 0;
    r.state.blades.forEach((b) => {
      if (b.ownerId || b.isProjectile) return;
      ground++;
      assert.ok(!mapBlocked(map, b.x, b.y, 0.1), `lame dans un mur en ${b.x}, ${b.y}`);
    });
    assert.ok(ground > 10, "du butin dans les rues");
    r.state.crates.forEach((c) => {
      assert.ok(!c.id.startsWith("rack-") && !c.id.startsWith("obelisk-"), "décor interactif de l'arène");
      assert.ok(!mapBlocked(map, c.x, c.y, 1), "caisse dans un mur");
    });
    assert.equal(r.state.mapEvent.kind, 0, "pas d'évènement de carte");
  } finally {
    restore();
  }
});

test("quartier : un lancer s'arrête au mur et la lame reste ramassable", () => {
  const clock = new FakeClock();
  const r = new TestRoom(clock, { code: "ABCDE", mode: "district" });
  const me = r.join("me");
  r.tick(2);
  // Une lame de sa propre orbite, transformée en projectile vers l'est
  // depuis la place : l'immeuble [28, 48] × [8, 20] est sur sa route.
  let blade: any = null;
  r.state.blades.forEach((b) => { if (!blade && b.ownerId === me.id) blade = b; });
  assert.ok(blade, "une lame à lancer");
  blade.ownerId = "";
  blade.isProjectile = true;
  blade.thrownBy = me.id;
  blade.x = blade.originX = 20;
  blade.y = blade.originY = 14;
  blade.vx = THROW_PROJECTILE_SPEED;
  blade.vy = 0;
  blade.expiresAt = 0;
  blade.pierceLeft = 1;
  me.x = -60;
  me.y = 0;
  for (let i = 0; i < 60 && blade.isProjectile; i++) r.tick(1);
  assert.equal(blade.isProjectile, false, "retombée");
  assert.ok(blade.x < 28 && blade.x > 27, `au pied de la façade (${blade.x})`);
  assert.ok(!mapBlocked(map, blade.x, blade.y, 0.1));
});
