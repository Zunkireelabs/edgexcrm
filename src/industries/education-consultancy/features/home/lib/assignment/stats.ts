import { ATTENDANCE_MIN_PEOPLE, ATTENDANCE_MIN_RECORDS } from "./weights";
import type { PersonStats, Team } from "./score";

export interface StatsRow {
  user_id: string;
  destination: string;
  received: number;
  progressed: number;
  speed_n: number;
  median_first_contact_min: number | null;
  flag_7d: "red" | "amber" | "green" | null;
}

/** Everything the scorer needs about each person from lead_assignment_stats ('*' rows are overall, others per destination). */
export function personFromStats(rows: StatsRow[], userId: string): { overall: PersonStats; byDestination: Record<string, { received: number; progressed: number }>; flag7d: StatsRow["flag_7d"] } {
  const mine = rows.filter((r) => r.user_id === userId);
  const o = mine.find((r) => r.destination === "*");
  const byDestination: Record<string, { received: number; progressed: number }> = {};
  for (const r of mine) if (r.destination !== "*") byDestination[r.destination] = { received: r.received, progressed: r.progressed };
  return {
    overall: { received: o?.received ?? 0, progressed: o?.progressed ?? 0, speedN: o?.speed_n ?? 0, medianFirstContactMin: o?.median_first_contact_min ?? null },
    byDestination,
    flag7d: o?.flag_7d ?? null,
  };
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * The team's rates, from the same people the pick is made among (so "team 31%" in the why-line is that pool's own record).
 * Team speed = the median of each person's median (people with no samples don't vote).
 */
export function buildTeam(rows: StatsRow[], poolUserIds: string[]): Team {
  const inPool = rows.filter((r) => poolUserIds.includes(r.user_id));
  const byDestination: Team["byDestination"] = {};
  let received = 0;
  let progressed = 0;
  for (const r of inPool) {
    if (r.destination === "*") {
      received += r.received;
      progressed += r.progressed;
    } else {
      const d = byDestination[r.destination] ?? { received: 0, progressed: 0 };
      d.received += r.received;
      d.progressed += r.progressed;
      byDestination[r.destination] = d;
    }
  }
  const speeds = inPool.filter((r) => r.destination === "*" && r.speed_n > 0 && r.median_first_contact_min !== null).map((r) => r.median_first_contact_min as number);
  return { byDestination, overall: { received, progressed }, medianFirstContactMin: median(speeds) };
}

/**
 * Does this tenant really use attendance? At least 30 records from at least 3 different people in the last 30 days.
 * Admizz (1 record in 30 days) does not, so Present = any contact in the last 2 hours there. A tenant that adopts
 * clock-in later switches over by itself.
 */
export function attendanceMeaningful(recordUserIdsLast30Days: string[]): boolean {
  return recordUserIdsLast30Days.length >= ATTENDANCE_MIN_RECORDS && new Set(recordUserIdsLast30Days).size >= ATTENDANCE_MIN_PEOPLE;
}
