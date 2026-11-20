import { encodeFilterTree } from "@/lib/filters/serialize";
import type { FilterTree } from "@/lib/filters/types";
import { addDaysStr, dayBounds, localDate } from "../../../home/lib/time";

/**
 * The leads-list links Orca's tools hand out (doc 07 §4.2: a number must open exactly the records it counts). Only groups the leads
 * filter can express get a link; the others return null and can be quoted but never cited as evidence.
 *
 * The 30-day window is aligned to the tenant's LOCAL midnights, so the same instants go to the SQL and the same dates to the link.
 */

export interface ImproverWindow {
  from: Date;
  /** Exclusive. */
  to: Date;
  tz: string;
  /** First and last local date inside the window (YYYY-MM-DD). */
  firstDay: string;
  lastDay: string;
}

/** The `days` whole local days before today (today excluded), in the tenant's timezone. */
export function improverWindow(now: Date, tz: string, days = 30): ImproverWindow {
  const today = localDate(now, tz);
  const firstDay = addDaysStr(today, -days);
  const lastDay = addDaysStr(today, -1);
  return { from: dayBounds(new Date(`${firstDay}T12:00:00Z`), tz).start, to: dayBounds(now, tz).start, tz, firstDay, lastDay };
}

const href = (tree: FilterTree): string => `/leads?f=${encodeFilterTree(tree)}`;

/** Local dates in the window whose weekday is `dow` (0 = Sunday). */
export function datesOnWeekday(w: Pick<ImproverWindow, "firstDay" | "lastDay">, dow: number): string[] {
  const out: string[] = [];
  for (let d = w.firstDay; d <= w.lastDay; d = addDaysStr(d, 1)) if (new Date(`${d}T00:00:00Z`).getUTCDay() === dow) out.push(d);
  return out;
}

/**
 * The cohort of `education_process_breakdown`: leads that arrived in the window, no walk-ins. `listIds` = every lead list of the tenant, named
 * so the master view's staging/archive hide does not drop the intake leads (it lifts the hide for named lists the viewer may open).
 */
function cohortConditions(w: ImproverWindow, listIds: readonly string[]): FilterTree["conditions"] {
  return [
    { id: "orca:created", field: "created_at", op: "date_between", value: [w.firstDay, w.lastDay] },
    { id: "orca:no-walkins", field: "tags", op: "is_none_of", value: ["other", "parent"] },
    ...(listIds.length ? [{ id: "orca:lists", field: "stage", op: "is_any_of" as const, value: [...listIds] }] : []),
  ];
}

export function cohortHref(w: ImproverWindow, listIds: readonly string[]): string {
  return href({ conjunction: "and", conditions: cohortConditions(w, listIds) });
}

/** The cohort leads that arrived on one weekday (an OR of that weekday's dates inside the window). Null when the window has none. */
export function weekdayHref(w: ImproverWindow, listIds: readonly string[], dow: number): string | null {
  const dates = datesOnWeekday(w, dow);
  if (dates.length === 0) return null;
  const tree: FilterTree = {
    conjunction: "and",
    conditions: cohortConditions(w, listIds),
    groups: [{ conjunction: "or", conditions: dates.map((d) => ({ id: `orca:on-${d}`, field: "created_at", op: "on" as const, value: d })) }],
  };
  return href(tree);
}

/** Unassigned leads in the intake lists: the same link Home's "Assign N new leads" Review opens. */
export function intakeLeftoverHref(intakeListIds: readonly string[]): string | null {
  if (intakeListIds.length === 0) return null;
  return href({
    conjunction: "and",
    conditions: [
      { id: "orca:unassigned", field: "assignees", op: "is_any_of", value: ["unassigned"] },
      { id: "orca:intake", field: "stage", op: "is_any_of", value: [...intakeListIds] },
    ],
  });
}
