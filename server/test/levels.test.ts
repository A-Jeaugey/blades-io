// Niveaux de compte (tâche 5.2) : XP = trophées gagnés en room publique.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { levelForXp, levelProgress, titleForLevel, xpForLevel } from "@bladeio/shared";
import * as matches from "../src/auth/matches";
import * as wallet from "../src/auth/wallet";
import * as supabase from "../src/auth/supabase";
import * as guestToken from "../src/auth/guestToken";
import * as telemetry from "../src/telemetry";
import { FakeClock, seedRandom } from "./helpers";
import { TestRoom } from "./testRoom";

let clock: FakeClock;
let restoreRandom: () => void;
const saved: Record<string, any> = {};

beforeEach(() => {
  clock = new FakeClock();
  restoreRandom = seedRandom(5);
  // Aucun appel Supabase.
  saved.recordLife = telemetry.recordLife;
  saved.recordMatch = matches.recordMatch;
  saved.creditWallet = wallet.creditWallet;
  saved.creditGuestWallet = wallet.creditGuestWallet;
  saved.getWallet = wallet.getWallet;
  saved.getGuestWalletBalance = wallet.getGuestWalletBalance;
  saved.verifyAccessToken = supabase.verifyAccessToken;
  saved.verifyGuestToken = guestToken.verifyGuestToken;
  (telemetry as any).recordLife = () => {};
  (matches as any).recordMatch = async () => {};
  (wallet as any).creditWallet = async () => {};
  (wallet as any).creditGuestWallet = async () => {};
});
afterEach(() => {
  clock.restore();
  restoreRandom();
  (telemetry as any).recordLife = saved.recordLife;
  (matches as any).recordMatch = saved.recordMatch;
  (wallet as any).creditWallet = saved.creditWallet;
  (wallet as any).creditGuestWallet = saved.creditGuestWallet;
  (wallet as any).getWallet = saved.getWallet;
  (wallet as any).getGuestWalletBalance = saved.getGuestWalletBalance;
  (supabase as any).verifyAccessToken = saved.verifyAccessToken;
  (guestToken as any).verifyGuestToken = saved.verifyGuestToken;
});

test("courbe : niveau 2 à 60 XP, inverse exacte, chaque niveau plus long que le précédent", () => {
  assert.equal(xpForLevel(1), 0);
  assert.equal(xpForLevel(2), 60);
  let previousGap = 0;
  for (let level = 2; level <= 200; level++) {
    assert.equal(levelForXp(xpForLevel(level)), level);
    assert.equal(levelForXp(xpForLevel(level) - 1), level - 1);
    const gap = xpForLevel(level + 1) - xpForLevel(level);
    assert.ok(gap > previousGap, `niveau ${level}`);
    previousGap = gap;
  }
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(-5), 1);
  assert.equal(levelForXp(Number.NaN), 1);
});

test("progression dans le niveau et titres par paliers", () => {
  const p = levelProgress(xpForLevel(5) + 10);
  assert.equal(p.level, 5);
  assert.equal(p.current, 10);
  assert.equal(p.needed, xpForLevel(6) - xpForLevel(5));
  assert.equal(titleForLevel(1), "recruit");
  assert.equal(titleForLevel(9), "blade");
  assert.equal(titleForLevel(10), "duelist");
  assert.equal(titleForLevel(500), "myth");
});

test("join : niveau tiré de l'XP ; un bot n'a pas de niveau", () => {
  const r = new TestRoom(clock);
  const a = r.join("a", { userId: "u1", xp: xpForLevel(7) + 3 });
  assert.equal(a.level, 7);
  const bot = (r.room as any).bots.spawnBot(r.state, { x: 10, y: 10 });
  assert.equal(bot.level, 0);
});

test("fin de vie publique : les trophées crédités font monter le niveau", () => {
  const r = new TestRoom(clock);
  const a = r.join("a", { userId: "u1", xp: 50 });
  assert.equal(a.level, 1);
  a.score = 20;
  r.room.killPlayer(a, null, "wall");
  assert.equal(a.xp, 70);
  assert.equal(a.level, 2);
  // Invité avec portefeuille : même chose.
  const g = r.join("g", { guestId: "g1", xp: 10 });
  g.score = 55;
  r.room.killPlayer(g, null, "wall");
  assert.equal(g.xp, 65);
  assert.equal(g.level, 2);
});

test("room privée ou invité sans portefeuille : pas d'XP", () => {
  const priv = new TestRoom(clock, { code: "ABCDE" });
  const f = priv.join("f", { userId: "u2", xp: 50 });
  f.score = 40;
  priv.room.killPlayer(f, null, "wall");
  assert.equal(f.xp, 50);
  const pub = new TestRoom(clock);
  const g = pub.join("g");
  g.score = 40;
  pub.room.killPlayer(g, null, "wall");
  assert.equal(g.xp, 0);
  assert.equal(g.level, 1);
});

test("onAuth : XP du compte (trophées gagnés, achats non déduits) ou du portefeuille invité", async () => {
  const r = new TestRoom(clock);
  (supabase as any).verifyAccessToken = async () => ({ id: "u1", email: null, username: "Alpha" });
  (wallet as any).getWallet = async () => ({ balance: 10, total_earned: 900 });
  const account = await r.room.onAuth({} as any, { token: "t" });
  assert.equal(account.xp, 900);

  (guestToken as any).verifyGuestToken = () => "g1";
  (wallet as any).getGuestWalletBalance = async () => ({ balance: 120, claimed: false });
  const guest = await r.room.onAuth({} as any, { guestToken: "x" });
  assert.equal(guest.xp, 120);
  // Portefeuille déjà rattaché à un compte : son XP est sur le compte.
  (wallet as any).getGuestWalletBalance = async () => ({ balance: 0, claimed: true });
  assert.equal((await r.room.onAuth({} as any, { guestToken: "x" })).xp, 0);
});
