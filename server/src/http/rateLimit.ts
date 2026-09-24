import { RequestHandler } from "express";

// Limiteur à fenêtre fixe par IP, en mémoire du process. Suffisant pour un
// serveur unique : le but n'est pas de compter à la requête près mais
// d'empêcher un script de remplir la base (/api/guest/init crée une ligne à
// chaque appel) ou de marteler les RPC Supabase.
//
// La clé est req.ip : elle ne vaut l'IP du joueur que si `trust proxy` est
// réglé selon le déploiement (cf. index.ts), sinon tous les joueurs
// derrière le reverse proxy partageraient le même compteur.
export function rateLimit(opts: { windowMs: number; max: number }): RequestHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();
  let lastSweep = Date.now();
  return (req, res, next) => {
    const now = Date.now();
    // Purge paresseuse des fenêtres expirées : sans ça la Map garde une
    // entrée par IP vue depuis le démarrage du process.
    if (now - lastSweep > opts.windowMs) {
      for (const [ip, entry] of hits) {
        if (entry.resetAt <= now) hits.delete(ip);
      }
      lastSweep = now;
    }
    const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + opts.windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (entry.count > opts.max) {
      res.setHeader("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      res.status(429).json({ error: "rate_limited" });
      return;
    }
    next();
  };
}
