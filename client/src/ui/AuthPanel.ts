import { auth, AuthState } from "../auth/supabase";

const USERNAME_RE = /^[A-Za-z0-9_.\-]{3,16}$/;

type Mode = "signin" | "signup" | "username";

// AuthPanel manages the auth section in the login screen. Three sub-modes:
//   - signin   : email + password, Discord/Google buttons (signed-out state)
//   - signup   : email + password + username, Discord/Google buttons
//   - username : choose username (signed-in but no profile.username yet)
// When fully signed-in (with username), the panel collapses to a one-line
// summary with a "sign out" button.
export class AuthPanel {
  private root: HTMLElement;
  private unsubscribe: () => void;
  private mode: Mode = "signin";
  private busy = false;
  // Le form signed-out est replié par défaut pour ne pas saturer l'écran de
  // login. L'utilisateur clique le trigger pour le déplier.
  private expanded = false;
  private message: { kind: "error" | "info"; text: string } | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    if (!auth.isConfigured()) {
      // Pas de backend Supabase configuré : on cache complètement le panneau.
      // L'utilisateur ne voit que le mode invité (champ CALLSIGN classique).
      this.root.classList.add("hidden");
      this.unsubscribe = () => {};
      return;
    }
    this.unsubscribe = auth.subscribe((state) => this.render(state));
  }

  destroy(): void {
    this.unsubscribe();
  }

  // Utilisé par LoginScreen pour décider si le champ CALLSIGN doit être
  // verrouillé sur le username Supabase ou laisser le joueur taper son
  // pseudo invité.
  isLockedToUsername(): boolean {
    const s = auth.getState();
    return s.status === "signed_in" && !!s.profile.username;
  }

  getDisplayName(): string | null {
    return auth.getUsername();
  }

  private setBusy(b: boolean): void {
    this.busy = b;
    this.root.querySelectorAll<HTMLButtonElement>("button").forEach((btn) => {
      btn.disabled = b;
    });
    this.root.querySelectorAll<HTMLInputElement>("input").forEach((inp) => {
      inp.disabled = b;
    });
  }

  private setMessage(kind: "error" | "info", text: string): void {
    this.message = { kind, text };
    const el = this.root.querySelector<HTMLElement>(".bio2-auth-msg");
    if (el) {
      el.textContent = text;
      el.dataset.kind = kind;
      el.classList.remove("hidden");
    }
  }

  private clearMessage(): void {
    this.message = null;
    const el = this.root.querySelector<HTMLElement>(".bio2-auth-msg");
    if (el) el.classList.add("hidden");
  }

  private render(state: AuthState): void {
    if (state.status === "loading") {
      this.root.innerHTML = `<div class="bio2-auth-summary"><span class="bio2-auth-status">…</span></div>`;
      return;
    }
    if (state.status === "signed_in" && state.profile.username) {
      this.renderSignedIn(state.profile.username, state.profile.email ?? "");
      return;
    }
    if (state.status === "signed_in" && !state.profile.username) {
      this.mode = "username";
      this.renderUsernamePicker();
      return;
    }
    // signed_out
    if (this.mode === "username") this.mode = "signin";
    if (!this.expanded) {
      this.renderCollapsed();
      return;
    }
    this.renderSignedOut();
  }

  private renderCollapsed(): void {
    this.root.classList.remove("hidden");
    this.root.classList.add("bio2-auth-mini");
    this.root.innerHTML = `
      <button type="button" class="bio2-auth-trigger" data-action="expand">
        <span class="bio2-auth-trigger-arrow">▸</span>
        <span class="bio2-auth-trigger-label">SIGN IN OR CREATE ACCOUNT</span>
        <span class="bio2-auth-trigger-hint">save your scores</span>
      </button>
    `;
    this.root.querySelector<HTMLButtonElement>("[data-action=expand]")?.addEventListener("click", () => {
      this.expanded = true;
      this.clearMessage();
      this.render(auth.getState());
    });
  }

  private renderSignedIn(username: string, email: string): void {
    this.root.classList.remove("hidden");
    this.root.classList.remove("bio2-auth-mini");
    this.root.innerHTML = `
      <div class="bio2-auth-summary">
        <div class="bio2-auth-summary-l">
          <span class="bio2-auth-status bio2-auth-on">SIGNED IN</span>
          <span class="bio2-auth-user">${escapeHtml(username)}</span>
          ${email ? `<span class="bio2-auth-email">${escapeHtml(email)}</span>` : ""}
        </div>
        <button type="button" class="bio2-auth-link" data-action="signout">SIGN OUT</button>
      </div>
    `;
    this.bindSignedIn();
  }

  private renderUsernamePicker(): void {
    this.root.classList.remove("hidden");
    this.root.classList.remove("bio2-auth-mini");
    this.root.innerHTML = `
      <div class="bio2-auth-head">
        <span class="bio2-auth-tag">// AUTH</span>
        <span class="bio2-auth-title">CHOOSE&nbsp;USERNAME</span>
      </div>
      <div class="bio2-auth-body">
        <p class="bio2-auth-hint">Required to track your scores. 3–16 chars · letters, digits, _ . -</p>
        <div class="bio2-field">
          <label class="bio2-field-label" for="auth-username">USERNAME</label>
          <input id="auth-username" class="bio2-input" type="text" maxlength="16" autocomplete="off" />
        </div>
        <button type="button" class="bio2-auth-cta" data-action="save-username">SAVE</button>
        <button type="button" class="bio2-auth-link" data-action="signout">SIGN OUT</button>
        <div class="bio2-auth-msg hidden"></div>
      </div>
    `;
    if (this.message) this.setMessage(this.message.kind, this.message.text);
    this.bindUsernamePicker();
  }

  private renderSignedOut(): void {
    this.root.classList.remove("hidden");
    this.root.classList.remove("bio2-auth-mini");
    const isSignup = this.mode === "signup";
    this.root.innerHTML = `
      <div class="bio2-auth-head">
        <span class="bio2-auth-tag">// AUTH</span>
        <span class="bio2-auth-title">${isSignup ? "CREATE&nbsp;ACCOUNT" : "SIGN&nbsp;IN"}</span>
        <span class="bio2-auth-spacer"></span>
        <span class="bio2-auth-tabs">
          <button type="button" class="bio2-auth-tab ${!isSignup ? "active" : ""}" data-mode="signin">SIGN&nbsp;IN</button>
          <button type="button" class="bio2-auth-tab ${isSignup ? "active" : ""}" data-mode="signup">SIGN&nbsp;UP</button>
        </span>
        <button type="button" class="bio2-auth-close" data-action="collapse" title="Hide">×</button>
      </div>
      <div class="bio2-auth-body">
        <div class="bio2-auth-providers">
          <button type="button" class="bio2-auth-provider bio2-auth-discord" data-provider="discord">
            <svg class="bio2-auth-provider-logo" viewBox="0 0 24 24" aria-hidden="true">
              <defs>
                <linearGradient id="bio2-discord-glass" x1="20%" y1="0%" x2="80%" y2="100%">
                  <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95" />
                  <stop offset="35%" stop-color="#a8b3ff" stop-opacity="0.7" />
                  <stop offset="100%" stop-color="#5865f2" stop-opacity="0.5" />
                </linearGradient>
                <linearGradient id="bio2-discord-shine" x1="20%" y1="0%" x2="60%" y2="60%">
                  <stop offset="0%" stop-color="#ffffff" stop-opacity="0.85" />
                  <stop offset="100%" stop-color="#ffffff" stop-opacity="0" />
                </linearGradient>
                <!-- Premier subpath du logo Discord (le corps, sans les yeux) :
                     sert à la fois pour le bandeau lumineux constant et de
                     guide à animateMotion. -->
                <path id="bio2-discord-outline" d="M19.27 5.33C17.94 4.71 16.5 4.26 15 4a.09.09 0 0 0-.07.03c-.18.33-.39.76-.53 1.09a16.09 16.09 0 0 0-4.8 0c-.14-.34-.35-.76-.54-1.09c-.01-.02-.04-.03-.07-.03c-1.5.26-2.93.71-4.27 1.33c-.01 0-.02.01-.03.02c-2.72 4.07-3.47 8.03-3.1 11.95c0 .02.01.04.03.05c1.8 1.32 3.53 2.12 5.24 2.65c.03.01.06 0 .07-.02c.4-.55.76-1.13 1.07-1.74c.02-.04 0-.08-.04-.09c-.57-.22-1.11-.48-1.64-.78c-.04-.02-.04-.08-.01-.11c.11-.08.22-.17.33-.25c.02-.02.05-.02.07-.01c3.44 1.57 7.15 1.57 10.55 0c.02-.01.05-.01.07.01c.11.09.22.17.33.26c.04.03.04.09-.01.11c-.52.31-1.07.56-1.64.78c-.04.01-.05.06-.04.09c.32.61.68 1.19 1.07 1.74c.03.01.06.02.09.01c1.72-.53 3.45-1.33 5.25-2.65c.02-.01.03-.03.03-.05c.44-4.53-.73-8.46-3.1-11.95c-.01-.01-.02-.02-.04-.02z" />
                <filter id="bio2-discord-glow" x="-100%" y="-100%" width="300%" height="300%">
                  <feGaussianBlur stdDeviation="0.45" result="b1" />
                  <feMerge>
                    <feMergeNode in="b1" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                <filter id="bio2-discord-spark" x="-200%" y="-200%" width="500%" height="500%">
                  <feGaussianBlur stdDeviation="1.4" result="b1" />
                  <feMerge>
                    <feMergeNode in="b1" />
                    <feMergeNode in="b1" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <path
                d="M19.27 5.33C17.94 4.71 16.5 4.26 15 4a.09.09 0 0 0-.07.03c-.18.33-.39.76-.53 1.09a16.09 16.09 0 0 0-4.8 0c-.14-.34-.35-.76-.54-1.09c-.01-.02-.04-.03-.07-.03c-1.5.26-2.93.71-4.27 1.33c-.01 0-.02.01-.03.02c-2.72 4.07-3.47 8.03-3.1 11.95c0 .02.01.04.03.05c1.8 1.32 3.53 2.12 5.24 2.65c.03.01.06 0 .07-.02c.4-.55.76-1.13 1.07-1.74c.02-.04 0-.08-.04-.09c-.57-.22-1.11-.48-1.64-.78c-.04-.02-.04-.08-.01-.11c.11-.08.22-.17.33-.25c.02-.02.05-.02.07-.01c3.44 1.57 7.15 1.57 10.55 0c.02-.01.05-.01.07.01c.11.09.22.17.33.26c.04.03.04.09-.01.11c-.52.31-1.07.56-1.64.78c-.04.01-.05.06-.04.09c.32.61.68 1.19 1.07 1.74c.03.01.06.02.09.01c1.72-.53 3.45-1.33 5.25-2.65c.02-.01.03-.03.03-.05c.44-4.53-.73-8.46-3.1-11.95c-.01-.01-.02-.02-.04-.02zM8.52 14.91c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12c0 1.17-.84 2.12-1.89 2.12zm6.97 0c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12c0 1.17-.83 2.12-1.89 2.12z"
                fill="url(#bio2-discord-glass)"
                stroke="#ffffff"
                stroke-width="0.35"
                stroke-opacity="0.55"
              />
              <path
                d="M19.27 5.33C17.94 4.71 16.5 4.26 15 4a.09.09 0 0 0-.07.03c-.18.33-.39.76-.53 1.09a16.09 16.09 0 0 0-4.8 0c-.14-.34-.35-.76-.54-1.09c-.01-.02-.04-.03-.07-.03c-1.5.26-2.93.71-4.27 1.33c-.01 0-.02.01-.03.02c-2.72 4.07-3.47 8.03-3.1 11.95c0 .02.01.04.03.05c1.8 1.32 3.53 2.12 5.24 2.65c.03.01.06 0 .07-.02c.4-.55.76-1.13 1.07-1.74c.02-.04 0-.08-.04-.09c-.57-.22-1.11-.48-1.64-.78c-.04-.02-.04-.08-.01-.11c.11-.08.22-.17.33-.25c.02-.02.05-.02.07-.01c3.44 1.57 7.15 1.57 10.55 0c.02-.01.05-.01.07.01c.11.09.22.17.33.26c.04.03.04.09-.01.11c-.52.31-1.07.56-1.64.78c-.04.01-.05.06-.04.09c.32.61.68 1.19 1.07 1.74c.03.01.06.02.09.01c1.72-.53 3.45-1.33 5.25-2.65c.02-.01.03-.03.03-.05c.44-4.53-.73-8.46-3.1-11.95c-.01-.01-.02-.02-.04-.02z"
                fill="url(#bio2-discord-shine)"
                opacity="0.55"
              />
              <use href="#bio2-discord-outline" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="0.3" filter="url(#bio2-discord-glow)" />
              <circle r="0.7" fill="#ffffff" filter="url(#bio2-discord-spark)">
                <animateMotion dur="3.4s" repeatCount="indefinite" rotate="auto">
                  <mpath href="#bio2-discord-outline" />
                </animateMotion>
              </circle>
            </svg>
            <span>Continue with Discord</span>
          </button>
          <button type="button" class="bio2-auth-provider bio2-auth-google" data-provider="google">
            <svg class="bio2-auth-provider-logo" viewBox="0 0 24 24" aria-hidden="true">
              <defs>
                <linearGradient id="bio2-google-blue" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95" />
                  <stop offset="60%" stop-color="#4285F4" stop-opacity="0.55" />
                </linearGradient>
                <linearGradient id="bio2-google-green" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#ffffff" stop-opacity="0.85" />
                  <stop offset="60%" stop-color="#34A853" stop-opacity="0.6" />
                </linearGradient>
                <linearGradient id="bio2-google-yellow" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#ffffff" stop-opacity="0.85" />
                  <stop offset="60%" stop-color="#FBBC05" stop-opacity="0.6" />
                </linearGradient>
                <linearGradient id="bio2-google-red" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#ffffff" stop-opacity="0.85" />
                  <stop offset="60%" stop-color="#EA4335" stop-opacity="0.6" />
                </linearGradient>
                <!-- Les 4 sous-paths du G en defs : on les utilise via <use>
                     pour le rendu coloré ET pour le bandeau lumineux. -->
                <path id="bio2-google-p1" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path id="bio2-google-p2" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
                <path id="bio2-google-p3" d="M5.84 14.09a6.6 6.6 0 0 1-.34-2.09c0-.72.12-1.43.34-2.09V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84z" />
                <path id="bio2-google-p4" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
                <!-- Path "outline" du G : CYCLE EULÉRIEN FERMÉ qui suit
                     l'extérieur ET l'intérieur du logo. Tous les sommets
                     ont degré pair → pas de téléportation, le point boucle
                     proprement. On omet les frontières inter-couleurs
                     (rouge/jaune, jaune/vert, vert/bleu) qui ne sont pas
                     des bords du logo mais des transitions de teinte.
                     Tracé :
                       (19.36, 3.87) sommet encoche (start)
                       → cubics rouge ext (sommet, gauche-haut)
                       → arcs jaune+vert ext (gauche, bas)
                       → cubic vert ext (bas-droite)
                       → cubic bleu ext (bord ext droit du G)
                       → cubic bleu (pointe sup-ext de la barre)
                       → bord sup, gauche, inf de la barre intérieure
                       → cubic patte-barre (vers (15.71, 17.57))
                       → cubic vert int (vers (12, 18.63))
                       → cubic vert int (vers (5.84, 14.09))
                       → arc jaune int (vers (5.5, 12))
                       → cubic jaune int (vers (5.84, 9.91))
                       → cubic rouge int (vers (12, 5.38))
                       → cubic rouge int (vers (16.21, 7.02))
                       → ligne encoche supérieure (l3.15-3.15 du rouge)
                       → Z (retour au M, cycle fermé). -->
                <path id="bio2-google-outline" d="M 19.36 3.87 C 17.45 2.09 14.97 1 12 1 C 7.7 1 3.99 3.47 2.18 7.07 A 11 11 0 0 0 2.18 16.93 A 11 11 0 0 0 12 23 C 14.97 23 17.46 22.02 19.28 20.34 C 21.36 18.42 22.56 15.6 22.56 12.25 C 22.56 11.47 22.49 10.72 22.36 10 H 12 V 14.26 H 17.92 C 17.66 15.63 16.88 16.79 15.71 17.57 C 14.72 18.23 13.48 18.63 12 18.63 C 9.14 18.63 6.71 16.7 5.84 14.09 A 6.6 6.6 0 0 1 5.5 12 C 5.5 11.28 5.62 10.57 5.84 9.91 C 6.71 7.31 9.14 5.38 12 5.38 C 13.62 5.38 15.06 5.94 16.21 7.02 L 19.36 3.87 Z" />
                <filter id="bio2-google-glow" x="-100%" y="-100%" width="300%" height="300%">
                  <feGaussianBlur stdDeviation="0.45" result="b1" />
                  <feMerge>
                    <feMergeNode in="b1" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                <filter id="bio2-google-spark" x="-200%" y="-200%" width="500%" height="500%">
                  <feGaussianBlur stdDeviation="1.4" result="b1" />
                  <feMerge>
                    <feMergeNode in="b1" />
                    <feMergeNode in="b1" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <g stroke="#ffffff" stroke-width="0.3" stroke-opacity="0.45">
                <use href="#bio2-google-p1" fill="url(#bio2-google-blue)" />
                <use href="#bio2-google-p2" fill="url(#bio2-google-green)" />
                <use href="#bio2-google-p3" fill="url(#bio2-google-yellow)" />
                <use href="#bio2-google-p4" fill="url(#bio2-google-red)" />
              </g>
              <use href="#bio2-google-outline" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="0.3" filter="url(#bio2-google-glow)" />
              <circle r="0.7" fill="#ffffff" filter="url(#bio2-google-spark)">
                <animateMotion dur="3.4s" repeatCount="indefinite" rotate="auto">
                  <mpath href="#bio2-google-outline" />
                </animateMotion>
              </circle>
            </svg>
            <span>Continue with Google</span>
          </button>
        </div>
        <div class="bio2-auth-sep"><span>or with email</span></div>
        <div class="bio2-field">
          <label class="bio2-field-label" for="auth-email">EMAIL</label>
          <input id="auth-email" class="bio2-input" type="email" autocomplete="email" />
        </div>
        <div class="bio2-field">
          <label class="bio2-field-label" for="auth-password">PASSWORD</label>
          <input id="auth-password" class="bio2-input" type="password" autocomplete="${isSignup ? "new-password" : "current-password"}" />
        </div>
        ${
          isSignup
            ? `
          <div class="bio2-field">
            <label class="bio2-field-label" for="auth-username">USERNAME</label>
            <input id="auth-username" class="bio2-input" type="text" maxlength="16" autocomplete="off" />
          </div>`
            : ""
        }
        <button type="button" class="bio2-auth-cta" data-action="${isSignup ? "signup" : "signin"}">
          ${isSignup ? "CREATE ACCOUNT" : "SIGN IN"}
        </button>
        <p class="bio2-auth-foot">
          You can also <button type="button" class="bio2-auth-link bio2-auth-inline" data-action="play-guest">play as guest</button>
          — your score won't be saved.
        </p>
        <div class="bio2-auth-msg hidden"></div>
      </div>
    `;
    if (this.message) this.setMessage(this.message.kind, this.message.text);
    this.bindSignedOut();
  }

  private bindSignedIn(): void {
    this.root.querySelector<HTMLButtonElement>("[data-action=signout]")?.addEventListener("click", async () => {
      this.setBusy(true);
      await auth.signOut();
      this.setBusy(false);
    });
  }

  private bindUsernamePicker(): void {
    const input = this.root.querySelector<HTMLInputElement>("#auth-username");
    const submit = async () => {
      if (this.busy || !input) return;
      const u = input.value.trim();
      if (!USERNAME_RE.test(u)) {
        this.setMessage("error", "3–16 chars (letters, digits, _ . -).");
        return;
      }
      this.clearMessage();
      this.setBusy(true);
      const { error } = await auth.setUsername(u);
      this.setBusy(false);
      if (error) this.setMessage("error", error);
    };
    this.root.querySelector<HTMLButtonElement>("[data-action=save-username]")?.addEventListener("click", submit);
    input?.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    this.root.querySelector<HTMLButtonElement>("[data-action=signout]")?.addEventListener("click", async () => {
      this.setBusy(true);
      await auth.signOut();
      this.setBusy(false);
    });
  }

  private bindSignedOut(): void {
    this.root.querySelector<HTMLButtonElement>("[data-action=collapse]")?.addEventListener("click", () => {
      this.expanded = false;
      this.clearMessage();
      this.render(auth.getState());
    });
    this.root.querySelectorAll<HTMLButtonElement>(".bio2-auth-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const m = tab.dataset.mode as Mode;
        if (m === this.mode) return;
        this.mode = m;
        this.clearMessage();
        // Re-render manuel (state inchangé, donc auth.subscribe ne re-fire pas).
        this.render(auth.getState());
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>(".bio2-auth-provider").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (this.busy) return;
        const provider = btn.dataset.provider as "google" | "discord";
        this.clearMessage();
        this.setBusy(true);
        const { error } = await auth.signInWithProvider(provider);
        if (error) {
          this.setBusy(false);
          this.setMessage("error", error);
        }
        // Sur succès, supabase-js redirige le navigateur — pas de cleanup ici.
      });
    });
    const action = this.root.querySelector<HTMLButtonElement>("[data-action=signin], [data-action=signup]");
    const submit = async () => {
      if (this.busy) return;
      const email = (this.root.querySelector<HTMLInputElement>("#auth-email")?.value ?? "").trim();
      const password = this.root.querySelector<HTMLInputElement>("#auth-password")?.value ?? "";
      if (!email || !password) {
        this.setMessage("error", "Email and password are required.");
        return;
      }
      this.clearMessage();
      this.setBusy(true);
      if (this.mode === "signup") {
        const username = (this.root.querySelector<HTMLInputElement>("#auth-username")?.value ?? "").trim();
        if (!USERNAME_RE.test(username)) {
          this.setBusy(false);
          this.setMessage("error", "Username: 3–16 chars (letters, digits, _ . -).");
          return;
        }
        const { error, needsVerification } = await auth.signUpWithEmail(email, password, username);
        this.setBusy(false);
        if (error) {
          this.setMessage("error", error);
          return;
        }
        if (needsVerification) {
          this.setMessage("info", "Check your inbox to confirm your email, then sign in.");
          this.mode = "signin";
          this.render(auth.getState());
        }
      } else {
        const { error } = await auth.signInWithEmail(email, password);
        this.setBusy(false);
        if (error) this.setMessage("error", error);
      }
    };
    action?.addEventListener("click", submit);
    this.root.querySelectorAll<HTMLInputElement>("input").forEach((inp) => {
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    });
    this.root.querySelector<HTMLButtonElement>("[data-action=play-guest]")?.addEventListener("click", () => {
      // Scrolle jusqu'au champ CALLSIGN pour rendre le mode invité explicite.
      const callsign = document.getElementById("name-input");
      callsign?.focus();
    });
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
