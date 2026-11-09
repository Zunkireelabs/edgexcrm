import { localDate, localHour } from "./time";

/** Orca's read is made at 7:00 tenant time. The job runs hourly (at :15), so "the 7 o'clock hour" is the slot. */
export const MORNING_HOUR = 7;
/** Only people who opened Home in the last 7 days get a morning read; everyone else gets it on first open. */
export const ACTIVE_DAYS = 7;

export function isMorningSlot(now: Date, tz: string): boolean {
  return localHour(now, tz) === MORNING_HOUR;
}

export interface ReadRowLite {
  user_id: string;
  scope: "me" | "business";
  for_date: string;
  opened_at: string | null;
}

/**
 * Who gets a morning read: (person, scope) pairs with a REAL open in the last 7 days (opened_at, which a job-made row never
 * sets) and no read yet for today. Pure, so "skips inactive users" is a test and not a hope.
 */
export function pairsToMake(rows: ReadRowLite[], now: Date, tz: string): Array<{ userId: string; scope: "me" | "business" }> {
  const today = localDate(now, tz);
  const cutoff = now.getTime() - ACTIVE_DAYS * 86_400_000;
  const haveToday = new Set(rows.filter((r) => r.for_date === today).map((r) => `${r.user_id}|${r.scope}`));
  const out = new Map<string, { userId: string; scope: "me" | "business" }>();
  for (const r of rows) {
    if (!r.opened_at || Date.parse(r.opened_at) < cutoff) continue;
    const k = `${r.user_id}|${r.scope}`;
    if (haveToday.has(k) || out.has(k)) continue;
    out.set(k, { userId: r.user_id, scope: r.scope });
  }
  return [...out.values()];
}
