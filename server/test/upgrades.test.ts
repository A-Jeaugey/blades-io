// Améliorations des power-ups (QUÊTES › AMÉLIORATIONS, retours du
// 2026-10-12) : catalogue, achat dans l'ordre, niveaux posés au join et
// durée effective d'un power-up ramassé.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import {
  BladeRarity,
  GAME_MODES,
  POWERUP_UPGRADE_MAX_LEVEL,
  PowerUpType,
  SHOP_ITEMS,
  UPGRADABLE_POWERUPS,
  UPGRADE_PRICES,
  featuredItems,
  getShopItem,
  parseUpgradeItem,
  powerUpDurationMs,
  priceToday,
  shopOffer,
  upgradeItemId,
  upgradeLevelsFromInventory,
  upgradeOrderProblem,
} from "@bladeio/shared";
import * as supabase from "../src/auth/supabase";
import * as wallet from "../src/auth/wallet";
import { buildAuthRouter } from "../src/auth/routes";
import { quotePurchase } from "../src/auth/shopQuote";
import { PowerUp } from "../src/state/PowerUp";
import { FakeClock, seedRandom } from "./helpers";
import { TestRoom } from "./testRoom";

const SPEED = PowerUpType.Speed;
const chain = (type: PowerUpType, n: number) => Array.from({ length: n }, (_, i) => upgradeItemId(type, i + 1));

test("catalogue : vingt niveaux par power-up à durée, prix croissants relus dans SHOP_ITEMS", () => {
  const upgrades = Object.values(SHOP_ITEMS).filter((i) => i.kind === "upgrade");
  assert.equal(upgrades.length, UPGRADABLE_POWERUPS.length * POWERUP_UPGRADE_MAX_LEVEL);
  assert.equal(UPGRADE_PRICES.length, POWERUP_UPGRADE_MAX_LEVEL);
  for (const type of UPGRADABLE_POWERUPS) {
    let total = 0;
    for (let level = 1; level <= POWERUP_UPGRADE_MAX_LEVEL; level++) {
      const item = getShopItem(upgradeItemId(type, level))!;
      assert.equal(item.kind, "upgrade");
      assert.equal(item.price, UPGRADE_PRICES[level - 1]);
      if (level > 1) assert.ok(item.price > UPGRADE_PRICES[level - 2], `niveau ${level} pas plus cher`);
      assert.deepEqual(parseUpgradeItem(item.id), { type, level });
      total += item.price;
    }
    // Courbe annoncée en commentaire (upgrades.ts) : une vie pour le premier
    // niveau, ~700 pour le dernier, ~4 400 pour tout.
    assert.equal(total, 4405);
    assert.ok(UPGRADE_PRICES[0] >= 30 && UPGRADE_PRICES[0] <= 50);
    assert.ok(UPGRADE_PRICES[19] >= 600 && UPGRADE_PRICES[19] <= 900);
  }
  // Ni au-delà de 20, ni niveau 0, ni Blades (instantané), ni forme approchée.
  for (const id of ["upgrade.speed.21", "upgrade.speed.0", "upgrade.speed.01", "upgrade.blades.1", "upgrade.speed", "upgrade.__proto__.1", "upgrade.speed.1 "]) {
    assert.equal(getShopItem(id), undefined, id);
    assert.equal(parseUpgradeItem(id), null, id);
  }
});

test("vitrine : jamais d'amélioration à la une, jamais de remise", () => {
  for (let i = 0; i < 400; i++) {
    const day = new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);
    for (const id of featuredItems(day)) assert.notEqual(getShopItem(id)!.kind, "upgrade", `${day} : ${id}`);
  }
  // Même glissée dans une vitrine, une amélioration garde son prix.
  const now = new Date("2026-10-12T10:00:00Z");
  const offer = shopOffer(now);
  const id = upgradeItemId(PowerUpType.Shield, 7);
  assert.equal(priceToday(id, { ...offer, featured: [...offer.featured, id] }), UPGRADE_PRICES[6]);
  // Achat : prix du catalogue ; un prix affiché périmé est refusé sans débit.
  const q = quotePurchase({ item_id: id, price: 0 }, now);
  assert.ok(q.ok && q.price === UPGRADE_PRICES[6] && q.item.kind === "upgrade");
  assert.deepEqual(quotePurchase({ item_id: id, expected_price: 1 }, now), { ok: false, status: 409, error: "price_changed", price: UPGRADE_PRICES[6] });
  assert.deepEqual(quotePurchase({ item_id: "upgrade.spin.21" }, now), { ok: false, status: 400, error: "invalid_item" });
});

test("niveaux : la suite des niveaux possédés depuis le premier ; achat dans l'ordre", () => {
  assert.deepEqual(upgradeLevelsFromInventory([]), [0, 0, 0, 0, 0]);
  const owned = [...chain(SPEED, 3), ...chain(PowerUpType.Magnet, 20), "upgrade.shield.2", "robot", "sanctuaire"];
  // Un trou (bouclier 2 sans le 1) ne compte pas.
  assert.deepEqual(upgradeLevelsFromInventory(owned), [3, 0, 20, 0, 0]);
  assert.equal(upgradeOrderProblem(upgradeItemId(SPEED, 4), owned), null);
  assert.equal(upgradeOrderProblem(upgradeItemId(SPEED, 5), owned), "upgrade_order");
  assert.equal(upgradeOrderProblem(upgradeItemId(PowerUpType.Spin, 1), owned), null);
  assert.equal(upgradeOrderProblem(upgradeItemId(PowerUpType.Spin, 2), owned), "upgrade_order");
  assert.equal(upgradeOrderProblem(upgradeItemId(PowerUpType.Shield, 3), owned), "upgrade_order");
  // Déjà possédé : la base répond already_owned, sans débit.
  assert.equal(upgradeOrderProblem(upgradeItemId(SPEED, 2), owned), null);
  // Les autres articles ne sont pas concernés.
  assert.equal(upgradeOrderProblem("robot", []), null);
});

// Route d'achat de bout en bout (express), base remplacée.
test("POST /api/wallet/purchase : niveau n refusé sans le n − 1, prix du catalogue débité", async () => {
  const saved = {
    configured: supabase.isSupabaseConfigured,
    verify: supabase.verifyAccessToken,
    inventory: wallet.getInventory,
    purchase: wallet.purchaseItem,
  };
  let inventory: string[] = [];
  const debits: Array<[string, string, number]> = [];
  (supabase as any).isSupabaseConfigured = () => true;
  (supabase as any).verifyAccessToken = async (token: string | null) => (token === "ok" ? { id: "u1", email: null, username: "Alpha" } : null);
  (wallet as any).getInventory = async () => [...inventory];
  (wallet as any).purchaseItem = async (userId: string, itemId: string, price: number) => {
    debits.push([userId, itemId, price]);
    inventory.push(itemId);
    return { ok: true, new_balance: 1000 - price };
  };
  const app = express();
  app.use(express.json());
  app.use("/api", buildAuthRouter());
  const server = app.listen(0);
  try {
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/wallet/purchase`;
    const buy = async (body: unknown, token: string | null = "ok") => {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      return { status: r.status, body: (await r.json()) as any };
    };
    // Invité : pas d'achat.
    assert.equal((await buy({ item_id: upgradeItemId(SPEED, 1) }, null)).status, 401);
    // Niveau 2 sans le 1 : refusé, rien débité.
    assert.deepEqual(await buy({ item_id: upgradeItemId(SPEED, 2), expected_price: UPGRADE_PRICES[1] }), { status: 400, body: { error: "upgrade_order" } });
    assert.equal(debits.length, 0);
    // Dans l'ordre : le prix débité est celui du catalogue, pas celui envoyé.
    assert.equal((await buy({ item_id: upgradeItemId(SPEED, 1), price: 0 })).status, 200);
    assert.equal((await buy({ item_id: upgradeItemId(SPEED, 2), expected_price: UPGRADE_PRICES[1] })).status, 200);
    assert.deepEqual(debits, [["u1", "upgrade.speed.1", UPGRADE_PRICES[0]], ["u1", "upgrade.speed.2", UPGRADE_PRICES[1]]]);
    // Prix affiché faux : refusé avant même la lecture de l'inventaire.
    assert.equal((await buy({ item_id: upgradeItemId(SPEED, 3), expected_price: 1 })).status, 409);
    // Au-delà de 20 : inconnu du catalogue, même avec les vingt niveaux.
    inventory = chain(SPEED, 20);
    assert.deepEqual(await buy({ item_id: "upgrade.speed.21" }), { status: 400, body: { error: "invalid_item" } });
    // Inventaire illisible (lecture best-effort : liste vide) : refusé.
    inventory = [];
    assert.equal((await buy({ item_id: upgradeItemId(PowerUpType.Spin, 5) })).body.error, "upgrade_order");
    assert.equal(debits.length, 2);
  } finally {
    server.close();
    (supabase as any).isSupabaseConfigured = saved.configured;
    (supabase as any).verifyAccessToken = saved.verify;
    (wallet as any).getInventory = saved.inventory;
    (wallet as any).purchaseItem = saved.purchase;
  }
});

let clock: FakeClock;
let restoreRandom: () => void;
beforeEach(() => {
  clock = new FakeClock();
  restoreRandom = seedRandom(12);
});
afterEach(() => {
  clock.restore();
  restoreRandom();
});

function join(r: TestRoom, id: string, auth: { userId?: string | null; guestId?: string | null; owned?: string[] }) {
  r.room.onJoin({ sessionId: id }, {}, { userId: auth.userId ?? null, username: null, guestId: auth.guestId ?? null, name: id, xp: 0, owned: auth.owned ?? [] });
  return r.state.players.get(id)!;
}

test("join : niveaux tirés de l'inventaire du compte ; invité, bot et mode sans améliorations à 0", () => {
  const owned = [...chain(SPEED, 10), ...chain(PowerUpType.Shield, 20), "upgrade.spin.4"];
  const r = new TestRoom(clock, { bots: true });
  const acc = join(r, "acc", { userId: "u1", owned });
  assert.deepEqual(acc.powerUpLevels, [10, 0, 0, 20, 0]);
  // Gardés d'une vie à l'autre (même Player à la réapparition).
  acc.spawnProtectionUntil = 0;
  r.room.killPlayer(acc, null, "wall");
  r.room.handleRespawn({ sessionId: "acc", leave: () => {} }, {});
  assert.ok(acc.alive);
  assert.deepEqual(acc.powerUpLevels, [10, 0, 0, 20, 0]);
  // Un invité n'a pas d'inventaire ; même si on lui en passait un, rien.
  assert.deepEqual(join(r, "guest", { guestId: "g1", owned }).powerUpLevels, [0, 0, 0, 0, 0]);
  r.tick(2);
  const bots = [...r.state.players.values()].filter((p) => p.isBot);
  assert.ok(bots.length > 0);
  for (const b of bots) assert.deepEqual(b.powerUpLevels, [0, 0, 0, 0, 0]);
  // Mode où tout le monde part à égalité (mode classé, GameModeInfo.upgrades).
  const ffa = GAME_MODES.find((m) => m.id === "ffa")! as { upgrades: boolean };
  ffa.upgrades = false;
  try {
    const flat = new TestRoom(clock);
    assert.deepEqual(join(flat, "acc", { userId: "u1", owned }).powerUpLevels, [0, 0, 0, 0, 0]);
  } finally {
    ffa.upgrades = true;
  }
});

test("ramassage : la durée suit le niveau d'amélioration du joueur (powerUpDurationMs)", () => {
  const r = new TestRoom(clock);
  const vet = join(r, "vet", { userId: "u1", owned: [...chain(SPEED, 12), ...chain(PowerUpType.Magnet, 20)] });
  const rookie = join(r, "rookie", { userId: "u2", owned: [] });
  vet.x = -60; vet.y = 0;
  rookie.x = 60; rookie.y = 0;
  const drop = (id: string, type: PowerUpType, rarity: BladeRarity, at: { x: number; y: number }) => {
    const pu = new PowerUp();
    pu.id = id;
    pu.type = type;
    pu.rarity = rarity;
    pu.x = at.x;
    pu.y = at.y;
    r.state.powerups.set(pu.id, pu);
  };
  drop("a", SPEED, BladeRarity.Epic, vet);
  drop("b", SPEED, BladeRarity.Epic, rookie);
  drop("c", PowerUpType.Magnet, BladeRarity.Legendary, vet);
  r.tick();
  for (const id of ["a", "b", "c"]) assert.ok(!r.state.powerups.has(id), `${id} pas ramassé`);
  assert.equal(vet.speedUntil, clock.now + powerUpDurationMs(SPEED, BladeRarity.Epic, 12));
  assert.equal(rookie.speedUntil, clock.now + powerUpDurationMs(SPEED, BladeRarity.Epic, 0));
  assert.equal(vet.magnetUntil, clock.now + powerUpDurationMs(PowerUpType.Magnet, BladeRarity.Legendary, 20));
  // +2,5 % par niveau, +50 % au niveau 20 (à l'arrondi de la milliseconde).
  assert.ok(vet.speedUntil - clock.now > rookie.speedUntil - clock.now);
  const base = powerUpDurationMs(SPEED, BladeRarity.Epic, 0);
  assert.ok(Math.abs(powerUpDurationMs(SPEED, BladeRarity.Epic, 20) - base * 1.5) <= 1);
});
