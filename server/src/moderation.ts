import { getAdminClient } from "./auth/supabase";

// Signalements de joueurs (tâche 5.6) : une ligne dans le journal du
// serveur, et une ligne de la table reports quand Supabase est configuré
// (migration 0010, lue depuis l'éditeur SQL : aucun client n'y accède).

export interface ReportedPlayer {
  name: string;
  userId: string | null;
  guestId: string | null;
}

export interface ReportEntry {
  roomId: string;
  roomPrivate: boolean;
  reporter: ReportedPlayer;
  target: ReportedPlayer;
  reason: string | null;
  // Derniers messages du joueur signalé, texte d'origine (non masqué).
  recentMessages: Array<{ text: string; ts: number }>;
}

let lastWarnAt = 0;
function warn(message: string): void {
  const now = Date.now();
  if (now - lastWarnAt < 60_000) return;
  lastWarnAt = now;
  console.warn("[blade.io] report:", message);
}

export async function logReport(entry: ReportEntry): Promise<void> {
  console.log(`[blade.io] report ${JSON.stringify(entry)}`);
  const admin = getAdminClient();
  if (!admin) return;
  try {
    const { error } = await admin.from("reports").insert({
      room_id: entry.roomId,
      room_private: entry.roomPrivate,
      reporter_name: entry.reporter.name,
      reporter_user_id: entry.reporter.userId,
      reporter_guest_id: entry.reporter.guestId,
      target_name: entry.target.name,
      target_user_id: entry.target.userId,
      target_guest_id: entry.target.guestId,
      reason: entry.reason,
      recent_messages: entry.recentMessages,
    });
    if (error) warn(error.message);
  } catch (e) {
    warn((e as Error).message);
  }
}
