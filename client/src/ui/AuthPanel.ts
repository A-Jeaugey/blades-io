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
    this.renderSignedOut();
  }

  private renderSignedIn(username: string, email: string): void {
    this.root.classList.remove("hidden");
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
      </div>
      <div class="bio2-auth-body">
        <div class="bio2-auth-providers">
          <button type="button" class="bio2-auth-provider bio2-auth-discord" data-provider="discord">
            <span class="bio2-auth-provider-ic">◈</span> Continue with Discord
          </button>
          <button type="button" class="bio2-auth-provider bio2-auth-google" data-provider="google">
            <span class="bio2-auth-provider-ic">◉</span> Continue with Google
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
