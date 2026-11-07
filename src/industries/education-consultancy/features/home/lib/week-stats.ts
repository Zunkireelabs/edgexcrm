import { compareToUsual, shownUsual } from "../../pulse/lib/compare";
import type { Tone } from "./types";

export interface WeekMetric {
  key: "calls" | "first_hour" | "moves";
  label: string;
  value: string;
  /** The grey line: "usual 46 · you were on leave Friday". Null when there's nothing honest to compare against. */
  note: string | null;
  tone: Tone;
}

export interface CountInput {
  current: number;
  usual: number;
  hasUsual: boolean;
}

export interface FirstHourInput {
  /** New leads assigned to me in the window, and how many I called within 60 minutes of assignment. */
  current: { called: number; total: number };
  /** Mean of the 4 earlier windows, same definition. Null when there isn't enough history. */
  usual: { called: number; total: number } | null;
}

/** A count metric against the person's usual: the numbers come from Pulse's own per-person maths (compareToUsual). */
export function countMetric(
  key: "calls" | "moves",
  label: string,
  c: CountInput,
  leaveText: string | null,
): WeekMetric {
  const cmp = compareToUsual(c.current, c.usual, c.hasUsual);
  if (!cmp) return { key, label, value: String(c.current), note: null, tone: "neutral" };
  const parts = [`usual ${shownUsual(c.usual)}`];
  // Leave is named as the reason ONLY when the count is down; it is expected, not a problem (amber, never red).
  const down = cmp.pct <= -25;
  if (down && leaveText) parts.push(leaveText);
  const tone: Tone = cmp.pct >= 25 ? "good" : down ? "warn" : "neutral";
  return { key, label, value: String(c.current), note: parts.join(" · "), tone };
}

export const MIN_FIRST_HOUR_USUAL_LEADS = 3;

export function firstHourMetric(f: FirstHourInput): WeekMetric {
  const { called, total } = f.current;
  const value = `${called} of ${total}`;
  const u = f.usual;
  if (total === 0 || !u || u.total < MIN_FIRST_HOUR_USUAL_LEADS) {
    return { key: "first_hour", label: "New leads called within 1 hour", value, note: null, tone: "neutral" };
  }
  const usualCalled = Math.round(u.called);
  const usualTotal = Math.round(u.total);
  const rate = called / total;
  const usualRate = u.called / u.total;
  const diff = rate - usualRate;
  const tone: Tone = diff >= 0.1 ? "good" : diff <= -0.1 ? "warn" : "neutral";
  const word = tone === "good" ? "better than your usual" : tone === "warn" ? "below your usual" : "about your usual";
  return { key: "first_hour", label: "New leads called within 1 hour", value, note: `${word} ${usualCalled} of ${usualTotal}`, tone };
}

/** "Friday", "Thu–Fri" or "12–13 Nov": the approved-leave days inside the window, for "you were on leave …". */
export function leaveText(days: string[]): string | null {
  if (days.length === 0) return null;
  const sorted = [...days].sort();
  const fmt = (d: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", ...opts });
  if (sorted.length === 1) return `you were on leave ${fmt(sorted[0], { weekday: "long" })}`;
  return `you were on leave ${fmt(sorted[0], { day: "numeric" })}–${fmt(sorted[sorted.length - 1], { day: "numeric", month: "short" })}`;
}

/**
 * First-hour counts from raw rows. `leads`: when each lead reached me; `calls`: my call activity times, per lead.
 * A lead counts as "called within 1 hour" when one of my calls on it falls in [assigned, assigned + 60 min].
 */
export function firstHourCounts(
  leads: Array<{ id: string; assignedAt: number }>,
  callsByLead: ReadonlyMap<string, number[]>,
  from: number,
  to: number,
): { called: number; total: number } {
  let total = 0;
  let called = 0;
  for (const l of leads) {
    if (l.assignedAt < from || l.assignedAt >= to) continue;
    total += 1;
    const cs = callsByLead.get(l.id) ?? [];
    if (cs.some((t) => t >= l.assignedAt && t <= l.assignedAt + 3_600_000)) called += 1;
  }
  return { called, total };
}
