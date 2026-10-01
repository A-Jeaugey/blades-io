// Partage et invitations (tâche 5.5). Sur mobile, la feuille de partage du
// système (Web Share API) ; ailleurs, ou si elle échoue, le lien est copié
// et le bouton l'annonce. Les liens portent l'invitation : ?room=CODE pour
// un salon privé, ?join=ID pour l'arène publique où l'on joue (le serveur
// en tire l'aperçu, cf. server/src/http/ogTags.ts).

export type ShareResult = "shared" | "copied" | "cancelled" | "failed";

export interface ShareData {
  title: string;
  text: string;
  url: string;
}

export interface RoomRef {
  roomId: string;
  code: string;
  isPrivate: boolean;
}

// Lien d'invitation vers la room en cours.
export function inviteUrl(room: RoomRef): string {
  const u = new URL(window.location.origin + window.location.pathname);
  if (room.isPrivate) u.searchParams.set("room", room.code);
  else u.searchParams.set("join", room.roomId);
  return u.toString();
}

// Identifiant d'arène d'un lien « rejoins-moi », s'il est plausible.
export function joinIdFromUrl(): string | null {
  const id = new URL(window.location.href).searchParams.get("join");
  return id && /^[A-Za-z0-9_-]{4,32}$/.test(id) ? id : null;
}

// copyText : copier aussi le texte (score), pas seulement le lien.
export async function share(data: ShareData, opts: { native: boolean; copyText?: boolean }): Promise<ShareResult> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (opts.native && typeof nav.share === "function" && (!nav.canShare || nav.canShare(data))) {
    try {
      await nav.share(data);
      return "shared";
    } catch (e) {
      // Feuille fermée par le joueur : rien à faire. Autre refus (pas de
      // geste utilisateur, partage interdit) : on copie à la place.
      if ((e as DOMException)?.name === "AbortError") return "cancelled";
    }
  }
  return (await copyToClipboard(opts.copyText ? `${data.text} ${data.url}` : data.url)) ? "copied" : "failed";
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* contexte non sécurisé ou refus : repli ci-dessous */ }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  document.body.removeChild(ta);
  return ok;
}
