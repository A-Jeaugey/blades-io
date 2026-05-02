import { createClient, SupabaseClient, Session } from "@supabase/supabase-js";
import { wallet } from "./wallet";

// Public profile resolved from /api/auth/me (joined username, fresher than
// the JWT user_metadata which can be stale after a username change).
export interface Profile {
  id: string;
  email: string | null;
  username: string | null;
}

export type AuthProvider = "google" | "discord";

export type AuthState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "signed_in"; session: Session; profile: Profile };

type Listener = (state: AuthState) => void;

const AUTH_STORAGE_KEY = "blade.supabase.session";

class AuthService {
  private client: SupabaseClient | null = null;
  private state: AuthState = { status: "loading" };
  private listeners: Set<Listener> = new Set();
  private profileFetchInFlight: Promise<Profile | null> | null = null;

  constructor() {
    const url = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
    const anon = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined;
    if (!url || !anon) {
      // Pas configuré : reste en "signed_out" pour que l'UI ne montre que le
      // mode invité. Aucune erreur — c'est un mode dégradé valide (déploiement
      // sans backend Supabase).
      console.warn("[blade.io] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing — auth disabled");
      this.state = { status: "signed_out" };
      return;
    }
    this.client = createClient(url, anon, {
      auth: {
        persistSession: true,
        storageKey: AUTH_STORAGE_KEY,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    this.bootstrap();
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  private async bootstrap(): Promise<void> {
    if (!this.client) return;
    // detectSessionInUrl: true = supabase-js parse l'URL si on revient d'un
    // OAuth callback (#access_token=...). Il déclenche ensuite onAuthStateChange.
    const { data } = await this.client.auth.getSession();
    if (data.session) {
      const profile = await this.fetchProfile(data.session.access_token);
      this.setState({ status: "signed_in", session: data.session, profile: profile ?? this.fallbackProfile(data.session) });
      // Reload de page avec session active : tenter le claim au cas où le
      // user vient de jouer en mode invité avant de se reconnecter.
      void wallet.claimGuestIfAny();
      void wallet.refresh();
    } else {
      this.setState({ status: "signed_out" });
    }
    this.client.auth.onAuthStateChange(async (event, session) => {
      if (session) {
        // PROFILE_REFRESH n'existe pas, mais on rafraîchit quand même les
        // events utiles (signup, signin, token_refreshed). Le profile est
        // refetch sur chaque changement de session pour propager un
        // changement de username.
        const profile = await this.fetchProfile(session.access_token);
        this.setState({ status: "signed_in", session, profile: profile ?? this.fallbackProfile(session) });
        // Au passage signed-out -> signed-in (signup, signin, oauth callback),
        // on tente de transférer les trophées guest accumulés vers le wallet.
        // Idempotent côté serveur.
        if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
          void wallet.claimGuestIfAny();
          void wallet.refresh();
        }
      } else {
        this.setState({ status: "signed_out" });
      }
      // Nettoyer l'URL après un OAuth callback (sinon le hash reste affiché).
      if (event === "SIGNED_IN" && window.location.hash.includes("access_token")) {
        try {
          history.replaceState(null, "", window.location.pathname + window.location.search);
        } catch { /* noop */ }
      }
    });
  }

  // /api/auth/me renvoie l'utilisateur joint avec le profile (username
  // actuel). On préfère ça à user.user_metadata qui peut désynchroniser
  // après un POST /api/profile.
  private async fetchProfile(accessToken: string): Promise<Profile | null> {
    if (this.profileFetchInFlight) return this.profileFetchInFlight;
    this.profileFetchInFlight = (async () => {
      try {
        const r = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!r.ok) return null;
        const j = await r.json();
        return (j.user as Profile) ?? null;
      } catch {
        return null;
      } finally {
        this.profileFetchInFlight = null;
      }
    })();
    return this.profileFetchInFlight;
  }

  private fallbackProfile(session: Session): Profile {
    return {
      id: session.user.id,
      email: session.user.email ?? null,
      username: null,
    };
  }

  private setState(next: AuthState): void {
    this.state = next;
    for (const l of this.listeners) {
      try { l(next); } catch (e) { console.warn(e); }
    }
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    // Replay : nouveau abonné reçoit immédiatement l'état courant.
    try { l(this.state); } catch (e) { console.warn(e); }
    return () => this.listeners.delete(l);
  }

  getState(): AuthState {
    return this.state;
  }

  getAccessToken(): string | null {
    if (this.state.status !== "signed_in") return null;
    return this.state.session.access_token;
  }

  getUsername(): string | null {
    if (this.state.status !== "signed_in") return null;
    return this.state.profile.username;
  }

  async signInWithEmail(email: string, password: string): Promise<{ error: string | null }> {
    if (!this.client) return { error: "auth_unavailable" };
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    return { error: error ? humanizeAuthError(error.message) : null };
  }

  async signUpWithEmail(email: string, password: string, username: string): Promise<{ error: string | null; needsVerification: boolean }> {
    if (!this.client) return { error: "auth_unavailable", needsVerification: false };
    const { data, error } = await this.client.auth.signUp({
      email,
      password,
      options: {
        // Ce champ remonte dans le trigger handle_new_auth_user côté DB et
        // sert à seed le profile dès l'inscription.
        data: { username },
        emailRedirectTo: window.location.origin,
      },
    });
    if (error) return { error: humanizeAuthError(error.message), needsVerification: false };
    // Si Supabase exige une vérif email, data.session est null et on
    // attend que l'utilisateur clique le mail.
    return { error: null, needsVerification: data.session === null };
  }

  async signInWithProvider(provider: AuthProvider): Promise<{ error: string | null }> {
    if (!this.client) return { error: "auth_unavailable" };
    const { error } = await this.client.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    return { error: error ? humanizeAuthError(error.message) : null };
  }

  async signOut(): Promise<void> {
    if (!this.client) return;
    await this.client.auth.signOut();
  }

  async setUsername(username: string): Promise<{ error: string | null }> {
    const token = this.getAccessToken();
    if (!token) return { error: "not_signed_in" };
    try {
      const r = await fetch("/api/profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ username }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        return { error: humanizeProfileError(j.error ?? "profile_update_failed") };
      }
      const j = await r.json();
      // Met à jour le profile en cache pour que l'UI réagisse instantanément.
      if (this.state.status === "signed_in" && j.user) {
        this.setState({
          status: "signed_in",
          session: this.state.session,
          profile: { ...this.state.profile, ...j.user },
        });
      }
      return { error: null };
    } catch {
      return { error: "Network error" };
    }
  }
}

function humanizeAuthError(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes("invalid login")) return "Wrong email or password.";
  if (lower.includes("user already registered")) return "An account already exists for this email.";
  if (lower.includes("email not confirmed")) return "Email not confirmed yet — check your inbox.";
  if (lower.includes("rate limit")) return "Too many attempts, try again in a minute.";
  if (lower.includes("password")) return msg;
  return msg || "Authentication failed.";
}

function humanizeProfileError(code: string): string {
  switch (code) {
    case "invalid_username":
      return "Username must be 3–16 chars (letters, digits, _ . -).";
    case "username_taken":
      return "Username already taken.";
    case "auth_unavailable":
      return "Auth backend unavailable.";
    case "unauthorized":
      return "Session expired, please sign in again.";
    default:
      return "Could not save username.";
  }
}

export const auth = new AuthService();
