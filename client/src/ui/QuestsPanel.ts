import {
  BladeRarity,
  COSMETICS,
  ChallengeState,
  ChallengesResponse,
  CosmeticSlot,
  GAME_MODES,
  LEVEL_TITLES,
  POWERUP_UPGRADE_MAX_LEVEL,
  POWERUP_UPGRADE_STEP,
  PowerUpType,
  UPGRADABLE_POWERUPS,
  UPGRADE_SLUGS,
  levelProgress,
  powerUpDurationMs,
  upgradeItemId,
  upgradeLevelOf,
  upgradePrice,
  xpForLevel,
} from "@bladeio/shared";
import { auth } from "../auth/supabase";
import { wallet } from "../auth/wallet";
import { fetchGuestWallet } from "../auth/guestToken";
import { grantOwnership, listOwned, mergeServerInventory } from "../boutique/owned";
import { getActiveTheme } from "../themes";
import { I18nKey, cosmeticName, formatNumber, gameModeName, onLangChange, t } from "../i18n";
import { challengeText, fetchChallenges, formatCountdown } from "./challenges";
import { levelText, titleName } from "./level";
import { renderQuestsBadge } from "./questsEntry";
import { showAlert } from "./Dialog";

// Panneau QUÊTES (retours du 2026-10-12), chargé à sa première ouverture
// (questsEntry.ts) :
// - DÉFIS : défis du jour et de la semaine (tâche 5.3), venus du profil ;
// - NIVEAUX : niveau du compte, ou de l'appareil pour un invité (5.2), et la
//   piste des récompenses de niveau (cosmétiques de 6.2, titres) ;
// - AMÉLIORATIONS : durée des power-ups, achetée niveau par niveau en
//   trophées (shared/src/upgrades.ts). Les durées affichées viennent de
//   powerUpDurationMs, celle que le serveur applique : jamais de nombre en
//   dur ici, le rééquilibrage des power-ups s'y reflète tout seul.

type QuestTab = "challenges" | "levels" | "upgrades";
const TABS: readonly QuestTab[] = ["challenges", "levels", "upgrades"];

const RARITIES = [BladeRarity.Common, BladeRarity.Rare, BladeRarity.Epic, BladeRarity.Legendary] as const;
const RARITY_KEY: Record<BladeRarity, I18nKey> = {
  [BladeRarity.Common]: "upg.common",
  [BladeRarity.Rare]: "upg.rare",
  [BladeRarity.Epic]: "upg.epic",
  [BladeRarity.Legendary]: "upg.legendary",
};

// Nom et effet de chaque power-up améliorable : clés écrites en entier, que
// le compilateur vérifie dans en.ts et fr.ts.
const UPGRADE_TEXT: Partial<Record<PowerUpType, { name: I18nKey; desc: I18nKey }>> = {
  [PowerUpType.Speed]: { name: "upg.speed", desc: "upg.speed.desc" },
  [PowerUpType.Spin]: { name: "upg.spin", desc: "upg.spin.desc" },
  [PowerUpType.Magnet]: { name: "upg.magnet", desc: "upg.magnet.desc" },
  [PowerUpType.Shield]: { name: "upg.shield", desc: "upg.shield.desc" },
};
const upgradeName = (type: PowerUpType) => {
  const key = UPGRADE_TEXT[type]?.name;
  return key ? t(key) : UPGRADE_SLUGS[type];
};

// Sorte d'une récompense de niveau ; un nouvel emplacement de cosmétique
// demande sa clé (le compilateur l'exige ici).
const REWARD_KIND: Record<CosmeticSlot | "title", I18nKey> = {
  skin: "quests.reward.skin",
  bladeSkin: "quests.reward.bladeSkin",
  trail: "quests.reward.trail",
  killFx: "quests.reward.killFx",
  title: "quests.reward.title",
};

const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");

// Formes des power-ups au sol (entities/PowerUpView.ts), redessinées en SVG
// (axe y retourné) : la couleur seule ne suffit pas à les reconnaître.
function spinPath(): string {
  const pt = (a: number, r: number) => `${(Math.cos(a) * r).toFixed(3)} ${(-Math.sin(a) * r).toFixed(3)}`;
  const a0 = 0.5, a1 = Math.PI * 1.75, ro = 0.85, ri = 0.55;
  return `M${pt(a0, ro)} A${ro} ${ro} 0 1 0 ${pt(a1, ro)} L${pt(a1, ri)} A${ri} ${ri} 0 1 1 ${pt(a0, ri)} Z ` +
    `M${pt(a0, 0.35)} L${pt(a0, 1.05)} L${pt(a0 - 0.55, 0.7)} Z`;
}
const SHAPES: Partial<Record<PowerUpType, string>> = {
  [PowerUpType.Speed]: "M-0.2 -0.65 L0.2 -0.65 L0.7 0 L0.2 0.65 L-0.2 0.65 L0.3 0 Z M-0.8 -0.65 L-0.4 -0.65 L0.1 0 L-0.4 0.65 L-0.8 0.65 L-0.3 0 Z",
  [PowerUpType.Spin]: spinPath(),
  [PowerUpType.Magnet]: "M-0.8 -0.65 L-0.8 0 A0.8 0.8 0 0 0 0.8 0 L0.8 -0.65 L0.42 -0.65 L0.42 0 A0.42 0.42 0 0 1 -0.42 0 L-0.42 -0.65 Z",
  [PowerUpType.Shield]: "M-0.7 -0.75 L0.7 -0.75 Q0.78 0.2 0 0.95 Q-0.78 0.2 -0.7 -0.75 Z",
};

function powerUpIcon(type: PowerUpType): HTMLElement {
  const icon = document.createElement("span");
  icon.className = "upg-icon";
  icon.setAttribute("aria-hidden", "true");
  const color = getActiveTheme().palette.powerUpColor[type];
  icon.style.setProperty("--c", hex(color));
  icon.innerHTML = `<svg viewBox="-1.1 -1.1 2.2 2.2"><path d="${SHAPES[type] ?? ""}"/></svg>`;
  return icon;
}

// « 9,4 s », « 12 s ».
function seconds(ms: number): string {
  const s = ms / 1000;
  return t("upg.seconds", { s: formatNumber(s, Number.isInteger(s) ? 0 : 1) });
}

// Bonus de durée d'un niveau, en pourcentage (« 17,5 », « 20 »).
function bonusPct(level: number): string {
  const pct = Math.round(level * POWERUP_UPGRADE_STEP * 1000) / 10;
  return formatNumber(pct, Number.isInteger(pct) ? 0 : 1);
}

// Une ligne de défi : texte, récompense, barre et « 12 / 20 » (ou réussi).
function challengeRow(c: ChallengeState): HTMLLIElement {
  const li = document.createElement("li");
  li.className = c.completed ? "challenge done" : "challenge";
  const name = document.createElement("span");
  name.className = "challenge-name";
  name.textContent = challengeText(c);
  const reward = document.createElement("span");
  reward.className = "challenge-reward";
  reward.textContent = `🏆 ${c.reward}`;
  const bar = document.createElement("i");
  bar.className = "challenge-bar";
  bar.style.setProperty("--p", Math.min(1, c.progress / c.target).toFixed(3));
  const progress = document.createElement("span");
  progress.className = "challenge-progress";
  const shown = c.metric === "survivalTotal" || c.metric === "lifeSurvival"
    ? `${Math.floor(c.progress / 60)} / ${Math.round(c.target / 60)} min`
    : `${c.progress} / ${c.target}`;
  progress.textContent = c.completed ? `✓ ${t("profile.challengeDone")}` : shown;
  li.append(name, reward, bar, progress);
  return li;
}

// Récompenses d'un niveau : titres (5.2) et cosmétiques débloqués (6.2).
interface LevelReward {
  level: number;
  items: Array<{ kind: CosmeticSlot | "title"; name: string }>;
}

function levelRewards(): LevelReward[] {
  const byLevel = new Map<number, LevelReward>();
  const at = (level: number) => {
    let r = byLevel.get(level);
    if (!r) byLevel.set(level, (r = { level, items: [] }));
    return r;
  };
  // Le titre du niveau 1 est celui de départ : pas une récompense.
  for (const title of LEVEL_TITLES) if (title.level > 1) at(title.level).items.push({ kind: "title", name: titleName(title.level) });
  for (const def of Object.values(COSMETICS)) {
    if (def.level !== undefined) at(def.level).items.push({ kind: def.slot, name: cosmeticName(def.slot, def.id) });
  }
  return [...byLevel.values()].sort((a, b) => a.level - b.level);
}

export class QuestsPanel {
  private root: HTMLElement;
  private tab: QuestTab = "challenges";
  private challenges: ChallengesResponse | null = null;
  private challengesState: "loading" | "ready" | "failed" = "loading";
  // XP : trophées gagnés du compte, solde du portefeuille invité sinon.
  private xp: number | null = null;
  private guestBalance: number | null = null;
  // Inventaire du compte relu à l'ouverture : les niveaux d'amélioration
  // qu'appliquera le serveur (l'appareil peut garder les achats d'un autre
  // compte, cf. boutique/owned.ts). null : pas encore lu.
  private inventory: Set<string> | null = null;
  // Compte dont l'inventaire est en mémoire (changement de compte : relu).
  private owner: string | null = null;
  private pending: string | null = null;
  // Dernier achat : la carte s'illumine une fois, le texte est annoncé.
  private justBought: string | null = null;
  private request = 0;
  private unsubs: Array<() => void> = [];
  private timer = 0;

  constructor() {
    this.root = document.getElementById("quests") as HTMLElement;
    this.root.querySelectorAll<HTMLElement>("[data-close]").forEach((el) => el.addEventListener("click", () => this.close()));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.root.classList.contains("hidden")) this.close();
    });
    this.root.querySelectorAll<HTMLButtonElement>(".quests-tabs [data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => this.switchTab(btn.dataset.tab as QuestTab));
      // Flèches gauche/droite entre onglets (motif d'onglets ARIA).
      btn.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const next = TABS[(TABS.indexOf(this.tab) + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
        this.switchTab(next);
        this.root.querySelector<HTMLButtonElement>(`.quests-tabs [data-tab="${next}"]`)?.focus();
      });
    });
    this.root.querySelector("#upg-signin")?.addEventListener("click", () => this.signIn());
    onLangChange(() => {
      if (!this.root.classList.contains("hidden")) this.render();
    });
  }

  open(): void {
    this.root.classList.remove("hidden");
    this.root.setAttribute("aria-hidden", "false");
    this.justBought = null;
    this.switchTab(this.tab);
    // Solde, XP et inventaire suivis tant que le panneau est ouvert.
    this.unsubs.push(wallet.subscribe(() => this.onWallet()));
    let first = true;
    this.unsubs.push(auth.subscribe(() => {
      // Le premier appel rejoue l'état courant : load() s'en charge.
      if (first) first = false;
      else void this.load();
    }));
    // Comptes à rebours des défis, à la minute.
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.renderChallenges(), 30000);
    void this.load();
  }

  close(): void {
    this.request++;
    this.root.classList.add("hidden");
    this.root.setAttribute("aria-hidden", "true");
    for (const u of this.unsubs.splice(0)) u();
    window.clearInterval(this.timer);
  }

  private switchTab(tab: QuestTab): void {
    this.tab = tab;
    this.root.querySelectorAll<HTMLElement>(".quests-tabs [data-tab]").forEach((btn) => {
      const on = btn.dataset.tab === tab;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", String(on));
      btn.tabIndex = on ? 0 : -1;
    });
    this.root.querySelectorAll<HTMLElement>("[data-pane]").forEach((pane) => {
      pane.hidden = pane.dataset.pane !== tab;
    });
    // Le défilement repart du haut à chaque onglet.
    const body = this.root.querySelector<HTMLElement>(".howto-body");
    if (body) body.scrollTop = 0;
  }

  private async load(): Promise<void> {
    const id = ++this.request;
    const token = auth.getAccessToken();
    const state = auth.getState();
    const owner = state.status === "signed_in" ? state.profile.id : null;
    if (owner !== this.owner) {
      this.owner = owner;
      this.inventory = null;
    }
    this.challengesState = this.challenges ? "ready" : "loading";
    this.xp = token ? wallet.get()?.total_earned ?? null : null;
    this.render();
    const [challenges, guest, items] = await Promise.all([
      fetchChallenges(),
      token ? Promise.resolve(null) : fetchGuestWallet(),
      token ? wallet.fetchInventoryOrNull() : Promise.resolve(null),
      token ? wallet.refresh() : Promise.resolve(null),
    ]);
    if (id !== this.request) return;
    if (challenges) this.challenges = challenges;
    this.challengesState = challenges ? "ready" : this.challenges ? "ready" : "failed";
    renderQuestsBadge(this.challenges);
    if (token) {
      // Serveur muet : on garde ce qu'on savait (l'appareil, au pire).
      if (items) {
        this.inventory = new Set(items);
        if (items.length > 0) mergeServerInventory(items);
      }
      this.xp = wallet.get()?.total_earned ?? this.xp;
      this.guestBalance = null;
    } else {
      // Invité : son solde est toute son XP (il ne dépense rien).
      this.guestBalance = guest && !guest.claimed ? guest.balance : 0;
      this.xp = this.guestBalance;
    }
    this.render();
  }

  private onWallet(): void {
    if (auth.getAccessToken()) this.xp = wallet.get()?.total_earned ?? this.xp;
    this.renderBalance();
    this.renderLevels();
    this.renderUpgrades();
  }

  private render(): void {
    this.renderBalance();
    this.renderChallenges();
    this.renderLevels();
    this.renderUpgrades();
  }

  private renderBalance(): void {
    const el = this.root.querySelector("#quests-balance") as HTMLElement;
    const signedIn = auth.getAccessToken() !== null;
    const balance = signedIn ? wallet.get()?.balance ?? null : this.guestBalance;
    el.textContent = balance === null ? "—" : formatNumber(balance, 0);
  }

  // ─── DÉFIS ────────────────────────────────────────────────────────────────

  private renderChallenges(): void {
    const pane = this.root.querySelector('[data-pane="challenges"]') as HTMLElement;
    const lists = pane.querySelector(".quests-challenges") as HTMLElement;
    const status = pane.querySelector("#quests-challenges-status") as HTMLElement;
    const count = this.root.querySelector("#quests-count-challenges") as HTMLElement;
    const c = this.challenges;
    lists.classList.toggle("hidden", !c);
    status.classList.toggle("hidden", !!c);
    status.textContent = this.challengesState === "failed" ? t("quests.challengesFailed") : t("profile.loading");
    if (!c) {
      count.textContent = "";
      return;
    }
    const done = c.day.challenges.filter((ch) => ch.completed).length;
    count.textContent = `${done}/${c.day.challenges.length}`;
    const now = Date.now();
    (pane.querySelector("#quests-daily-reset") as HTMLElement).textContent =
      t("profile.dailyReset", { time: formatCountdown(Date.parse(c.day.resetsAt) - now) });
    (pane.querySelector("#quests-weekly-reset") as HTMLElement).textContent =
      t("profile.weeklyReset", { time: formatCountdown(Date.parse(c.week.resetsAt) - now) });
    const daily = pane.querySelector("#quests-daily") as HTMLElement;
    const weekly = pane.querySelector("#quests-weekly") as HTMLElement;
    daily.replaceChildren(...c.day.challenges.map(challengeRow));
    weekly.replaceChildren(challengeRow(c.week.challenge));
  }

  // ─── NIVEAUX ──────────────────────────────────────────────────────────────

  private renderLevels(): void {
    const pane = this.root.querySelector('[data-pane="levels"]') as HTMLElement;
    const who = pane.querySelector("#quests-who") as HTMLElement;
    const level = pane.querySelector("#quests-level") as HTMLElement;
    const next = pane.querySelector("#quests-next") as HTMLElement;
    const track = pane.querySelector("#quests-track") as HTMLElement;
    const count = this.root.querySelector("#quests-count-levels") as HTMLElement;
    // Pseudo en textContent : rien à échapper.
    who.textContent = auth.getAccessToken() ? auth.getUsername() ?? "" : t("profile.guest");
    const xp = this.xp;
    level.classList.toggle("hidden", xp === null);
    // XP encore inconnue : la piste s'affiche, sans état.
    const current = xp === null ? 0 : levelProgress(xp).level;
    count.textContent = xp === null ? "" : t("level.short", { n: current });
    if (xp !== null) {
      const lv = levelText(xp);
      (level.querySelector(".profile-level-name") as HTMLElement).textContent = lv.full;
      (level.querySelector(".profile-level-xp") as HTMLElement).textContent = lv.xp;
      (level.querySelector(".profile-level-bar") as HTMLElement).style.setProperty("--p", lv.fraction.toFixed(3));
      (level.querySelector(".quests-level-total") as HTMLElement).textContent = t("quests.xpTotal", { xp: formatNumber(xp, 0) });
    }
    const rewards = levelRewards();
    const upcoming = rewards.find((r) => r.level > current);
    next.classList.toggle("hidden", xp === null);
    next.textContent = upcoming
      ? t("quests.nextReward", { n: upcoming.level, xp: formatNumber(Math.max(0, xpForLevel(upcoming.level) - (xp ?? 0)), 0) })
      : t("quests.allRewards");
    track.replaceChildren(...rewards.map((r) => {
      const li = document.createElement("li");
      const got = xp !== null && current >= r.level;
      const isNext = xp !== null && r === upcoming;
      li.className = `quests-step${got ? " got" : ""}${isNext ? " next" : ""}`;
      const lv = document.createElement("span");
      lv.className = "quests-step-level";
      lv.textContent = t("level.short", { n: r.level });
      const items = document.createElement("span");
      items.className = "quests-step-items";
      for (const item of r.items) {
        const chip = document.createElement("span");
        chip.className = `quests-reward quests-reward-${item.kind}`;
        const kind = document.createElement("small");
        kind.textContent = t(REWARD_KIND[item.kind]);
        chip.append(kind, " ", item.name);
        items.append(chip);
      }
      const state = document.createElement("span");
      state.className = "quests-step-state";
      state.textContent = got
        ? `✓ ${t("quests.got")}`
        : isNext ? t("quests.inXp", { xp: formatNumber(Math.max(0, xpForLevel(r.level) - (xp ?? 0)), 0) }) : "🔒";
      li.append(lv, items, state);
      return li;
    }));
  }

  // ─── AMÉLIORATIONS ────────────────────────────────────────────────────────

  // Niveaux que le serveur appliquera : inventaire du compte relu à
  // l'ouverture ; avant sa réponse, celui gardé sur l'appareil. Un invité
  // n'en a pas (il n'achète rien, le serveur lui applique le niveau 0).
  private levelOf(type: PowerUpType): number {
    if (!auth.getAccessToken()) return 0;
    return upgradeLevelOf(this.inventory ?? new Set(listOwned()), type);
  }

  private renderUpgrades(): void {
    const pane = this.root.querySelector('[data-pane="upgrades"]') as HTMLElement;
    const signedIn = auth.getAccessToken() !== null;
    (pane.querySelector("#upg-intro") as HTMLElement).textContent = t("upg.intro", {
      step: bonusPct(1),
      max: bonusPct(POWERUP_UPGRADE_MAX_LEVEL),
      levels: POWERUP_UPGRADE_MAX_LEVEL,
    });
    // Modes où tout le monde part à égalité (GameModeInfo.upgrades).
    const flat = GAME_MODES.filter((m) => !m.upgrades);
    const modes = pane.querySelector("#upg-modes") as HTMLElement;
    modes.classList.toggle("hidden", flat.length === 0);
    modes.textContent = flat.length ? t("upg.notIn", { modes: flat.map((m) => gameModeName(m.id)).join(", ") }) : "";
    (pane.querySelector("#upg-guest") as HTMLElement).classList.toggle("hidden", signedIn);
    let total = 0;
    const list = pane.querySelector("#upg-list") as HTMLElement;
    list.replaceChildren(...UPGRADABLE_POWERUPS.map((type) => {
      const level = this.levelOf(type);
      total += level;
      return this.upgradeCard(type, level, signedIn);
    }));
    const count = this.root.querySelector("#quests-count-upgrades") as HTMLElement;
    count.textContent = signedIn ? `${total}/${UPGRADABLE_POWERUPS.length * POWERUP_UPGRADE_MAX_LEVEL}` : "";
  }

  private upgradeCard(type: PowerUpType, level: number, signedIn: boolean): HTMLElement {
    const max = level >= POWERUP_UPGRADE_MAX_LEVEL;
    const card = document.createElement("article");
    card.className = `upg-card${max ? " max" : ""}`;
    if (this.justBought === upgradeItemId(type, level)) card.classList.add("just-bought");
    card.append(powerUpIcon(type));

    const main = document.createElement("div");
    main.className = "upg-main";
    const head = document.createElement("div");
    head.className = "upg-head";
    const name = document.createElement("h4");
    name.textContent = upgradeName(type);
    const lv = document.createElement("span");
    lv.className = "upg-level";
    lv.textContent = t("upg.level", { n: level, max: POWERUP_UPGRADE_MAX_LEVEL });
    head.append(name, lv);
    const desc = document.createElement("p");
    desc.className = "upg-desc";
    const descKey = UPGRADE_TEXT[type]?.desc;
    desc.textContent = descKey ? t(descKey) : "";
    // Vingt crans : les niveaux acquis remplis.
    const pips = document.createElement("i");
    pips.className = "upg-pips";
    pips.setAttribute("aria-hidden", "true");
    pips.style.setProperty("--p", (level / POWERUP_UPGRADE_MAX_LEVEL).toFixed(3));
    const effect = document.createElement("p");
    effect.className = "upg-effect";
    const now = level > 0 ? t("upg.effect", { pct: bonusPct(level) }) : t("upg.base");
    effect.textContent = max ? now : `${now} · ${t("upg.effectNext", { pct: bonusPct(level + 1) })}`;
    main.append(head, desc, pips, effect);
    card.append(main, this.durationTable(type, level, max), this.buyBox(type, level, max, signedIn));
    return card;
  }

  // Durée de l'effet selon la rareté du power-up (sa taille au sol), au
  // niveau actuel et au suivant : une ligne par rareté, pour tenir dans un
  // téléphone en portrait (quatre colonnes de raretés n'y passaient pas).
  private durationTable(type: PowerUpType, level: number, max: boolean): HTMLTableElement {
    const table = document.createElement("table");
    table.className = "upg-table";
    const caption = document.createElement("caption");
    caption.className = "sr-only";
    caption.textContent = t("upg.tableCaption");
    const levels = max ? [level] : [level, level + 1];
    const head = document.createElement("tr");
    head.append(document.createElement("td"));
    for (const lvl of levels) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = t("upg.rowLevel", { n: lvl });
      if (lvl > level) th.className = "next";
      head.append(th);
    }
    table.append(caption, head);
    RARITIES.forEach((rarity, i) => {
      const tr = document.createElement("tr");
      const th = document.createElement("th");
      th.scope = "row";
      // Point plus gros pour une rareté plus haute, comme au sol.
      const dot = document.createElement("i");
      dot.className = "upg-dot";
      dot.style.setProperty("--s", `${5 + i * 2}px`);
      th.append(dot, t(RARITY_KEY[rarity]));
      tr.append(th);
      for (const lvl of levels) {
        const td = document.createElement("td");
        td.textContent = seconds(powerUpDurationMs(type, rarity, lvl));
        if (lvl > level) td.className = "next";
        tr.append(td);
      }
      table.append(tr);
    });
    return table;
  }

  private buyBox(type: PowerUpType, level: number, max: boolean, signedIn: boolean): HTMLElement {
    const box = document.createElement("div");
    box.className = "upg-buy";
    if (max) {
      const badge = document.createElement("span");
      badge.className = "upg-max";
      badge.textContent = t("upg.max");
      box.append(badge);
      return box;
    }
    const price = upgradePrice(level + 1);
    const tag = document.createElement("span");
    tag.className = "boutique-card-price";
    tag.innerHTML = `<span class="boutique-card-price-icon">🏆</span><span class="boutique-card-price-val">${formatNumber(price, 0)}</span>`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "boutique-btn buy";
    box.append(tag, btn);
    // Reste à payer jusqu'au niveau 20.
    let rest = 0;
    for (let n = level + 1; n <= POWERUP_UPGRADE_MAX_LEVEL; n++) rest += upgradePrice(n);
    const toMax = document.createElement("small");
    toMax.className = "upg-tomax";
    toMax.textContent = t("upg.toMax", { price: formatNumber(rest, 0) });
    box.append(toMax);
    // Un invité n'achète pas (ses trophées rejoignent son compte à la
    // connexion) : le bouton ouvre la connexion, comme en boutique.
    if (!signedIn) {
      btn.textContent = t("shop.signIn");
      btn.addEventListener("click", () => this.signIn());
      return box;
    }
    const id = upgradeItemId(type, level + 1);
    const canAfford = (wallet.get()?.balance ?? 0) >= price;
    // Un achat à la fois : le suivant dépend de celui en cours.
    btn.disabled = !canAfford || this.pending !== null;
    btn.textContent = this.pending === id ? "..." : t(canAfford ? "shop.buy" : "shop.notEnough");
    btn.setAttribute("aria-label", `${t("shop.buy")} · ${upgradeName(type)} ${t("upg.rowLevel", { n: level + 1 })} · ${formatNumber(price, 0)} 🏆`);
    btn.addEventListener("click", () => void this.buy(type, level + 1));
    return box;
  }

  private async buy(type: PowerUpType, level: number): Promise<void> {
    const id = upgradeItemId(type, level);
    if (this.pending !== null || this.levelOf(type) >= level) return;
    this.pending = id;
    this.renderUpgrades();
    const result = await wallet.purchase(id, upgradePrice(level));
    this.pending = null;
    const status = this.root.querySelector("#upg-status") as HTMLElement;
    if (result.ok || result.error === "already_owned") {
      (this.inventory ??= new Set(listOwned())).add(id);
      grantOwnership(id);
      this.justBought = id;
      status.textContent = t("upg.bought", { name: upgradeName(type), n: level, pct: bonusPct(level) });
    } else if (result.error === "upgrade_order") {
      // Inventaire de l'appareil en retard sur le compte : on le relit.
      const items = await wallet.fetchInventoryOrNull();
      if (items) this.inventory = new Set(items);
      void showAlert(t("upg.errOrder"));
    } else if (result.error === "price_changed") void showAlert(t("upg.errPrice"));
    else if (result.error === "insufficient_funds") void showAlert(t("shop.errFunds"));
    else if (result.error === "unauthorized") void showAlert(t("shop.errAuth"));
    else if (result.error === "no_wallet") void showAlert(t("shop.errWallet"));
    else void showAlert(t("shop.errGeneric", { error: result.error ?? t("shop.errNetwork") }));
    this.renderUpgrades();
    this.renderBalance();
  }

  private signIn(): void {
    this.close();
    document.querySelector<HTMLButtonElement>(".bio2-auth-trigger")?.click();
  }
}
