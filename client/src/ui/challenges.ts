import { ChallengeDef, ChallengesResponse, DAILY_CHALLENGES, WEEKLY_CHALLENGES } from "@bladeio/shared";
import { auth } from "../auth/supabase";
import { getGuestToken } from "../auth/guestToken";
import { I18nKey, t } from "../i18n";

// Défis du jour et de la semaine (tâche 5.3), côté client : lecture de la
// progression (compte, sinon portefeuille invité) et textes.

export async function fetchChallenges(): Promise<ChallengesResponse | null> {
  const token = auth.getAccessToken();
  const guest = token ? null : getGuestToken();
  try {
    const r = await fetch(guest ? `/api/challenges?guest=${encodeURIComponent(guest)}` : "/api/challenges", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!r.ok) return null;
    return (await r.json()) as ChallengesResponse;
  } catch {
    return null;
  }
}

// « Lance 20 lames », « Survis 10 min au total »…
export function challengeText(c: Pick<ChallengeDef, "metric" | "target">): string {
  return t(`challenge.${c.metric}` as I18nKey, { n: c.target, min: Math.round(c.target / 60) });
}

export function challengeById(id: string): ChallengeDef | undefined {
  return DAILY_CHALLENGES.find((c) => c.id === id) ?? WEEKLY_CHALLENGES.find((c) => c.id === id);
}

// Temps restant avant les prochains défis : « 3 j 4 h », « 5 h 12 min ».
export function formatCountdown(ms: number): string {
  const min = Math.max(1, Math.ceil(ms / 60000));
  if (min >= 1440) return t("challenge.cdDays", { d: Math.floor(min / 1440), h: Math.floor((min % 1440) / 60) });
  if (min >= 60) return t("challenge.cdHours", { h: Math.floor(min / 60), m: min % 60 });
  return t("challenge.cdMinutes", { m: min });
}
