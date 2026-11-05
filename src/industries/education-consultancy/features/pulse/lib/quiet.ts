export interface DailyActivity { day: string; calls: number; notes: number; moves: number }

const isWeekend = (day: string) => { const d = new Date(`${day}T00:00:00Z`).getUTCDay(); return d === 0 || d === 6; };

/**
 * The day someone went quiet, from their daily series: the start of the trailing run of days under 25% of their
 * usual daily activity, moved forward past weekend days (a quiet weekend is normal). Needs a clean stop: at least
 * one earlier day that was NOT quiet, a run of 2+ days, and a working day inside the run. Otherwise null, and the
 * caller falls back to the plain percentage.
 */
export function quietSinceDay(daily: DailyActivity[], usualPerDay: number): string | null {
  if (usualPerDay <= 0 || daily.length < 3) return null;
  const quiet = daily.map((d) => d.calls + d.notes + d.moves < usualPerDay * 0.25);
  let start = daily.length;
  while (start > 0 && quiet[start - 1]) start--;
  if (start === 0 || daily.length - start < 2) return null;
  for (let i = start; i < daily.length; i++) if (!isWeekend(daily[i].day)) return daily[i].day;
  return null;
}

export const weekdayShort = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
