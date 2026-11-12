import { shortDate, type DateFmt } from "./readiness";

const DAY = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Whole calendar days from `now` to the `YYYY-MM-DD` part of `due` (negative = overdue). Calendar days, not 24h blocks. */
export function daysUntil(due: string, now: Date): number {
  const [y, m, d] = due.slice(0, 10).split("-").map(Number);
  const dueUtc = Date.UTC(y, m - 1, d);
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((dueUtc - todayUtc) / DAY);
}

export interface DueLabel {
  text: string;
  overdue: boolean;
}

/** "Today", "Tomorrow", "Overdue 2d", "Fri 14 Nov" (within 7 days), else "14 Nov". */
export function dueLabel(due: string | null | undefined, now: Date = new Date(), fmt: DateFmt = "dm"): DueLabel | null {
  if (!due) return null;
  const n = daysUntil(due, now);
  if (n < 0) return { text: `Overdue ${-n}d`, overdue: true };
  if (n === 0) return { text: "Today", overdue: false };
  if (n === 1) return { text: "Tomorrow", overdue: false };
  const [y, m, d] = due.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const mon = dt.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  const dm = fmt === "md" ? `${mon} ${d}` : `${d} ${mon}`;
  return { text: n <= 7 ? `${WEEKDAYS[dt.getUTCDay()]} ${dm}` : dm, overdue: false };
}

/** Earliest open task: due date ascending, no due date last. */
export function pickNextTask<T extends { due_date: string | null }>(tasks: readonly T[]): T | null {
  if (tasks.length === 0) return null;
  return [...tasks].sort((a, b) => {
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  })[0];
}

export function daysInStage(stageChangedAt: string | null | undefined, now: Date = new Date()): string {
  if (!stageChangedAt) return "";
  const n = Math.max(0, Math.floor((now.getTime() - new Date(stageChangedAt).getTime()) / DAY));
  if (n === 0) return "Today in stage";
  return n === 1 ? "1 day in stage" : `${n} days in stage`;
}

export type TouchKind = "call" | "email" | "meeting" | "note";
const KIND_LABEL: Record<TouchKind, string> = { call: "Call", email: "Email", meeting: "Meeting", note: "Note" };

export interface LastTouchCard {
  value: string;
  sub: string;
  amber: boolean;
}

/**
 * `followUpLabel` is the result of `followUpBadgeLabel(lead, staleDays)` (columns-registry) — passed in so the card
 * and the table's "since touch" can never disagree. on_hold is already folded into it (null when on hold).
 */
export function lastTouchCard(input: {
  lastTouchedAt: string | null;
  createdAt: string;
  kind: TouchKind | null;
  who: string | null;
  onHold: boolean;
  followUpLabel: string | null;
  staleDays: number;
  now?: Date;
  dateFormat?: DateFmt;
}): LastTouchCard {
  const now = input.now ?? new Date();
  if (!input.lastTouchedAt) {
    return {
      value: "Never touched",
      sub: `Added ${shortDate(input.createdAt, input.dateFormat)}`,
      amber: !input.onHold && input.followUpLabel !== null,
    };
  }
  const n = Math.max(0, Math.floor((now.getTime() - new Date(input.lastTouchedAt).getTime()) / DAY));
  const value = n === 0 ? "Today" : n === 1 ? "Yesterday" : `${n} days ago`;
  const base = [input.kind ? KIND_LABEL[input.kind] : null, input.who].filter(Boolean).join(" · ");
  const amber = !input.onHold && input.followUpLabel !== null;
  let sub = base;
  if (input.onHold) sub = [base, "On hold"].filter(Boolean).join(" · ");
  else if (amber) sub = [base, `over your ${input.staleDays}-day follow-up`].filter(Boolean).join(" · ");
  return { value, sub, amber };
}

/** Activity row time: "now", "{m}m", "{h}h", "{d}d" under 7 days, else "D Mon". */
export function activityTime(iso: string, now: Date = new Date(), fmt: DateFmt = "dm"): string {
  const ms = now.getTime() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return shortDate(iso, fmt);
}

/** Note byline age: "3 days ago", "yesterday", "today". */
export function relativeDays(iso: string, now: Date = new Date()): string {
  const n = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / DAY));
  if (n === 0) return "today";
  if (n === 1) return "yesterday";
  return `${n} days ago`;
}
