import type { Request } from "express";

// Balises d'aperçu des liens partagés (Open Graph, tâche 5.5). Les robots
// des messageries et des réseaux (WhatsApp, Discord, X…) lisent le HTML
// sans exécuter le JavaScript : le serveur écrit donc lui-même ces balises
// dans index.html, avec des adresses absolues, dans la langue du visiteur,
// et le texte d'une invitation quand le lien en est une (?room=CODE pour
// un salon privé, ?join=ID pour l'arène publique d'un ami).

export type OgLang = "fr" | "en";

export interface OgRequestInfo {
  // Adresse du jeu, avec la barre finale (https://exemple.com/) ; null si
  // l'hôte de la requête est douteux (adresses relatives alors).
  base: string | null;
  lang: OgLang;
  room: string | null;
  join: string | null;
}

interface OgText {
  title: string;
  description: string;
  roomTitle: (code: string) => string;
  roomDescription: string;
  joinTitle: string;
  joinDescription: string;
  imageAlt: string;
  locale: string;
}

const TEXT: Record<OgLang, OgText> = {
  en: {
    title: "blade.io — Spin to survive",
    description: "Free multiplayer arena in your browser: collect blades, make them orbit around you and shred the other players. No download, no sign-up.",
    roomTitle: (code) => `Join my private room ${code} · blade.io`,
    roomDescription: "A private room between friends, no trophies at stake. Open the link to join, no sign-up needed.",
    joinTitle: "Join me in the arena · blade.io",
    joinDescription: "I'm playing blade.io right now. Open the link to land in the same arena, no sign-up needed.",
    imageAlt: "blade.io: a player surrounded by orbiting blades on a neon grid",
    locale: "en_US",
  },
  fr: {
    title: "blade.io — Tourne pour survivre",
    description: "Arène multijoueur gratuite dans le navigateur : ramasse des lames, fais-les tourner autour de toi et découpe les autres joueurs. Sans téléchargement ni inscription.",
    roomTitle: (code) => `Rejoins mon salon privé ${code} · blade.io`,
    roomDescription: "Un salon privé entre amis, sans trophées en jeu. Ouvre le lien pour nous rejoindre, sans inscription.",
    joinTitle: "Rejoins-moi dans l'arène · blade.io",
    joinDescription: "Je joue à blade.io en ce moment. Ouvre le lien pour atterrir dans la même arène, sans inscription.",
    imageAlt: "blade.io : un joueur entouré de lames en orbite sur une grille néon",
    locale: "fr_FR",
  },
};

export const OG_IMAGE = { path: "og.jpg", type: "image/jpeg", width: 1200, height: 630 };

// Code de salon privé (5 caractères, cf. LoginScreen) et identifiant de
// room Colyseus : tout le reste est ignoré, rien d'arbitraire n'entre
// dans la page.
const ROOM_RE = /^[A-Z0-9]{5}$/;
const JOIN_RE = /^[A-Za-z0-9_-]{4,32}$/;
const HOST_RE = /^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// PUBLIC_URL (facultative) fixe l'adresse publique du jeu ; sinon, celle de
// la requête (protocole vu par le proxy, cf. TRUST_PROXY).
export function publicBase(req: Pick<Request, "protocol" | "get">, publicUrl: string | undefined): string | null {
  if (publicUrl) {
    try {
      const u = new URL(publicUrl);
      if (u.protocol === "https:" || u.protocol === "http:") {
        return `${u.protocol}//${u.host}${u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`}`;
      }
    } catch { /* adresse invalide : on retombe sur la requête */ }
  }
  const host = req.get("host") ?? "";
  if (!HOST_RE.test(host)) return null;
  const proto = req.protocol === "https" ? "https" : "http";
  return `${proto}://${host}/`;
}

export function ogRequestInfo(req: Request, publicUrl: string | undefined = process.env.PUBLIC_URL): OgRequestInfo {
  const room = typeof req.query.room === "string" ? req.query.room.toUpperCase() : "";
  const join = typeof req.query.join === "string" ? req.query.join : "";
  return {
    base: publicBase(req, publicUrl),
    // Sans Accept-Language, la première langue proposée : l'anglais.
    lang: req.acceptsLanguages("en", "fr") === "fr" ? "fr" : "en",
    room: ROOM_RE.test(room) ? room : null,
    join: JOIN_RE.test(join) ? join : null,
  };
}

export function ogTags(info: OgRequestInfo): string {
  const t = TEXT[info.lang];
  let title = t.title;
  let description = t.description;
  let query = "";
  if (info.room) {
    title = t.roomTitle(info.room);
    description = t.roomDescription;
    query = `?room=${info.room}`;
  } else if (info.join) {
    title = t.joinTitle;
    description = t.joinDescription;
    query = `?join=${info.join}`;
  }
  const base = info.base ?? "/";
  const tags: Array<[string, string, string]> = [
    ["name", "description", description],
    ["property", "og:type", "website"],
    ["property", "og:site_name", "blade.io"],
    ["property", "og:title", title],
    ["property", "og:description", description],
  ];
  if (info.base) tags.push(["property", "og:url", `${info.base}${query}`]);
  tags.push(
    ["property", "og:image", `${base}${OG_IMAGE.path}`],
    ["property", "og:image:type", OG_IMAGE.type],
    ["property", "og:image:width", String(OG_IMAGE.width)],
    ["property", "og:image:height", String(OG_IMAGE.height)],
    ["property", "og:image:alt", t.imageAlt],
    ["property", "og:locale", t.locale],
    ["name", "twitter:card", "summary_large_image"],
  );
  return tags.map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escapeAttr(value)}" />`).join("\n    ");
}

// Remplace le bloc balisé de index.html (<!-- og:start --> … <!-- og:end -->).
// Sans ces marqueurs (ancien build), la page part telle quelle.
export function injectOgTags(html: string, info: OgRequestInfo): string {
  const startMark = "<!-- og:start -->";
  const endMark = "<!-- og:end -->";
  const start = html.indexOf(startMark);
  const end = html.indexOf(endMark);
  if (start < 0 || end < start) return html;
  return `${html.slice(0, start + startMark.length)}\n    ${ogTags(info)}\n    ${html.slice(end)}`;
}
