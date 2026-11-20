// Agents et capacités (shared/src/agents.ts, docs/AGENTS.md) : choix,
// recharge, jauge de l'ultime, effet de chaque capacité, visibilité,
// protections, prédiction du client identique au serveur, bots.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  AckState,
  AgentEffect,
  BARRAGE_DURATION_MS,
  CastSlot,
  DASH_COOLDOWN_MS,
  DASH_IMPULSE,
  DEFAULT_AGENT,
  InputPredictor,
  MoveInput,
  SHOCKWAVE_WINDUP_MS,
  SMOKE_DURATION_MS,
  TRAP_ARM_MS,
  ULT_CHARGE_KILL,
  WELL_WINDUP_MS,
  ZoneKind,
  castDirection,
  isInBush,
  pulseShedCount,
} from "@bladeio/shared";
import { Player } from "../src/state/Player";
import { FakeClock, giveBlade, groundBlades, seedRandom } from "./helpers";
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

// Un client par joueur : un input par tick (sans input, un humain ne fait
// pas de pas, son recul ne s'amortit pas).
class Pilot {
  seq = 0;
  constructor(private readonly r: TestRoom, readonly id: string) {}
  send(input: Partial<MoveInput> & { cast?: number; castX?: number; castY?: number; throw?: boolean; aimX?: number; aimY?: number } = {}): void {
    this.r.room.handleInput({ sessionId: this.id, leave: () => {} }, { dx: 0, dy: 0, boost: false, ...input, seq: ++this.seq });
  }
}

// Tick de la room avec un input (immobile par défaut) pour chaque pilote.
function step(r: TestRoom, pilots: Pilot[], ticks = 1): void {
  for (let i = 0; i < ticks; i++) {
    for (const p of pilots) p.send();
    r.tick();
  }
}

function place(p: Player, x: number, y: number): void {
  p.x = x;
  p.y = y;
  p.knockbackVx = 0;
  p.knockbackVy = 0;
  assert.equal(isInBush(x, y), false, `(${x}, ${y}) est dans un buisson`);
}

function arm(r: TestRoom, id: string, agent: string, x: number, y: number, blades = 0): { p: Player; pilot: Pilot } {
  const p = r.join(id, {}, { agent });
  place(p, x, y);
  for (let i = p.bladeCount; i < blades; i++) giveBlade(r.state, p);
  return { p, pilot: new Pilot(r, id) };
}

test("agents : choix au join, agent des débuts, changement à la réapparition", () => {
  const r = new TestRoom(clock);
  const a = r.join("a", {}, { agent: "brume" });
  const b = r.join("b");
  const c = r.join("c", {}, { agent: "hacker" });
  assert.equal(a.agent, "brume");
  assert.equal(b.agent, DEFAULT_AGENT);
  assert.equal(c.agent, DEFAULT_AGENT);
  // Nouvel agent : la jauge repart de zéro ; même agent : elle survit à la mort.
  a.ultPoints = 60;
  r.room.killPlayer(a, null, "wall");
  r.room.handleRespawn({ sessionId: "a" }, { agent: "vigie" });
  assert.equal(a.agent, "vigie");
  assert.equal(a.ultPoints, 0);
  a.ultPoints = 40;
  r.room.killPlayer(a, null, "wall");
  r.room.handleRespawn({ sessionId: "a" }, {});
  assert.equal(a.agent, "vigie");
  assert.equal(a.ultPoints, 40);
});

test("jauge de l'ultime : une seconde en vie, une élimination, puis dépensée", () => {
  const r = new TestRoom(clock);
  const { p, pilot } = arm(r, "v", "volt", 0, -40);
  const victim = r.join("x");
  step(r, [pilot], 600);
  assert.ok(Math.abs(p.ultPoints - 10) < 0.2, `10 s : ${p.ultPoints}`);
  r.room.killPlayer(victim, p, "blades");
  assert.ok(Math.abs(p.ultPoints - (10 + ULT_CHARGE_KILL)) < 0.2);
  assert.equal(p.ultCharge, Math.floor(p.ultPoints));
  // Pas assez : refusé, rien ne change.
  pilot.send({ cast: CastSlot.Ultimate });
  r.tick();
  assert.equal(p.agentEffect, AgentEffect.None);
  p.ultPoints = 100;
  pilot.send({ cast: CastSlot.Ultimate });
  r.tick();
  assert.equal(p.agentEffect, AgentEffect.Surge);
  assert.ok(p.ultPoints < 1);
});

test("Éclair : un bond de ~8 u, puis la recharge", () => {
  const r = new TestRoom(clock);
  const { p, pilot } = arm(r, "v", "volt", -20, -40);
  pilot.send({ cast: CastSlot.Ability, castX: 1, castY: 0 });
  r.tick();
  step(r, [pilot], 60);
  const dashed = p.x - -20;
  assert.ok(dashed > 7 && dashed < 9.5, `bond de ${dashed.toFixed(2)} u`);
  assert.ok(p.abilityReadyAt - Date.now() > DASH_COOLDOWN_MS - 1200);
  // En recharge : refusé (il ne reste que la fin, presque nulle, du bond).
  const x0 = p.x;
  pilot.send({ cast: CastSlot.Ability, castX: 1, castY: 0 });
  r.tick();
  step(r, [pilot], 30);
  assert.ok(Math.abs(p.x - x0) < 0.2);
  assert.equal(r.eventsOf("abilityCast").length, 1);
});

test("Éclair : la prédiction du client suit le serveur au pas près", () => {
  const r = new TestRoom(clock);
  const { p, pilot } = arm(r, "v", "volt", -30, -40);
  const predictor = new InputPredictor();
  predictor.selfId = "v";
  const LAT = 4;
  const uplink: Array<{ at: number; msg: object }> = [];
  const downlink: Array<{ at: number; ack: AckState }> = [];
  for (let tick = 0; tick < 90; tick++) {
    const input: MoveInput = { dx: tick < 60 ? 1 : 0, dy: 0, boost: false };
    const msg: Record<string, unknown> = { ...input };
    if (tick === 10) {
      // Le client pose l'impulsion à l'envoi, le serveur au même pas.
      const dir = castDirection(0, 1, input.dx, input.dy, 1, 0);
      input.impulseX = dir.x * DASH_IMPULSE;
      input.impulseY = dir.y * DASH_IMPULSE;
      Object.assign(msg, { cast: CastSlot.Ability, castX: 0, castY: 1 });
    }
    pilot.seq++;
    predictor.push(pilot.seq, input);
    uplink.push({ at: tick + LAT, msg: { ...msg, seq: pilot.seq } });
    while (uplink.length && uplink[0].at <= tick) r.room.handleInput({ sessionId: "v", leave: () => {} }, uplink.shift()!.msg);
    r.tick();
    downlink.push({
      at: tick + LAT,
      ack: {
        seq: p.lastSeq, x: Math.fround(p.x), y: Math.fround(p.y),
        knockbackVx: Math.fround(p.knockbackVx), knockbackVy: Math.fround(p.knockbackVy),
        serverTime: r.state.serverTime, speedUntil: p.speedUntil, hitlagUntil: p.hitlagUntil, bladeCount: p.bladeCount,
        slowUntil: p.slowUntil, agentEffect: p.agentEffect, agentEffectUntil: p.agentEffectUntil,
        spawnProtectionUntil: p.spawnProtectionUntil, botSpareUntil: p.botSpareUntil,
      },
    });
    while (downlink.length && downlink[0].at <= tick) {
      const c = predictor.reconcile(downlink.shift()!.ack);
      assert.ok(Math.hypot(c.dx, c.dy) < 0.01, `correction de ${Math.hypot(c.dx, c.dy).toFixed(3)} u au tick ${tick}`);
    }
  }
  assert.ok(p.y > -40 + 7, "le bond est parti vers +y");
});

test("Salve : trois lancers pour une lame", () => {
  const r = new TestRoom(clock);
  const { p, pilot } = arm(r, "s", "sagaie", 0, -40, 10);
  pilot.send({ cast: CastSlot.Ability, castX: 1, castY: 0 });
  r.tick();
  assert.equal(p.bladeCount, 9);
  const flying = [...r.state.blades.values()].filter((b) => b.isProjectile && b.thrownBy === "s");
  assert.equal(flying.length, 3);
  const angles = flying.map((b) => Math.atan2(b.vy, b.vx)).sort((a, b) => a - b);
  assert.ok(angles[2] - angles[0] > 0.3, "en éventail");
});

test("Rafale : des éclats sans lame, qui ne retombent pas au sol", () => {
  const r = new TestRoom(clock);
  const { p, pilot } = arm(r, "s", "sagaie", 0, -40);
  // Aucune lame : un lancer ordinaire est impossible.
  for (const id of [...p.bladeIds]) r.state.blades.delete(id);
  p.bladeIds = [];
  p.bladeCount = 0;
  p.ultPoints = 100;
  pilot.send({ cast: CastSlot.Ultimate });
  r.tick();
  assert.equal(p.agentEffect, AgentEffect.Barrage);
  for (let t = 0; t < (BARRAGE_DURATION_MS / 1000) * 60 + 90; t++) {
    pilot.send({ throw: true, aimX: 1, aimY: 0 });
    r.tick();
  }
  const shots = r.eventsOf("bladeThrown").filter((ev) => ev.thrownBy === "s").map((ev) => ev.bladeId as string);
  assert.ok(shots.length >= 14 && shots.length <= 17, `${shots.length} éclats`);
  step(r, [pilot], 60);
  assert.equal(shots.filter((id) => r.state.blades.has(id)).length, 0, "aucun éclat ne devient une lame");
  assert.equal(p.bladeCount, 0);
});

test("Nuée : cache qui est dedans, sauf au contact ; Sonar le révèle", () => {
  const r = new TestRoom(clock);
  const { p: brume, pilot } = arm(r, "b", "brume", 0, -40);
  const { p: vigie, pilot: vp } = arm(r, "g", "vigie", 24, -40);
  const interest = (r.room as any).interest;
  step(r, [pilot, vp], 2);
  assert.ok(interest.sees("g", "b"));
  pilot.send({ cast: CastSlot.Ability });
  r.tick();
  step(r, [pilot, vp], 2);
  assert.ok([...r.state.zones.values()].some((z) => z.kind === ZoneKind.Smoke));
  assert.equal(interest.sees("g", "b"), false, "caché dans sa Nuée");
  assert.equal(r.room.buildSummary().map.some(([i]: number[]) => r.room.buildSummary().board[i][0] === "b"), false, "absent de la minimap");
  // Sonar : révélé à Vigie pendant 4 s.
  vp.send({ cast: CastSlot.Ability });
  r.tick();
  step(r, [pilot, vp], 2);
  assert.ok(interest.sees("g", "b"), "révélé par le Sonar");
  step(r, [pilot, vp], 300);
  assert.equal(interest.sees("g", "b"), false, "le Sonar ne dure pas");
  // Au contact des orbites : visible.
  place(vigie, 3, -40);
  step(r, [pilot, vp], 2);
  assert.ok(interest.sees("g", "b"));
  place(vigie, 24, -40);
  step(r, [pilot, vp], Math.ceil((SMOKE_DURATION_MS / 1000) * 60));
  assert.ok(interest.sees("g", "b"), "la Nuée se dissipe");
  void brume;
});

test("Éclipse : caché partout aux adversaires", () => {
  const r = new TestRoom(clock);
  const { p, pilot } = arm(r, "b", "brume", 0, -40);
  const { pilot: op } = arm(r, "o", "volt", 30, -40);
  const interest = (r.room as any).interest;
  p.ultPoints = 100;
  pilot.send({ cast: CastSlot.Ultimate });
  r.tick();
  step(r, [pilot, op], 4);
  assert.equal(interest.sees("o", "b"), false);
  // Ses déplacements ne le trahissent pas sur la minimap.
  const s = r.room.buildSummary();
  assert.equal(s.map.some(([i]: number[]) => s.board[i][0] === "b"), false);
  step(r, [pilot, op], 7 * 60 + 10);
  assert.ok(interest.sees("o", "b"));
});

test("Piège : invisible, armé après 1 s, ralentit et révèle", () => {
  const r = new TestRoom(clock);
  const { p: vortex, pilot } = arm(r, "v", "vortex", 0, -40);
  const { p: enemy, pilot: ep } = arm(r, "e", "volt", 30, -40);
  pilot.send({ cast: CastSlot.Ability });
  r.tick();
  const trap = [...r.state.zones.values()].find((z) => z.kind === ZoneKind.Trap)!;
  assert.ok(trap);
  step(r, [pilot, ep], 2);
  const interest = (r.room as any).interest;
  const viewOf = (id: string) => interest.viewers.get(id).zones as Set<unknown>;
  assert.ok(viewOf("v").has(trap), "le poseur le voit");
  assert.equal(viewOf("e").has(trap), false, "l'adversaire non");
  // Sur le piège avant qu'il soit armé : rien.
  place(vortex, 20, -40);
  place(enemy, trap.x, trap.y);
  step(r, [pilot, ep], 3);
  assert.equal(enemy.slowUntil, 0);
  step(r, [pilot, ep], Math.ceil((TRAP_ARM_MS / 1000) * 60));
  assert.ok(enemy.slowUntil > Date.now(), "ralenti");
  assert.equal(r.state.zones.has(trap.id), false, "le piège a servi");
  assert.equal(r.eventsOf("trapSprung").length, 1);
  // Ralenti : il avance moins vite.
  const x0 = enemy.x;
  for (let t = 0; t < 30; t++) {
    ep.send({ dx: 1, dy: 0 });
    pilot.send();
    r.tick();
  }
  assert.ok(enemy.x - x0 < 11 * 0.5 * 0.7, `${(enemy.x - x0).toFixed(2)} u en 0,5 s`);
  assert.ok(enemy.reveals.some((rv) => rv.by === "v"), "révélé au poseur");
});

test("Singularité : attire les adversaires, pas son auteur", () => {
  const r = new TestRoom(clock);
  const { p: vortex, pilot } = arm(r, "v", "vortex", -10, -40);
  const { p: enemy, pilot: ep } = arm(r, "e", "volt", 6, -40);
  vortex.ultPoints = 100;
  // Puits 10 u devant, vers +x : centre (0, -40).
  pilot.send({ cast: CastSlot.Ultimate, castX: 10, castY: 0 });
  r.tick();
  const well = [...r.state.zones.values()].find((z) => z.kind === ZoneKind.Well)!;
  assert.ok(Math.abs(well.x - 0) < 0.01 && Math.abs(well.y - -40) < 0.01);
  step(r, [pilot, ep], Math.ceil((WELL_WINDUP_MS / 1000) * 60) + 60);
  assert.ok(enemy.x < 6 - 3, `attiré : x = ${enemy.x.toFixed(2)}`);
  assert.ok(Math.abs(vortex.x - -10) < 0.01, "son auteur ne bouge pas");
});

// Principe 5 (docs/AGENTS.md) : un joueur sous protection d'apparition
// n'est pas attiré ; un nouveau venu ne l'est pas par le puits d'un bot (il
// l'est par celui d'un humain).
test("Singularité : épargne les joueurs protégés", () => {
  const r = new TestRoom(clock);
  const { p: vortex, pilot } = arm(r, "v", "vortex", -10, -40);
  const { p: fresh, pilot: fp } = arm(r, "f", "volt", 6, -40);
  fresh.spawnProtectionUntil = Date.now() + 10_000;
  const { p: newbie, pilot: np } = arm(r, "n", "volt", 0, -34);
  newbie.botSpareUntil = Date.now() + 10_000;
  vortex.ultPoints = 100;
  pilot.send({ cast: CastSlot.Ultimate, castX: 10, castY: 0 });
  r.tick();
  step(r, [pilot, fp, np], Math.ceil((WELL_WINDUP_MS / 1000) * 60) + 60);
  assert.ok(Math.abs(fresh.x - 6) < 0.01, `protégé : x = ${fresh.x.toFixed(2)}`);
  // Puits d'un humain : le nouveau venu y est attiré comme tout autre.
  assert.ok(newbie.y < -34 - 2, `puits d'un humain : y = ${newbie.y.toFixed(2)}`);
  // Le même puits, posé par un bot : il ne l'attire plus.
  const well = [...r.state.zones.values()].find((z) => z.kind === ZoneKind.Well)!;
  well.bot = true;
  // La liste des puits du pas de mouvement est refaite à chaque tick, après
  // le déplacement : un tick pour qu'elle le sache.
  step(r, [pilot, fp, np], 1);
  place(newbie, 0, -34);
  step(r, [pilot, fp, np], 60);
  assert.ok(Math.abs(newbie.y - -34) < 0.01, `puits d'un bot : y = ${newbie.y.toFixed(2)}`);
});

test("Onde : préavis, puis recul et lames arrachées ; l'Égide les garde", () => {
  const r = new TestRoom(clock);
  const { p: vigie, pilot } = arm(r, "g", "vigie", 0, -40);
  // À 9 u : dans l'Onde (12 u), hors de portée de leurs lames.
  const { p: a, pilot: ap } = arm(r, "a", "volt", 9, -40, 20);
  const { p: b, pilot: bp } = arm(r, "b", "rempart", -9, -40, 20);
  vigie.ultPoints = 100;
  bp.send({ cast: CastSlot.Ability }); // Égide
  pilot.send({ cast: CastSlot.Ultimate });
  ap.send();
  r.tick();
  assert.ok([...r.state.zones.values()].some((z) => z.kind === ZoneKind.Shockwave));
  const ground0 = groundBlades(r.state).length;
  step(r, [pilot, ap, bp], Math.ceil((SHOCKWAVE_WINDUP_MS / 1000) * 60) + 2);
  assert.equal(r.eventsOf("shockwave").length, 1);
  assert.equal(a.bladeCount, 20 - pulseShedCount(20));
  assert.equal(b.bladeCount, 20, "Égide : rien d'arraché");
  assert.ok(groundBlades(r.state).length >= ground0 + pulseShedCount(20));
  assert.ok(a.x > 9, "repoussé");
});

test("Égide : un lancer ne brise pas la lame qu'il touche", () => {
  for (const aegis of [false, true]) {
    const r = new TestRoom(clock);
    const { p: rempart, pilot } = arm(r, "r", "rempart", 0, -40, 8);
    const { pilot: tp } = arm(r, "t", "volt", 20, -40, 8);
    if (aegis) pilot.send({ cast: CastSlot.Ability });
    else pilot.send();
    tp.send({ throw: true, aimX: -1, aimY: 0 });
    r.tick();
    step(r, [pilot, tp], 40);
    assert.equal(rempart.bladeCount, aegis ? 8 : 7, aegis ? "sous Égide" : "sans Égide");
    assert.equal(rempart.alive, true);
  }
});

test("Bastion : pas de recul de l'Onde", () => {
  const r = new TestRoom(clock);
  const { p: vigie, pilot } = arm(r, "g", "vigie", 0, -40);
  const { p: wall, pilot: wp } = arm(r, "w", "rempart", 9, -40, 10);
  vigie.ultPoints = 100;
  wall.ultPoints = 100;
  wp.send({ cast: CastSlot.Ultimate });
  pilot.send({ cast: CastSlot.Ultimate });
  r.tick();
  step(r, [pilot, wp], 50);
  assert.equal(wall.agentEffect, AgentEffect.Bastion);
  assert.ok(Math.abs(wall.x - 9) < 0.05, "pas repoussé");
  assert.equal(wall.bladeCount, 10);
});

test("protections : ni allié ni joueur protégé touché", () => {
  const r = new TestRoom(clock, { mode: "tdm", code: "TEAMS" });
  const { p: vigie, pilot } = arm(r, "g", "vigie", 0, -40);
  const { p: mate, pilot: mp } = arm(r, "m", "volt", 9, -40, 20);
  mate.team = vigie.team;
  const { p: fresh, pilot: fp } = arm(r, "f", "volt", -9, -40, 20);
  fresh.team = vigie.team === 1 ? 2 : 1;
  fresh.spawnProtectionUntil = Date.now() + 5000;
  vigie.ultPoints = 100;
  pilot.send({ cast: CastSlot.Ultimate });
  r.tick();
  step(r, [pilot, mp, fp], 50);
  assert.equal(mate.bladeCount, 20);
  assert.equal(fresh.bladeCount, 20);
});

test("bots : chacun a un agent, et ils lancent leurs capacités", () => {
  const r = new TestRoom(clock, { bots: true });
  r.join("h");
  r.tick(60 * 90);
  const bots = [...r.state.players.values()].filter((p) => p.isBot);
  assert.ok(bots.length > 5);
  assert.ok(bots.every((b) => b.agent !== ""));
  const casts = r.eventsOf("abilityCast");
  const agents = new Set(casts.map((c) => c.agent));
  assert.ok(casts.length >= 10, `${casts.length} capacités en 90 s`);
  assert.ok(agents.size >= 3, `agents vus : ${[...agents].join(", ")}`);
});

// Un nouveau venu (débutant, ou dans les 50 s qui suivent son apparition)
// que poursuit un bot n'est la cible d'aucune capacité : la poursuite reste
// celle d'avant les agents.
test("bots : aucune capacité contre un nouveau venu", () => {
  const r = new TestRoom(clock);
  const bots = (r.room as any).bots;
  const newbie = r.join("n", {}, { newcomer: true });
  const vet = r.join("v");
  const bot: Player = bots.spawnBot(r.state, { x: 0, y: -40 });
  r.room.abilities.setAgent(bot, "volt");
  // L'état d'un bot naît à sa première décision (room sans bots : le
  // contrôleur n'est pas appelé par le tick).
  bots.update(1 / 60, r.state);
  // Un bond ne part que vers une cible pas plus grosse que soi.
  for (let i = 0; i < 10; i++) giveBlade(r.state, bot);
  bot.abilityReadyAt = 0;
  place(bot, 0, -40);
  const st = bots.state.get(bot.id);
  st.actionType = "chase";
  const random = Math.random;
  Math.random = () => 0;
  try {
    for (const [target, spared] of [[newbie, true], [vet, false]] as const) {
      place(target, 10, -40);
      st.currentTargetId = target.id;
      bot.botCast = null;
      bots.planCast(bot, r.state, st, Date.now());
      assert.equal(bot.botCast === null, spared, `${target.id} : ${JSON.stringify(bot.botCast)}`);
      place(target, 60, 60);
    }
    // Rampe de grâce d'un joueur qui revient : épargné aussi.
    vet.graceRampUntil = Date.now() + 20_000;
    place(vet, 10, -40);
    bot.botCast = null;
    bots.planCast(bot, r.state, st, Date.now());
    assert.equal(bot.botCast, null);
  } finally {
    Math.random = random;
  }
});

// Joueur local soumis aux capacités d'un autre : rejouer ses inputs avec
// l'état reçu (ralentissement) et les zones reçues (puits) doit retomber sur
// la position du serveur. Renvoie la plus grande correction.
function predictUnder(
  setup: (r: TestRoom) => { me: Player; pilot: Pilot; other: Pilot; script: (tick: number) => void },
  move: (tick: number) => MoveInput,
  ticks: number,
): { worst: number; me: Player } {
  const r = new TestRoom(clock);
  const { me, pilot, other, script } = setup(r);
  const predictor = new InputPredictor();
  predictor.selfId = me.id;
  const LAT = 4;
  const uplink: Array<{ at: number; msg: object }> = [];
  const downlink: Array<{ at: number; ack: AckState; wells: any[] }> = [];
  let worst = 0;
  for (let tick = 0; tick < ticks; tick++) {
    script(tick);
    if (tick !== 0) other.send();
    const input = move(tick);
    pilot.seq++;
    predictor.push(pilot.seq, input);
    uplink.push({ at: tick + LAT, msg: { ...input, seq: pilot.seq } });
    while (uplink.length && uplink[0].at <= tick) r.room.handleInput({ sessionId: me.id, leave: () => {} }, uplink.shift()!.msg);
    r.tick();
    const wells = [...r.state.zones.values()].filter((z) => z.kind === ZoneKind.Well)
      .map((z) => ({ x: z.x, y: z.y, radius: z.radius, startsAt: z.startsAt, endsAt: z.endsAt, ownerId: z.ownerId, team: z.team, bot: z.bot }));
    downlink.push({
      at: tick + LAT,
      wells,
      ack: {
        seq: me.lastSeq, x: Math.fround(me.x), y: Math.fround(me.y),
        knockbackVx: Math.fround(me.knockbackVx), knockbackVy: Math.fround(me.knockbackVy),
        serverTime: r.state.serverTime, speedUntil: me.speedUntil, hitlagUntil: me.hitlagUntil, bladeCount: me.bladeCount,
        slowUntil: me.slowUntil, agentEffect: me.agentEffect, agentEffectUntil: me.agentEffectUntil,
        spawnProtectionUntil: me.spawnProtectionUntil, botSpareUntil: me.botSpareUntil,
      },
    });
    while (downlink.length && downlink[0].at <= tick) {
      const d = downlink.shift()!;
      predictor.wells = d.wells;
      const c = predictor.reconcile(d.ack);
      worst = Math.max(worst, Math.hypot(c.dx, c.dy));
    }
  }
  return { worst, me };
}

test("Singularité : la prédiction du joueur attiré suit le serveur", () => {
  // Le puits n'agit qu'après son préavis (0,5 s) : le client l'a reçu avant.
  const { worst, me } = predictUnder((r) => {
    const { p: vortex, pilot: vp } = arm(r, "v", "vortex", -14, -40);
    const { p: me, pilot } = arm(r, "e", "volt", 2, -40);
    vortex.ultPoints = 100;
    return { me, pilot, other: vp, script: (t) => { if (t === 0) vp.send({ cast: CastSlot.Ultimate, castX: 14, castY: 0 }); } };
  }, (t) => ({ dx: t < 120 ? 1 : 0, dy: 0, boost: false }), 300);
  assert.ok(worst < 0.01, `plus grande correction : ${worst.toFixed(4)} u`);
  assert.ok(me.x < 2 + 11 * 2 - 3, "freiné par le puits");
});

test("Piège : le ralentissement est rejoué ; seul le pas où il se referme est corrigé", () => {
  const { worst, me } = predictUnder((r) => {
    const { p: vortex, pilot: vp } = arm(r, "v", "vortex", 0, -40);
    const { p: me, pilot } = arm(r, "e", "volt", -16, -40);
    // Posé, Vortex s'écarte : on ne mesure que le piège.
    return { me, pilot, other: vp, script: (t) => {
      if (t === 0) vp.send({ cast: CastSlot.Ability });
      if (t === 1) place(vortex, 0, -70);
    } };
  }, () => ({ dx: 1, dy: 0, boost: false }), 240);
  assert.ok(me.slowUntil > 0, "le piège s'est refermé");
  // Le serveur apprend le piège avant le client : les pas déjà prédits à
  // pleine vitesse sont corrigés une fois (8 pas de 0,07 u au plus).
  assert.ok(worst < 0.7, `plus grande correction : ${worst.toFixed(3)} u`);
});
