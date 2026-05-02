import crypto from "node:crypto";

// Guest token = `<guest_id>.<hmac_sha256(guest_id)>` en base64url. Le serveur
// signe avec SERVER_GUEST_SECRET ; le client le stocke en localStorage et le
// renvoie à chaque join (Colyseus options.guestToken) et au moment du claim.
//
// On ne met pas d'expiration : la ligne guest_wallets est la seule source de
// vérité, et c'est elle qui devient inerte une fois claimée. Si le secret
// est rotaté, tous les tokens existants deviennent invalides — les users
// invités perdent leur balance accumulé non-claimé. Acceptable pour un
// rotate exceptionnel.

const SECRET = (process.env.SERVER_GUEST_SECRET ?? "").trim();

export function isGuestTokenConfigured(): boolean {
  return SECRET.length > 0;
}

export function signGuestToken(guestId: string): string {
  const sig = crypto.createHmac("sha256", SECRET).update(guestId).digest("base64url");
  return `${guestId}.${sig}`;
}

export function verifyGuestToken(token: string | null | undefined): string | null {
  if (!token || !SECRET) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [guestId, sig] = parts;
  // UUID v4 format (36 chars), filtre rapide avant le HMAC pour éviter le
  // travail si le client envoie n'importe quoi.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(guestId)) {
    return null;
  }
  const expected = crypto.createHmac("sha256", SECRET).update(guestId).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  return guestId;
}
