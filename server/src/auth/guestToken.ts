import crypto from "crypto";

// Signed bearer token issued to guest players when they earn coins. The
// client persists it in localStorage and replays it after sign-up via
// POST /api/wallet/claim-guest, which credits the wallet of the now-authed
// user with the embedded amount.
//
// Format : base64url(JSON payload) "." base64url(HMAC-SHA256(payload))
// Payload : { gid, coins, iat, exp, nonce }
//   gid   : opaque guest session id (Colyseus sessionId or similar)
//   coins : integer reward (server-issued, never trusted from the client)
//   iat   : issued-at (ms epoch)
//   exp   : expiry (ms epoch) — default 30 days
//   nonce : random 96-bit, prevents replay (the server SHOULD record claimed
//           nonces; v1 keeps it stateless and accepts any unexpired nonce
//           since each token is sealed to a single coin amount and each
//           credit is logged in wallet_transactions for auditing).
//
// Secret resolution :
//   - GUEST_TOKEN_SECRET (preferred)
//   - SUPABASE_JWT_SECRET (fallback, already present in many deployments)
//   - else : auto-generated at boot, persistent for the process lifetime.
//     Tokens won't survive a server restart, which is acceptable in dev.

const TTL_MS = 30 * 24 * 3600 * 1000;

let cachedSecret: Buffer | null = null;
function getSecret(): Buffer {
  if (cachedSecret) return cachedSecret;
  const fromEnv =
    process.env.GUEST_TOKEN_SECRET ?? process.env.SUPABASE_JWT_SECRET;
  if (fromEnv && fromEnv.length >= 16) {
    cachedSecret = Buffer.from(fromEnv, "utf8");
  } else {
    console.warn(
      "[blade.io] GUEST_TOKEN_SECRET not set — generating ephemeral secret " +
        "(guest tokens will not survive a server restart).",
    );
    cachedSecret = crypto.randomBytes(32);
  }
  return cachedSecret;
}

function b64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(s: string): Buffer {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4 !== 0) s += "=";
  return Buffer.from(s, "base64");
}

export interface GuestTokenPayload {
  gid: string;
  coins: number;
  iat: number;
  exp: number;
  nonce: string;
}

export function signGuestCoins(gid: string, coins: number): string {
  const payload: GuestTokenPayload = {
    gid,
    coins: Math.max(0, Math.floor(coins)),
    iat: Date.now(),
    exp: Date.now() + TTL_MS,
    nonce: crypto.randomBytes(12).toString("hex"),
  };
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = crypto
    .createHmac("sha256", getSecret())
    .update(body)
    .digest();
  return body + "." + b64urlEncode(sig);
}

export function verifyGuestCoins(token: string): GuestTokenPayload | null {
  if (typeof token !== "string" || token.length === 0) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto
    .createHmac("sha256", getSecret())
    .update(body)
    .digest();
  let provided: Buffer;
  try {
    provided = b64urlDecode(sig);
  } catch {
    return null;
  }
  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(provided, expected)) return null;
  let payload: GuestTokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString("utf8")) as GuestTokenPayload;
  } catch {
    return null;
  }
  if (typeof payload.coins !== "number" || payload.coins < 0) return null;
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
  return payload;
}
