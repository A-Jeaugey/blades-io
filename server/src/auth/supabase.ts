import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Two clients :
//   - admin : uses the service role key, bypasses RLS, used for trusted
//     server-side writes (recording match scores).
//   - anon  : uses the anon key, used to verify a user's access token via
//     getUser(jwt). Could also be done with a JWKS verifier, but the
//     official client handles key rotation for us.
//
// If the env vars aren't set, both helpers degrade gracefully and auth
// becomes a no-op — guests can still play, scores just won't be persisted.

let admin: SupabaseClient | null = null;
let anon: SupabaseClient | null = null;
let configured = false;

export function initSupabase(): void {
  const url = process.env.SUPABASE_URL?.trim();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !anonKey || !serviceKey) {
    console.warn(
      "[blade.io] Supabase env vars not set — auth and score persistence disabled. " +
        "Required: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.",
    );
    return;
  }

  admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  anon = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  configured = true;
  console.log("[blade.io] Supabase configured");
}

export function isSupabaseConfigured(): boolean {
  return configured;
}

export function getAdminClient(): SupabaseClient | null {
  return admin;
}

export function getAnonClient(): SupabaseClient | null {
  return anon;
}

export interface AuthedUser {
  id: string;
  email: string | null;
  username: string | null;
}

// Verify a user JWT (from the client) and resolve to { id, email, username }.
// Returns null if the token is missing, invalid, expired, or if Supabase
// isn't configured.
export async function verifyAccessToken(token: string | null | undefined): Promise<AuthedUser | null> {
  if (!token || !anon) return null;
  try {
    const { data, error } = await anon.auth.getUser(token);
    if (error || !data?.user) return null;
    const userId = data.user.id;
    let username: string | null = null;
    if (admin) {
      const { data: profile } = await admin
        .from("profiles")
        .select("username")
        .eq("id", userId)
        .maybeSingle();
      username = (profile?.username as string | undefined) ?? null;
    }
    return {
      id: userId,
      email: data.user.email ?? null,
      username,
    };
  } catch (e) {
    console.warn("[blade.io] verifyAccessToken failed", (e as Error).message);
    return null;
  }
}
