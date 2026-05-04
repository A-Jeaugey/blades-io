import { getActiveTheme, listThemes, setActiveTheme, Theme } from "../themes";
import { wallet } from "../auth/wallet";
import { grantOwnership, isOwned, listOwned, subscribeOwnership } from "./owned";

// ─────────────────────────────────────────────────────────────────────────────
// Boutique — UI controller pour la modal d'achat de cosmétiques.
//
// V1 scope :
// - Maps (= thèmes) : achat fonctionnel (localStorage), équipement = reload
// - Skins / Épées : placeholder "Bientôt" (système d'assets pas encore prêt)
//
// V2 plan : remplacer la persistence localStorage par /api/wallet/inventory
// + endpoint /api/wallet/purchase qui décrémente le solde serveur. L'API
// publique de ce module ne change pas, juste les implémentations sous le
// capot.
// ─────────────────────────────────────────────────────────────────────────────

export class Boutique {
  private root: HTMLElement;
  private mapsGrid: HTMLElement;
  private balanceEl: HTMLElement;
  private activeThemeEl: HTMLElement;
  private mapsCountEl: HTMLElement;
  private currentTab: "maps" | "skins" | "blades" = "maps";
  private unsubWallet: (() => void) | null = null;
  private unsubOwned: (() => void) | null = null;
  // État de "purchase pending" : empêche les double-clics + montre un état
  // visuel sur la carte. Stocké par theme id.
  private pendingPurchase = new Set<string>();

  constructor() {
    this.root = document.getElementById("boutique")!;
    this.mapsGrid = document.getElementById("boutique-maps-grid")!;
    this.balanceEl = document.getElementById("boutique-balance")!;
    this.activeThemeEl = document.getElementById("boutique-active-theme")!;
    this.mapsCountEl = document.getElementById("boutique-count-maps")!;

    // Tab switching.
    this.root.querySelectorAll<HTMLElement>(".boutique-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const which = tab.dataset.tab as "maps" | "skins" | "blades";
        if (!which) return;
        this.switchTab(which);
      });
    });

    // Close button + backdrop click.
    this.root.querySelectorAll<HTMLElement>("[data-close]").forEach((el) => {
      el.addEventListener("click", () => this.close());
    });
    // Échap pour fermer.
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.root.classList.contains("hidden")) {
        this.close();
      }
    });

    // Boutons d'ouverture (login screen + future settings link).
    const openBtn = document.getElementById("open-boutique-btn");
    openBtn?.addEventListener("click", () => this.open());

    this.renderMaps();
    this.refreshBalance();
    this.refreshActiveThemeBadge();
  }

  open(): void {
    this.root.classList.remove("hidden");
    this.root.setAttribute("aria-hidden", "false");
    // Subscribe wallet pendant que la boutique est ouverte (sinon on
    // accumule des listeners et le solde se désaligne).
    // Important : on re-render AUSSI les cartes à chaque update wallet,
    // pas seulement le badge de solde — sans ça les boutons ACHETER
    // restent figés sur "FONDS INSUFFISANTS" même après que le solde se
    // charge depuis le serveur (le premier render se fait avec balance=0
    // tant que /api/wallet n'a pas répondu).
    this.unsubWallet?.();
    this.unsubWallet = wallet.subscribe(() => {
      this.refreshBalance();
      this.renderMaps();
    });
    this.unsubOwned?.();
    this.unsubOwned = subscribeOwnership(() => {
      this.renderMaps();
      this.refreshMapsCount();
    });
    // Tente un refresh wallet (peut échouer silencieusement si pas authed).
    void wallet.refresh();
    this.refreshMapsCount();
    this.switchTab(this.currentTab);
  }

  close(): void {
    this.root.classList.add("hidden");
    this.root.setAttribute("aria-hidden", "true");
    this.unsubWallet?.();
    this.unsubWallet = null;
    this.unsubOwned?.();
    this.unsubOwned = null;
  }

  private switchTab(name: "maps" | "skins" | "blades"): void {
    this.currentTab = name;
    this.root.querySelectorAll<HTMLElement>(".boutique-tab").forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", String(on));
    });
    this.root.querySelectorAll<HTMLElement>(".boutique-pane").forEach((p) => {
      p.classList.toggle("active", p.dataset.pane === name);
    });
  }

  private refreshBalance(): void {
    const w = wallet.get();
    const balance = w?.balance ?? 0;
    this.balanceEl.textContent = String(balance);
  }

  private refreshActiveThemeBadge(): void {
    this.activeThemeEl.textContent = getActiveTheme().displayName;
  }

  private refreshMapsCount(): void {
    const all = listThemes().length;
    const owned = listOwned().filter((id) => listThemes().some((t) => t.id === id)).length;
    this.mapsCountEl.textContent = `${owned}/${all}`;
  }

  private renderMaps(): void {
    const themes = listThemes();
    const activeId = getActiveTheme().id;
    this.mapsGrid.innerHTML = "";
    for (const theme of themes) {
      this.mapsGrid.appendChild(this.renderMapCard(theme, activeId));
    }
    this.refreshMapsCount();
  }

  private renderMapCard(theme: Theme, activeId: string): HTMLElement {
    const card = document.createElement("article");
    card.className = "boutique-card";
    card.dataset.themeId = theme.id;

    const owned = isOwned(theme.id);
    const equipped = activeId === theme.id;
    const pending = this.pendingPurchase.has(theme.id);
    const price = theme.price ?? 0;

    if (equipped) card.classList.add("equipped");
    if (owned && !equipped) card.classList.add("owned");
    if (!owned) card.classList.add("locked");

    // Préview : utilise les couleurs du thème ciblé pour donner un aperçu
    // visuel direct, sans avoir à rendre une scène 3D miniature.
    const ui = theme.ui;
    const palette = theme.palette;
    const previewBg = `radial-gradient(ellipse at 30% 30%, ${ui.accentCool}55, transparent 60%),
                       radial-gradient(ellipse at 75% 75%, ${ui.accentWarm}44, transparent 55%),
                       linear-gradient(135deg, ${ui.dark}, ${shadeHex(ui.dark, 0.3)})`;

    const preview = document.createElement("div");
    preview.className = "boutique-card-preview";
    preview.style.background = previewBg;

    // Mini-grid de pastilles raretés dans le preview pour signaler la
    // palette spécifique du thème (et que les couleurs des lames varient).
    const dots = document.createElement("div");
    dots.className = "boutique-card-dots";
    const rarities = palette.rarityColor;
    for (const r of [0, 1, 2, 3] as const) {
      const dot = document.createElement("span");
      dot.className = "boutique-card-dot";
      dot.style.background = hexToCss(rarities[r]);
      dot.style.boxShadow = `0 0 10px ${hexToCss(rarities[r])}`;
      dots.appendChild(dot);
    }
    preview.appendChild(dots);

    // Tag d'état top-right : EQUIPPED / OWNED / LOCKED
    const stateTag = document.createElement("span");
    stateTag.className = "boutique-card-state";
    if (equipped) {
      stateTag.classList.add("state-equipped");
      stateTag.textContent = "ÉQUIPÉ";
    } else if (owned) {
      stateTag.classList.add("state-owned");
      stateTag.textContent = "POSSÉDÉ";
    } else {
      stateTag.classList.add("state-locked");
      stateTag.textContent = "🔒";
    }
    preview.appendChild(stateTag);

    card.appendChild(preview);

    const body = document.createElement("div");
    body.className = "boutique-card-body";

    const title = document.createElement("h3");
    title.className = "boutique-card-title";
    title.textContent = theme.displayName;
    body.appendChild(title);

    if (theme.tagline) {
      const tag = document.createElement("p");
      tag.className = "boutique-card-tagline";
      tag.textContent = theme.tagline;
      body.appendChild(tag);
    }

    const action = document.createElement("div");
    action.className = "boutique-card-action";

    if (equipped) {
      const btn = document.createElement("button");
      btn.className = "boutique-btn equipped";
      btn.disabled = true;
      btn.textContent = "ACTIF";
      action.appendChild(btn);
    } else if (owned) {
      const btn = document.createElement("button");
      btn.className = "boutique-btn primary";
      btn.textContent = "ÉQUIPER";
      btn.addEventListener("click", () => this.equip(theme.id));
      action.appendChild(btn);
    } else {
      const priceTag = document.createElement("span");
      priceTag.className = "boutique-card-price";
      priceTag.innerHTML = `<span class="boutique-card-price-icon">🏆</span><span class="boutique-card-price-val">${price}</span>`;
      action.appendChild(priceTag);

      const btn = document.createElement("button");
      btn.className = "boutique-btn buy";
      const balance = wallet.get()?.balance ?? 0;
      const canAfford = balance >= price;
      btn.disabled = !canAfford || pending;
      btn.textContent = pending ? "..." : (canAfford ? "ACHETER" : "FONDS INSUFFISANTS");
      btn.addEventListener("click", () => this.buy(theme));
      action.appendChild(btn);
    }

    body.appendChild(action);
    card.appendChild(body);
    return card;
  }

  private equip(themeId: string): void {
    if (!isOwned(themeId)) return;
    setActiveTheme(themeId);
    // Reload obligatoire — le thème est résolu une fois au boot par tous
    // les modules de rendu (cf. CLAUDE.md § Système de thèmes).
    if (confirm("Équiper ce thème nécessite un reload. Recharger maintenant ?")) {
      window.location.reload();
    }
  }

  private buy(theme: Theme): void {
    const price = theme.price ?? 0;
    if (this.pendingPurchase.has(theme.id)) return;
    if (isOwned(theme.id)) return;
    const balance = wallet.get()?.balance ?? 0;
    if (balance < price) return;

    this.pendingPurchase.add(theme.id);
    this.renderMaps();

    // V1 : achat purement client-side. localStorage marque comme owned ;
    // le wallet serveur n'est PAS débité (on n'a pas encore l'endpoint
    // /api/wallet/purchase). Conséquence : pour l'instant tu peux acheter
    // tous les thèmes sans dépenser de trophées. Quand le serveur aura le
    // endpoint, on remplacera ce bloc par un fetch authed qui débite.
    grantOwnership(theme.id);
    this.pendingPurchase.delete(theme.id);
    this.renderMaps();
  }
}

function hexToCss(hex: number): string {
  return "#" + hex.toString(16).padStart(6, "0");
}

// Décale une couleur hex (#rrggbb) vers le sombre/clair d'un facteur amount.
// amount > 0 = plus clair, < 0 = plus sombre. Utilisé pour produire le
// gradient diagonal dans les previews boutique sans hardcoder une 2e
// couleur dans chaque thème.
function shadeHex(hex: string, amount: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 0xff;
  let g = (n >> 8) & 0xff;
  let b = n & 0xff;
  if (amount >= 0) {
    r = Math.min(255, Math.round(r + (255 - r) * amount));
    g = Math.min(255, Math.round(g + (255 - g) * amount));
    b = Math.min(255, Math.round(b + (255 - b) * amount));
  } else {
    const a = -amount;
    r = Math.max(0, Math.round(r * (1 - a)));
    g = Math.max(0, Math.round(g * (1 - a)));
    b = Math.max(0, Math.round(b * (1 - a)));
  }
  return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
}
