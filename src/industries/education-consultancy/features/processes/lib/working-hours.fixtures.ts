import type { OfficeHours } from "./working-hours";

/**
 * The parity table for the office-hours clock. `deadline` was computed by an independent Python oracle (zoneinfo, wall-clock arithmetic),
 * not by this code. The TS test runs every row through `workingDeadline`; the same rows run through
 * `education_working_deadline_oh(jsonb, tz, at, minutes)` in migration 288 on a real database (SQL in the migration's header comment).
 */
export interface DeadlineFixture {
  name: string;
  at: string;
  minutes: number;
  days: number[];
  startMin: number;
  endMin: number;
  tz: string;
  deadline: string;
}

export const DEADLINE_FIXTURES: DeadlineFixture[] = [
  { name: "Saturday 20:10 lead, 60 min", at: "2026-11-07T14:25:00Z", minutes: 60, days: [0, 1, 2, 3, 4, 5], startMin: 540, endMin: 1080, tz: "Asia/Kathmandu", deadline: "2026-11-08T04:15:00Z" },
  { name: "Saturday 20:10 lead, 0 min (clock start)", at: "2026-11-07T14:25:00Z", minutes: 0, days: [0, 1, 2, 3, 4, 5], startMin: 540, endMin: 1080, tz: "Asia/Kathmandu", deadline: "2026-11-08T03:15:00Z" },
  { name: "Friday 17:30 + 60 rolls over the closed Saturday", at: "2026-11-06T11:45:00Z", minutes: 60, days: [0, 1, 2, 3, 4, 5], startMin: 540, endMin: 1080, tz: "Asia/Kathmandu", deadline: "2026-11-08T03:45:00Z" },
  { name: "Thursday 08:00, before opening", at: "2026-11-05T02:15:00Z", minutes: 60, days: [0, 1, 2, 3, 4, 5], startMin: 540, endMin: 1080, tz: "Asia/Kathmandu", deadline: "2026-11-05T04:15:00Z" },
  { name: "exactly 18:00 Thursday = closed", at: "2026-11-05T12:15:00Z", minutes: 60, days: [0, 1, 2, 3, 4, 5], startMin: 540, endMin: 1080, tz: "Asia/Kathmandu", deadline: "2026-11-06T04:15:00Z" },
  { name: "Sunday 09:00 sharp", at: "2026-11-01T03:15:00Z", minutes: 60, days: [0, 1, 2, 3, 4, 5], startMin: 540, endMin: 1080, tz: "Asia/Kathmandu", deadline: "2026-11-01T04:15:00Z" },
  { name: "23:59 Nepal time Thursday (UTC is still Thursday)", at: "2026-11-05T18:14:00Z", minutes: 60, days: [0, 1, 2, 3, 4, 5], startMin: 540, endMin: 1080, tz: "Asia/Kathmandu", deadline: "2026-11-06T04:15:00Z" },
  { name: "600 minutes from Thursday 10:00", at: "2026-11-05T04:15:00Z", minutes: 600, days: [0, 1, 2, 3, 4, 5], startMin: 540, endMin: 1080, tz: "Asia/Kathmandu", deadline: "2026-11-06T05:15:00Z" },
  { name: "1000 minutes from Friday 15:00 spans the weekend", at: "2026-11-06T09:15:00Z", minutes: 1000, days: [0, 1, 2, 3, 4, 5], startMin: 540, endMin: 1080, tz: "Asia/Kathmandu", deadline: "2026-11-09T07:55:00Z" },
  { name: "half-hour hours 9:30-17:30, arrives 17:00", at: "2026-11-03T11:15:00Z", minutes: 60, days: [0, 1, 2, 3, 4, 5], startMin: 570, endMin: 1050, tz: "Asia/Kathmandu", deadline: "2026-11-04T04:15:00Z" },
  { name: "New York Mon-Fri 9-17, Friday 16:30 over the US clock change", at: "2026-10-30T20:30:00Z", minutes: 60, days: [1, 2, 3, 4, 5], startMin: 540, endMin: 1020, tz: "America/New_York", deadline: "2026-11-02T14:30:00Z" },
  { name: "Sydney Mon-Fri 9-17, Friday 16:45", at: "2026-11-06T05:45:00Z", minutes: 60, days: [1, 2, 3, 4, 5], startMin: 540, endMin: 1020, tz: "Australia/Sydney", deadline: "2026-11-08T22:45:00Z" },
];

export const fixtureOfficeHours = (f: Pick<DeadlineFixture, "days" | "startMin" | "endMin">): OfficeHours => ({ days: f.days, startMin: f.startMin, endMin: f.endMin, source: "saved" });
