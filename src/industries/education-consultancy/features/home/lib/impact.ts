import type { Tone } from "./types";

/** "Is the new Home helping?": the 3 weeks since go-live need to have passed before they are compared. */
export const AFTER_DAYS = 21;
export const BEFORE_DAYS = 28;

export type ImpactStatus =
  | { kind: "unset" }
  | { kind: "measuring"; since: string }
  | { kind: "ready"; before: { from: Date; to: Date }; after: { from: Date; to: Date } };

/**
 * Windows: after = the last 3 weeks ending now; before = the 4 weeks ending at the launch instant. Until 3 weeks have
 * passed since launch the card says "Measuring since <date>"; with no launch date it says measuring has not started
 * (never zeros).
 */
export function impactStatus(launchedAt: string | null, now: Date): ImpactStatus {
  if (!launchedAt) return { kind: "unset" };
  const launch = Date.parse(launchedAt);
  if (Number.isNaN(launch)) return { kind: "unset" };
  if (now.getTime() < launch + AFTER_DAYS * 86_400_000) return { kind: "measuring", since: launchedAt };
  return {
    kind: "ready",
    before: { from: new Date(launch - BEFORE_DAYS * 86_400_000), to: new Date(launch) },
    after: { from: new Date(now.getTime() - AFTER_DAYS * 86_400_000), to: now },
  };
}

export interface ImpactRaw {
  first_hour: { called: number; total: number };
  callbacks: { done: number; total: number };
  deadlines: { missed: number; total: number };
}

export interface ImpactRow {
  key: "first_hour" | "callbacks" | "deadlines";
  label: string;
  value: string;
  /** "was 52%" / "was 3 in 4 weeks"; null when the baseline has nothing to compare. */
  was: string | null;
  tone: Tone;
}

/** Below this many events a percentage is noise: say so instead of printing 100% of 1. */
export const MIN_EVENTS = 5;

const pct = (n: number, d: number) => Math.round((n / d) * 100);

function rateRow(key: "first_hour" | "callbacks", label: string, after: { n: number; d: number }, before: { n: number; d: number }): ImpactRow {
  if (after.d < MIN_EVENTS) return { key, label, value: "Not enough yet", was: null, tone: "neutral" };
  const a = pct(after.n, after.d);
  if (before.d < MIN_EVENTS) return { key, label, value: `${a}%`, was: null, tone: "neutral" };
  const b = pct(before.n, before.d);
  const diff = a - b;
  return { key, label, value: `${a}%`, was: `was ${b}%`, tone: diff >= 5 ? "good" : diff <= -5 ? "warn" : "neutral" };
}

export function impactRows(before: ImpactRaw, after: ImpactRaw): ImpactRow[] {
  const dlAfter = after.deadlines.missed;
  const dlBefore = before.deadlines.missed;
  // Different window lengths (3 vs 4 weeks): compare per week so the figures are honest.
  const perWeekAfter = dlAfter / (AFTER_DAYS / 7);
  const perWeekBefore = dlBefore / (BEFORE_DAYS / 7);
  const deadlines: ImpactRow = {
    key: "deadlines",
    label: "Deadlines missed",
    value: String(dlAfter),
    was: before.deadlines.total > 0 ? `was ${dlBefore} in 4 weeks` : null,
    tone: before.deadlines.total === 0 ? "neutral" : perWeekAfter < perWeekBefore ? "good" : perWeekAfter > perWeekBefore ? "warn" : "neutral",
  };
  return [
    rateRow("first_hour", "New leads contacted within 1 hour", { n: after.first_hour.called, d: after.first_hour.total }, { n: before.first_hour.called, d: before.first_hour.total }),
    rateRow("callbacks", "Call-backs done on the day booked", { n: after.callbacks.done, d: after.callbacks.total }, { n: before.callbacks.done, d: before.callbacks.total }),
    deadlines,
  ];
}

export function measuringSince(since: string, tz: string): string {
  const d = new Date(since);
  return d.toLocaleDateString("en-GB", { timeZone: tz, day: "numeric", month: "short" });
}

