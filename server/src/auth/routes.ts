import { Router, Request, Response } from "express";
import { getAdminClient, isSupabaseConfigured, verifyAccessToken } from "./supabase";
import { creditWallet, getWallet } from "./wallet";
import { verifyGuestCoins } from "./guestToken";

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
  // --------------------------------------------------------------------- //
  router.get("/auth/me", async (req: Request, res: Response) => {
    const user = await verifyAccessToken(bearerToken(req));
    res.json({ user });
  });

  // --------------------------------------------------------------------- //
  // POST /api/profile  { username }
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
    const { error } = await admin
      .from("profiles")
      .upsert({ id: user.id, username }, { onConflict: "id" });
    if (error) {
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
  // GET /api/wallet
  // Returns the caller's balance / total_earned. 401 for unauthed callers.
  // --------------------------------------------------------------------- //
  router.get("/wallet", async (req: Request, res: Response) => {
    const user = await verifyAccessToken(bearerToken(req));
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const w = await getWallet(user.id);
    res.json({ balance: w.balance, totalEarned: w.totalEarned });
  });

  // --------------------------------------------------------------------- //
  // POST /api/wallet/claim-guest  { token }
  // Verifies a server-signed guest token and credits its `coins` amount to
  // the authenticated user's wallet. Idempotency is currently provided by
  // the token TTL + server-side ledger : every claim writes a unique row
  // in wallet_transactions, so even if the client replays the same token
  // we'd see two rows in the audit log. Future hardening : store a short
  // table of recently-consumed nonces.
  // --------------------------------------------------------------------- //
  router.post("/wallet/claim-guest", async (req: Request, res: Response) => {
    const user = await verifyAccessToken(bearerToken(req));
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const token = (req.body?.token ?? "").toString();
    const payload = verifyGuestCoins(token);
    if (!payload) {
      res.status(400).json({ error: "invalid_token" });
      return;
    }
    if (payload.coins <= 0) {
      res.json({ balance: (await getWallet(user.id)).balance, credited: 0 });
      return;
    }
    const newBalance = await creditWallet(
      user.id,
      payload.coins,
      "guest_claim",
      payload.nonce,
    );
    if (newBalance === null) {
      res.status(503).json({ error: "credit_failed" });
      return;
    }
    res.json({ balance: newBalance, credited: payload.coins });
  });

  // --------------------------------------------------------------------- //
  // GET /api/leaderboards/score  ?limit=100
  // GET /api/leaderboards/coins  ?limit=100
  // GET /api/leaderboard         (legacy alias = score)
  // --------------------------------------------------------------------- //
  const fetchLb = async (
    res: Response,
    view: "leaderboard_top_score" | "leaderboard_top_coins",
    cols: string,
    limit: number,
  ) => {
    if (!isSupabaseConfigured()) {
      res.json({ entries: [] });
      return;
    }
    const admin = getAdminClient();
    if (!admin) {
      res.json({ entries: [] });
      return;
    }
    const { data, error } = await admin.from(view).select(cols).limit(limit);
    if (error) {
      console.warn(`[blade.io] ${view} fetch failed`, error.message);
      res.status(500).json({ error: "leaderboard_failed" });
      return;
    }
    res.json({ entries: data ?? [] });
  };

  const parseLimit = (q: any) =>
    Math.min(Math.max(parseInt((q as string) ?? "100", 10) || 100, 1), 200);

  router.get("/leaderboards/score", (req, res) =>
    fetchLb(
      res,
      "leaderboard_top_score",
      "user_id, username, score, kills, max_blades, survival_seconds, games_played",
      parseLimit(req.query.limit),
    ),
  );

  router.get("/leaderboards/coins", (req, res) =>
    fetchLb(
      res,
      "leaderboard_top_coins",
      "user_id, username, balance, total_earned",
      parseLimit(req.query.limit),
    ),
  );

  // Legacy: keep /api/leaderboard pointing at the score view so the existing
  // login screen panel keeps working without a client redeploy.
  router.get("/leaderboard", (req, res) =>
    fetchLb(
      res,
      "leaderboard_top_score",
      "user_id, username, score, kills, max_blades, survival_seconds, games_played",
      parseLimit(req.query.limit),
    ),
  );

  return router;
}
