import { Router, Request, Response } from "express";
import { getAdminClient, isSupabaseConfigured, verifyAccessToken } from "./supabase";
import { isGuestTokenConfigured, signGuestToken, verifyGuestToken } from "./guestToken";
import { claimGuestWallet, createGuestWallet, getGuestWalletBalance, getWallet } from "./wallet";

const USERNAME_RE = /^[A-Za-z0-9_.\-]{3,16}$/;

function bearerToken(req: Request): string | null {
  const h = req.header("authorization") ?? req.header("Authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export function buildAuthRouter(): Router {
  const router = Router();

  // --------------------------------------------------------------------- //
  // GET /api/auth/me
  // Returns { user: { id, email, username } } if the bearer token is valid,
  // otherwise { user: null }.
  // --------------------------------------------------------------------- //
  router.get("/auth/me", async (req: Request, res: Response) => {
    const user = await verifyAccessToken(bearerToken(req));
    res.json({ user });
  });

  // --------------------------------------------------------------------- //
  // POST /api/profile  { username }
  // Sets / changes the caller's username. The format constraint is also
  // enforced at the DB level — we mirror it here so we can return a 400 with
  // a friendly message instead of letting a constraint-violation bubble up.
  // --------------------------------------------------------------------- //
  router.post("/profile", async (req: Request, res: Response) => {
    if (!isSupabaseConfigured()) {
      res.status(503).json({ error: "auth_unavailable" });
      return;
    }
    const user = await verifyAccessToken(bearerToken(req));
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const raw = (req.body?.username ?? "").toString();
    const username = raw.trim();
    if (!USERNAME_RE.test(username)) {
      res.status(400).json({ error: "invalid_username" });
      return;
    }
    const admin = getAdminClient();
    if (!admin) {
      res.status(503).json({ error: "auth_unavailable" });
      return;
    }
    // Upsert : create on first call, rename on subsequent calls. We don't
    // expose the unique-violation as-is, we translate it for the client.
    const { error } = await admin
      .from("profiles")
      .upsert({ id: user.id, username }, { onConflict: "id" });
    if (error) {
      // 23505 = unique_violation (username taken)
      if ((error as any).code === "23505") {
        res.status(409).json({ error: "username_taken" });
        return;
      }
      console.warn("[blade.io] profile upsert failed", error.message);
      res.status(500).json({ error: "profile_update_failed" });
      return;
    }
    res.json({ user: { ...user, username } });
  });

  // --------------------------------------------------------------------- //
  // GET /api/leaderboard  ?limit=100
  // All-time top scores, joined with profile usernames. Uses the public
  // leaderboard_top view.
  // --------------------------------------------------------------------- //
  router.get("/leaderboard", async (req: Request, res: Response) => {
    if (!isSupabaseConfigured()) {
      res.json({ entries: [] });
      return;
    }
    const admin = getAdminClient();
    if (!admin) {
      res.json({ entries: [] });
      return;
    }
    const limit = Math.min(
      Math.max(parseInt((req.query.limit as string) ?? "100", 10) || 100, 1),
      200,
    );
    const { data, error } = await admin
      .from("leaderboard_top")
      .select("user_id, username, score, kills, max_blades, survival_seconds, games_played")
      .limit(limit);
    if (error) {
      console.warn("[blade.io] leaderboard fetch failed", error.message);
      res.status(500).json({ error: "leaderboard_failed" });
      return;
    }
    res.json({ entries: data ?? [] });
  });

  // --------------------------------------------------------------------- //
  // POST /api/guest/init
  // Crée une ligne guest_wallets et retourne un token signé HMAC. Le client
  // le persiste en localStorage et le renvoie au join Colyseus + au moment
  // du claim. No-auth requis (c'est justement le mode invité).
  // --------------------------------------------------------------------- //
  router.post("/guest/init", async (_req: Request, res: Response) => {
    if (!isSupabaseConfigured() || !isGuestTokenConfigured()) {
      res.status(503).json({ error: "guest_unavailable" });
      return;
    }
    const guestId = await createGuestWallet();
    if (!guestId) {
      res.status(500).json({ error: "guest_init_failed" });
      return;
    }
    res.json({ guest_id: guestId, token: signGuestToken(guestId) });
  });

  // --------------------------------------------------------------------- //
  // GET /api/guest/wallet?token=...
  // Lit le solde courant d'un guest token signé. Permet à l'UI d'afficher
  // les trophées accumulés en mode invité. Retourne 0 si déjà claimé.
  // --------------------------------------------------------------------- //
  router.get("/guest/wallet", async (req: Request, res: Response) => {
    if (!isGuestTokenConfigured()) {
      res.status(503).json({ error: "guest_unavailable" });
      return;
    }
    const token = (req.query.token as string | undefined)?.toString() ?? "";
    const guestId = verifyGuestToken(token);
    if (!guestId) {
      res.status(400).json({ error: "invalid_guest_token" });
      return;
    }
    const snap = await getGuestWalletBalance(guestId);
    if (!snap) {
      res.status(404).json({ error: "guest_not_found" });
      return;
    }
    res.json({ balance: snap.balance, claimed: snap.claimed });
  });

  // --------------------------------------------------------------------- //
  // GET /api/wallet
  // Solde courant d'un user authentifié. Auth obligatoire.
  // --------------------------------------------------------------------- //
  router.get("/wallet", async (req: Request, res: Response) => {
    if (!isSupabaseConfigured()) {
      res.status(503).json({ error: "auth_unavailable" });
      return;
    }
    const user = await verifyAccessToken(bearerToken(req));
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const snap = await getWallet(user.id);
    res.json({ balance: snap?.balance ?? 0, total_earned: snap?.total_earned ?? 0 });
  });

  // --------------------------------------------------------------------- //
  // POST /api/wallet/claim  { guest_token }
  // Transfère atomiquement le solde du guest vers le wallet de l'user authed.
  // Idempotent : si déjà claimé par cet user, retourne transferred=0 et le
  // solde courant ; si claimé par un autre, 409.
  // --------------------------------------------------------------------- //
  router.post("/wallet/claim", async (req: Request, res: Response) => {
    if (!isSupabaseConfigured() || !isGuestTokenConfigured()) {
      res.status(503).json({ error: "auth_unavailable" });
      return;
    }
    const user = await verifyAccessToken(bearerToken(req));
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const token = (req.body?.guest_token ?? "").toString();
    const guestId = verifyGuestToken(token);
    if (!guestId) {
      res.status(400).json({ error: "invalid_guest_token" });
      return;
    }
    const result = await claimGuestWallet(user.id, guestId);
    if ("error" in result) {
      if (result.error === "guest_already_claimed") {
        res.status(409).json({ error: "guest_already_claimed" });
        return;
      }
      res.status(500).json({ error: result.error });
      return;
    }
    res.json({ transferred: result.transferred, new_balance: result.new_balance });
  });

  return router;
}
