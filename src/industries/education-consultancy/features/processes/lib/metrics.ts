import type { ProcessKey } from "./keys";
import { describeOfficeHours } from "./working-hours";

/**
 * The metrics registry: for each process, the named numbers a step's `target.metric` may point at, and how to read each one out of the
 * raw JSON that `education_process_metrics()` (migration 286) returns. Numbers live in SQL, never in the spec.
 */

export type RawMetrics = Record<string, unknown>;
export type MetricUnit = "percent" | "count" | "min";

export interface MetricDef {
  label: string;
  unit: MetricUnit;
  /** The value, or null when it can't be known yet (no denominator, or the field doesn't exist yet). */
  read: (raw: RawMetrics) => number | null;
  /** One honest line of detail from the same raw numbers (shown under the step). */
  detail: (raw: RawMetrics) => string;
  /** Percent metrics only: the "x of y" behind the percentage (same numbers as `detail`). Null when there's no denominator. */
  fraction?: (raw: RawMetrics) => { n: number; d: number } | null;
  /** Short noun after the fraction on a map card ("85 of 131 Qualified+"). */
  fractionNoun?: string;
  /** Short label next to a big number that is not a percent ("median wait"). */
  shortLabel?: string;
  /** Tooltip text for caveats we keep off the card. */
  note?: string;
  /** The list-row label under the headline. Never lower-cased by the UI. Defaults to `label`. */
  listLabel?: (raw: RawMetrics) => string;
  /** Days a version must have been live before before -> after is trusted for this measure. Default 7 (DEFAULT_MIN_DAYS). */
  minDays?: number;
  /**
   * The clock a time-window measure runs on: `clock` = plain minutes since arrival, `working` = minutes inside the tenant's office
   * hours. Read by the policy reader (lib/policy.ts) to decide what Home counts. Absent = not a time-window measure.
   */
  clock?: "clock" | "working";
  /** The window in minutes ("within 1 hour" = 60, "within 5 minutes" = 5). Read with `clock` by the policy reader. */
  windowMin?: number;
  /** The row name on the Before -> after page ("Called within 1 working hour"). Falls back to `label`. */
  compareLabel?: string;
}

/** Before -> after waits this long for a measure that sets no `minDays` of its own. */
export const DEFAULT_MIN_DAYS = 7;

const num = (raw: RawMetrics, k: string): number | null => {
  const v = raw[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};
const pct = (n: number | null, d: number | null): number | null => (n === null || d === null || d <= 0 ? null : Math.round((n / d) * 1000) / 10);
const n0 = (raw: RawMetrics, k: string) => num(raw, k) ?? 0;
const frac = (n: number | null, d: number | null): { n: number; d: number } | null => (n === null || d === null || d <= 0 ? null : { n, d });

/** 3651 -> "3,651". */
export const fmtN = (n: number): string => n.toLocaleString("en-US");

/** How the intake_medium values are shown. null and "/register" are the website form. */
export function friendlySource(medium: string | null): string {
  if (medium === null || medium === "/register") return "website forms";
  const map: Record<string, string> = { "event-page": "event page", dashboard: "added by staff", check_in: "check-in" };
  return map[medium] ?? medium;
}

/**
 * The office hours the SQL used, in words: "Sun–Fri, 9–6" (migration 288 returns days + start_min/end_min). Older snapshots only
 * carry whole-hour `start`/`end`: those read "9–6".
 */
export function officeHoursText(raw: RawMetrics): string {
  const oh = (raw.office_hours ?? {}) as { days?: unknown; start_min?: unknown; end_min?: unknown; start?: unknown; end?: unknown };
  if (Array.isArray(oh.days) && typeof oh.start_min === "number" && typeof oh.end_min === "number") {
    return describeOfficeHours({ days: oh.days.filter((d): d is number => typeof d === "number"), startMin: oh.start_min, endMin: oh.end_min });
  }
  const start = typeof oh.start === "number" ? oh.start : 9;
  const end = typeof oh.end === "number" ? oh.end : 18;
  return `${start > 12 ? start - 12 : start}–${end > 12 ? end - 12 : end}`;
}

/** "1.9 h" / "32 min" / "2.4 days" */
export function formatMinutes(min: number | null): string {
  if (min === null) return "no data";
  if (min < 90) return `${Math.round(min)} min`;
  if (min < 48 * 60) return `${(min / 60).toFixed(1)} h`;
  return `${(min / 1440).toFixed(1)} days`;
}

export const METRIC_REGISTRY: Record<ProcessKey, Record<string, MetricDef>> = {
  new_lead_first_call: {
    arrived: {
      label: "Leads that arrived",
      unit: "count",
      read: (r) => num(r, "arrived"),
      detail: (r) => {
        const merged = new Map<string, number>();
        if (Array.isArray(r.by_source)) for (const s of r.by_source as Array<{ medium: string | null; n: number }>) merged.set(friendlySource(s.medium), (merged.get(friendlySource(s.medium)) ?? 0) + s.n);
        const src = [...merged.entries()].map(([label, n]) => `${fmtN(n)} ${label}`).join(" · ");
        return `${src}${src ? ". " : ""}${fmtN(n0(r, "outside_office_hours"))} arrived outside ${officeHoursText(r)}.`;
      },
    },
    owner_within_5min_pct: {
      label: "Got an owner within 5 minutes",
      clock: "clock",
      windowMin: 5,
      unit: "percent",
      read: (r) => pct(num(r, "owner_within_5min"), num(r, "owner_assigned")),
      fraction: (r) => frac(num(r, "owner_within_5min"), num(r, "owner_assigned")),
      note: "Includes leads created already assigned.",
      detail: (r) => `${fmtN(n0(r, "owner_within_5min"))} of ${fmtN(n0(r, "owner_assigned"))} within 5 minutes. A quarter waited over ${formatMinutes(num(r, "owner_wait_p75_min"))}.`,
    },
    owner_wait_median_min: {
      label: "Median wait for an owner",
      compareLabel: "Wait for an owner (median)",
      shortLabel: "median wait",
      unit: "min",
      read: (r) => num(r, "owner_wait_median_min"),
      detail: (r) => `Median wait ${formatMinutes(num(r, "owner_wait_median_min"))}.`,
    },
    first_contact_1h_pct: {
      label: "Contacted within 1 hour",
      clock: "clock",
      windowMin: 60,
      compareLabel: "Called within 1 hour",
      listLabel: () => "called within 1 hour",
      unit: "percent",
      read: (r) => pct(num(r, "within_1h"), num(r, "arrived")),
      fraction: (r) => frac(num(r, "within_1h"), num(r, "arrived")),
      detail: (r) =>
        `${fmtN(n0(r, "within_1h"))} of ${fmtN(n0(r, "arrived"))} within an hour. Median ${formatMinutes(num(r, "first_contact_median_min"))} to first contact. ${fmtN(n0(r, "never"))} never contacted.`,
    },
    first_contact_1wh_pct: {
      label: "Contacted within 1 working hour",
      clock: "working",
      windowMin: 60,
      compareLabel: "Called within 1 working hour",
      listLabel: () => "called within 1 working hour",
      unit: "percent",
      // Needs `within_1wh` from migration 287; older snapshots don't have it and read as "no data".
      read: (r) => pct(num(r, "within_1wh"), num(r, "arrived")),
      fraction: (r) => frac(num(r, "within_1wh"), num(r, "arrived")),
      detail: (r) =>
        `${fmtN(n0(r, "within_1wh"))} of ${fmtN(n0(r, "arrived"))} within an hour of the working day starting (${officeHoursText(r)}). ${fmtN(n0(r, "never"))} never contacted.`,
    },
    callbacks_kept_pct: {
      label: "Call-backs kept on the day",
      compareLabel: "Call-backs kept on the day",
      unit: "percent",
      read: (r) => pct(num(r, "callbacks_kept"), num(r, "callbacks_booked")),
      fraction: (r) => frac(num(r, "callbacks_kept"), num(r, "callbacks_booked")),
      detail: (r) => `${fmtN(n0(r, "callbacks_kept"))} of ${fmtN(n0(r, "callbacks_booked"))} call-backs done on the day booked.`,
    },
    reached_qualified_pct: {
      label: "Reached Qualified or later",
      compareLabel: "New leads that reached Qualified",
      fractionNoun: "Qualified+",
      minDays: 14,
      unit: "percent",
      read: (r) => pct(num(r, "reached_qualified"), num(r, "arrived")),
      fraction: (r) => frac(num(r, "reached_qualified"), num(r, "arrived")),
      detail: (r) =>
        `${fmtN(n0(r, "reached_qualified"))} of ${fmtN(n0(r, "arrived"))} are at Qualified or beyond. ${r.reason_field_missing ? "Dropped leads: no reason is recorded yet." : ""}`.trim(),
    },
  },
  visa_to_enrolled: {
    moved_to_enrolled_pct: {
      label: "Visa-approved students moved to Enrolled",
      listLabel: () => "students with a visa moved to Enrolled",
      unit: "percent",
      read: (r) => pct(num(r, "moved_to_enrolled"), n0(r, "moved_to_enrolled") + n0(r, "won_not_enrolled")),
      fraction: (r) => frac(num(r, "moved_to_enrolled"), n0(r, "moved_to_enrolled") + n0(r, "won_not_enrolled")),
      detail: (r) => `${fmtN(n0(r, "moved_to_enrolled"))} of ${fmtN(n0(r, "moved_to_enrolled") + n0(r, "won_not_enrolled"))} won students are in the Enrolled stage.`,
    },
  },
  dropping_a_student: {
    drops_with_reason_pct: {
      label: "Drops with a reason recorded",
      listLabel: () => "drops with a reason recorded",
      unit: "percent",
      // The reason field doesn't exist yet, so it is TRUE that no drop has a reason: 0%, not "no data". Nothing dropped = nothing to measure.
      read: (r) => (n0(r, "dropped") <= 0 ? null : r.reason_field_missing ? 0 : pct(num(r, "with_reason"), num(r, "dropped"))),
      fraction: (r) => (n0(r, "dropped") <= 0 ? null : r.reason_field_missing ? { n: 0, d: n0(r, "dropped") } : frac(num(r, "with_reason"), num(r, "dropped"))),
      detail: (r) =>
        r.reason_field_missing
          ? `${fmtN(n0(r, "dropped"))} students were dropped. None has a reason, because EdgeX can't record one yet.`
          : `${fmtN(n0(r, "with_reason"))} of ${fmtN(n0(r, "dropped"))} have a reason.`,
    },
  },
  leaver_handover: {
    leavers_holding: {
      label: "Leavers still holding leads",
      shortLabel: "leavers still holding leads",
      listLabel: (r) => `leavers still hold ${fmtN(n0(r, "all_leads_held"))} leads`,
      unit: "count",
      read: (r) => num(r, "leavers_holding"),
      detail: (r) => `${fmtN(n0(r, "leavers_holding"))} people who left still hold ${fmtN(n0(r, "all_leads_held"))} leads (${fmtN(n0(r, "live_leads_held"))} of them still open).`,
    },
    live_leads_held: {
      label: "Workable leads held by leavers",
      shortLabel: "open leads held",
      unit: "count",
      read: (r) => num(r, "live_leads_held"),
      detail: (r) => `${fmtN(n0(r, "live_leads_held"))} of those leads are still open work.`,
    },
  },
};

/** Which target metrics a step's target picker offers (a fixed list, never free metrics). The first option is the step's default. */
export interface TargetOption {
  metric: string;
  /** Short label in the picker ("hour" / "working hour"). */
  label: string;
  /** The target in words for the map card ("within 1 working hour"). */
  phrase: string;
  /** How a change that switches TO this option is titled: "First contact: count in working hours". */
  countAs: string;
  /** Shown under the target input when this option is picked. */
  hint?: string;
}
export const TARGET_OPTIONS: Partial<Record<ProcessKey, Record<string, TargetOption[]>>> = {
  new_lead_first_call: {
    first_contact: [
      { metric: "first_contact_1h_pct", label: "hour", phrase: "within 1 hour", countAs: "count in hours" },
      { metric: "first_contact_1wh_pct", label: "working hour", phrase: "within 1 working hour", countAs: "count in working hours", hint: "A lead that arrives outside office hours (9–6, every day) is timed from the next time the office opens." },
    ],
  },
};
export const targetOptionsFor = (key: ProcessKey, stepKey: string): TargetOption[] => TARGET_OPTIONS[key]?.[stepKey] ?? [];

/** Days a version must be live before before -> after is shown for this measure. */
export const metricMinDays = (key: ProcessKey, metric: string): number => METRIC_REGISTRY[key][metric]?.minDays ?? DEFAULT_MIN_DAYS;

export type StepStatus = "met" | "amber" | "red" | "unknown";

/** met / amber / red against a target. `>=`: amber from 75% of the target up. `<=`: amber up to 1.5x the target. */
export function stepStatus(value: number | null, op: "<=" | ">=", target: number): StepStatus {
  if (value === null) return "unknown";
  if (op === ">=") {
    if (value >= target) return "met";
    return target > 0 && value / target >= 0.75 ? "amber" : "red";
  }
  if (value <= target) return "met";
  return target > 0 && value <= target * 1.5 ? "amber" : "red";
}

/** Everything the pages need about one metric, read from raw: value, label, unit, detail. */
export function readMetric(
  processKey: ProcessKey,
  metric: string,
  raw: RawMetrics,
): { value: number | null; label: string; unit: MetricUnit; detail: string; fraction: { n: number; d: number } | null } | null {
  const def = METRIC_REGISTRY[processKey][metric];
  return def ? { value: def.read(raw), label: def.label, unit: def.unit, detail: def.detail(raw), fraction: def.fraction?.(raw) ?? null } : null;
}
