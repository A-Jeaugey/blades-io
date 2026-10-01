import { CosmeticDef, CosmeticSlot, cosmeticsOf, getCosmetic, getShopItem, hasCosmetic, levelForXp } from "@bladeio/shared";
import { auth } from "../auth/supabase";
import { wallet } from "../auth/wallet";
import { fetchGuestWallet } from "../auth/guestToken";
import { equip, getLoadout } from "../cosmetics/loadout";
import { BLADE_STYLES, KILL_FX_LOOKS, SKIN_LOOKS, TRAIL_LOOKS, lookOf } from "../cosmetics/looks";
import { getActiveTheme } from "../themes";
import { cosmeticDesc, cosmeticName, formatNumber, t } from "../i18n";
import { grantOwnership, isOwned } from "./owned";
import { showAlert } from "../ui/Dialog";

// Onglets SKINS, LAMES et EFFETS de la boutique (tâche 6.2) : cosmétiques
// visibles par tous. Débloqués au niveau de compte ou achetés en trophées ;
// l'équipement vaut dès la partie suivante, sans rechargement (le serveur le
// revérifie au join, cf. validateLoadout).

export type CosmeticTab = "skins" | "blades" | "effects";

const TAB_SLOTS: Readonly<Record<CosmeticTab, readonly CosmeticSlot[]>> = {
  skins: ["skin"],
  blades: ["bladeSkin"],
  effects: ["trail", "killFx"],
};

const COUNT_ID: Readonly<Record<CosmeticTab, string>> = {
  skins: "boutique-count-skins",
  blades: "boutique-count-blades",
  effects: "boutique-count-effects",
};

const GRID_ID: Readonly<Record<CosmeticSlot, string>> = {
  skin: "boutique-skins-grid",
  bladeSkin: "boutique-blades-grid",
  trail: "boutique-trails-grid",
  killFx: "boutique-kills-grid",
};

const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");

export class CosmeticsShop {
  private level = 1;
  private pending = new Set<string>();
  private request = 0;

  // close : ferme la boutique (bouton « connecte-toi » d'un invité).
  constructor(private readonly close: () => void) {}

  // Niveau du compte, ou du portefeuille invité (son solde est son XP).
  async refreshLevel(): Promise<void> {
    const id = ++this.request;
    let xp = 0;
    if (auth.getAccessToken()) {
      xp = wallet.get()?.total_earned ?? 0;
    } else {
      const g = await fetchGuestWallet();
      // Une réponse plus récente a déjà pu passer.
      if (id !== this.request) return;
      xp = g && !g.claimed ? g.balance : 0;
    }
    this.level = levelForXp(xp);
    this.render();
  }

  // Comme le serveur (validateLoadout) : un invité n'a que les items de son
  // niveau, même si l'appareil garde les achats d'un compte déconnecté.
  private has(def: CosmeticDef): boolean {
    const signedIn = auth.getAccessToken() !== null;
    return hasCosmetic(def, { level: this.level, owns: (id) => signedIn && isOwned(id) });
  }

  // Équipé tel que le serveur le retiendra : un item qui n'est plus à ce
  // joueur (invité, niveau d'un autre compte) laisse l'apparence de base.
  private equippedId(slot: CosmeticSlot): string {
    const id = getLoadout()[slot];
    const def = getCosmetic(id);
    return def && this.has(def) ? id : "";
  }

  render(): void {
    for (const slot of Object.keys(GRID_ID) as CosmeticSlot[]) {
      const grid = document.getElementById(GRID_ID[slot]);
      if (!grid) continue;
      grid.innerHTML = "";
      grid.appendChild(this.card(slot, null));
      for (const def of cosmeticsOf(slot)) grid.appendChild(this.card(slot, def));
    }
    // « 3/9 » sur l'onglet : items débloqués ou achetés.
    for (const tab of Object.keys(COUNT_ID) as CosmeticTab[]) {
      const el = document.getElementById(COUNT_ID[tab]);
      const defs = TAB_SLOTS[tab].flatMap((s) => cosmeticsOf(s));
      if (el) el.textContent = `${defs.filter((d) => this.has(d)).length}/${defs.length}`;
    }
  }

  // def null : l'apparence de base de l'emplacement.
  private card(slot: CosmeticSlot, def: CosmeticDef | null): HTMLElement {
    const id = def?.id ?? "";
    const equipped = this.equippedId(slot) === id;
    const owned = def === null || this.has(def);
    const card = document.createElement("article");
    card.className = "boutique-card cos-card";
    card.classList.add(equipped ? "equipped" : owned ? "owned" : "locked");

    const preview = document.createElement("div");
    preview.className = `boutique-card-preview cos-preview cos-preview-${slot}`;
    preview.appendChild(this.previewOf(slot, id));
    const state = document.createElement("span");
    state.className = "boutique-card-state";
    if (equipped) {
      state.classList.add("state-equipped");
      state.textContent = t("shop.equipped");
    } else if (owned) {
      state.classList.add("state-owned");
      state.textContent = t("shop.owned");
    } else {
      state.classList.add("state-locked");
      state.textContent = def?.level !== undefined ? `🔒 ${t("shop.levelLock", { n: def.level })}` : "🔒";
    }
    preview.appendChild(state);
    card.appendChild(preview);

    const body = document.createElement("div");
    body.className = "boutique-card-body";
    const title = document.createElement("h3");
    title.className = "boutique-card-title";
    title.textContent = cosmeticName(slot, id);
    const desc = document.createElement("p");
    desc.className = "boutique-card-tagline";
    desc.textContent = cosmeticDesc(slot, id);
    body.append(title, desc);
    body.appendChild(this.action(slot, def, owned, equipped));
    card.appendChild(body);
    return card;
  }

  private action(slot: CosmeticSlot, def: CosmeticDef | null, owned: boolean, equipped: boolean): HTMLElement {
    const action = document.createElement("div");
    action.className = "boutique-card-action";
    const btn = document.createElement("button");
    btn.className = "boutique-btn";
    action.appendChild(btn);
    if (equipped) {
      btn.classList.add("equipped");
      btn.disabled = true;
      btn.textContent = t("shop.active");
      return action;
    }
    if (owned) {
      btn.classList.add("primary");
      btn.textContent = t("shop.equip");
      btn.addEventListener("click", () => {
        equip(slot, def?.id ?? "");
        this.render();
      });
      return action;
    }
    // Débloqué par le niveau : rien à acheter, le chemin qui reste à la
    // place du bouton (une infobulle ne se voit pas au doigt).
    if (def!.level !== undefined) {
      const hint = document.createElement("span");
      hint.className = "cos-unlock";
      hint.textContent = t("shop.levelHint", { n: def!.level, level: this.level });
      action.replaceChildren(hint);
      return action;
    }
    const price = getShopItem(def!.id)?.price ?? 0;
    const tag = document.createElement("span");
    tag.className = "boutique-card-price";
    tag.innerHTML = `<span class="boutique-card-price-icon">🏆</span><span class="boutique-card-price-val">${formatNumber(price, 0)}</span>`;
    action.insertBefore(tag, btn);
    // Un invité n'achète pas (ses trophées rejoignent son compte à la
    // connexion) : le bouton ouvre la connexion.
    if (!auth.getAccessToken()) {
      btn.classList.add("buy");
      btn.textContent = t("shop.signIn");
      btn.addEventListener("click", () => {
        this.close();
        document.querySelector<HTMLButtonElement>(".bio2-auth-trigger")?.click();
      });
      return action;
    }
    const pending = this.pending.has(def!.id);
    const canAfford = (wallet.get()?.balance ?? 0) >= price;
    btn.classList.add("buy");
    btn.disabled = !canAfford || pending;
    btn.textContent = pending ? "..." : t(canAfford ? "shop.buy" : "shop.notEnough");
    btn.addEventListener("click", () => void this.buy(def!.id));
    return action;
  }

  private async buy(id: string): Promise<void> {
    if (this.pending.has(id) || isOwned(id)) return;
    this.pending.add(id);
    this.render();
    const result = await wallet.purchase(id);
    this.pending.delete(id);
    if (result.ok || result.error === "already_owned") grantOwnership(id);
    else if (result.error === "insufficient_funds") void showAlert(t("shop.errFunds"));
    else if (result.error === "unauthorized") void showAlert(t("shop.errAuth"));
    else if (result.error === "no_wallet") void showAlert(t("shop.errWallet"));
    else void showAlert(t("shop.errGeneric", { error: result.error ?? t("shop.errNetwork") }));
    this.render();
  }

  // Aperçu en CSS, d'après l'apparence (cosmetics/looks.ts) : silhouette,
  // lames aux couleurs de rareté du thème, traînée, éclats.
  private previewOf(slot: CosmeticSlot, id: string): HTMLElement {
    const el = document.createElement("div");
    if (slot === "skin") {
      const look = lookOf(SKIN_LOOKS, id);
      const pal = getActiveTheme().palette.playerLocal;
      el.className = `cos-fig${look?.headShape === "box" ? " cos-fig-box" : ""}`;
      el.style.setProperty("--body", hex(look?.body ?? pal.primary));
      el.style.setProperty("--head", hex(look?.head ?? pal.primary));
      el.style.setProperty("--glow", hex(look?.emissive ?? pal.accent));
      el.style.setProperty("--accent", hex(look?.accent ?? pal.accent));
      if (look && look.accessory !== "none") {
        const acc = document.createElement("span");
        acc.className = `cos-acc cos-acc-${look.accessory}`;
        el.appendChild(acc);
      }
    } else if (slot === "bladeSkin") {
      el.className = `cos-blades cos-style-${lookOf(BLADE_STYLES, id) ?? 0}`;
      for (const color of Object.values(getActiveTheme().palette.rarityColor)) {
        const blade = document.createElement("span");
        blade.className = "cos-blade";
        blade.style.setProperty("--c", hex(color));
        el.appendChild(blade);
      }
    } else if (slot === "trail") {
      const look = lookOf(TRAIL_LOOKS, id);
      const accent = getActiveTheme().palette.playerLocal.accent;
      el.className = "cos-trail";
      el.style.setProperty("--head", hex(look?.head ?? accent));
      el.style.setProperty("--tail", hex(look?.tail ?? accent));
      el.style.setProperty("--w", String(look?.width ?? 0.8));
    } else {
      const look = lookOf(KILL_FX_LOOKS, id);
      const colors = look?.colors ?? [getActiveTheme().palette.fx.deathExplosion];
      el.className = "cos-burst";
      // Durée, portée et dérive (les âmes montent, les confettis retombent)
      // reprises de la salve en jeu.
      const reach = Math.min(1.3, Math.max(0.6, (look?.speed ?? 5) / 5));
      el.style.setProperty("--dur", `${Math.max(0.9, (look?.life ?? 1) * 1.2).toFixed(2)}s`);
      const gravity = look?.gravity ?? 0;
      if (gravity < 0) el.style.setProperty("--lift", "-24px");
      else if (gravity >= 0.2) el.style.setProperty("--lift", "14px");
      for (let i = 0; i < 12; i++) {
        const dot = document.createElement("span");
        dot.style.setProperty("--c", hex(colors[i % colors.length]));
        dot.style.setProperty("--a", `${i * 30}deg`);
        dot.style.setProperty("--r", `${Math.round((18 + (i % 3) * 9) * reach)}px`);
        el.appendChild(dot);
      }
    }
    return el;
  }
}
