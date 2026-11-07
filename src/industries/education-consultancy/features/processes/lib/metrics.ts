import type { ProcessKey } from "./keys";

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
}

const num = (raw: RawMetrics, k: string): number | null => {
  const v = raw[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};
const pct = (n: number | null, d: number | null): number | null => (n === null || d === null || d <= 0 ? null : Math.round((n / d) * 1000) / 10);
const n0 = (raw: RawMetrics, k: string) => num(raw, k) ?? 0;

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
        const src = Array.isArray(r.by_source)
          ? (r.by_source as Array<{ medium: string | null; n: number }>).map((s) => `${s.n} ${s.medium ?? "website form"}`).join(" · ")
          : "";
        return `${src}${src ? ". " : ""}${n0(r, "outside_office_hours")} arrived outside office hours.`;
      },
    },
    owner_within_5min_pct: {
      label: "Got an owner within 5 minutes",
      unit: "percent",
      read: (r) => pct(num(r, "owner_within_5min"), num(r, "owner_assigned")),
      detail: (r) =>
        `${n0(r, "owner_within_5min")} of ${n0(r, "owner_assigned")} within 5 minutes. Median wait ${formatMinutes(num(r, "owner_wait_median_min"))}, a quarter waited over ${formatMinutes(num(r, "owner_wait_p75_min"))}.`,
    },
    first_contact_1h_pct: {
      label: "Contacted within 1 hour",
      unit: "percent",
      read: (r) => pct(num(r, "within_1h"), num(r, "arrived")),
      detail: (r) =>
        `${n0(r, "within_1h")} of ${n0(r, "arrived")} within an hour. Median ${formatMinutes(num(r, "first_contact_median_min"))} to first contact. ${n0(r, "never")} never contacted.`,
    },
    callbacks_kept_pct: {
      label: "Call-backs kept on the day",
      unit: "percent",
      read: (r) => pct(num(r, "callbacks_kept"), num(r, "callbacks_booked")),
      detail: (r) => `${n0(r, "callbacks_kept")} of ${n0(r, "callbacks_booked")} call-backs done on the day booked.`,
    },
    reached_qualified_pct: {
      label: "Reached Qualified or later",
      unit: "percent",
      read: (r) => pct(num(r, "reached_qualified"), num(r, "arrived")),
      detail: (r) =>
        `${n0(r, "reached_qualified")} of ${n0(r, "arrived")} are at Qualified or beyond. ${r.reason_field_missing ? "Dropped leads: no reason is recorded yet." : ""}`.trim(),
    },
  },
  visa_to_enrolled: {
    moved_to_enrolled_pct: {
      label: "Visa-approved students moved to Enrolled",
      unit: "percent",
      read: (r) => pct(num(r, "moved_to_enrolled"), n0(r, "moved_to_enrolled") + n0(r, "won_not_enrolled")),
      detail: (r) => `${n0(r, "moved_to_enrolled")} of ${n0(r, "moved_to_enrolled") + n0(r, "won_not_enrolled")} won students are in the Enrolled stage.`,
    },
  },
  dropping_a_student: {
    drops_with_reason_pct: {
      label: "Drops with a reason recorded",
      unit: "percent",
      read: (r) => pct(num(r, "with_reason"), num(r, "dropped")),
      detail: (r) =>
        r.reason_field_missing ? `${n0(r, "dropped")} students were dropped. EdgeX can't record a reason yet.` : `${n0(r, "with_reason")} of ${n0(r, "dropped")} have a reason.`,
    },
  },
  leaver_handover: {
    leavers_holding: {
      label: "Leavers still holding leads",
      unit: "count",
      read: (r) => num(r, "leavers_holding"),
      detail: (r) => `${n0(r, "leavers_holding")} people who left still hold ${n0(r, "all_leads_held")} leads.`,
    },
    live_leads_held: {
      label: "Workable leads held by leavers",
      unit: "count",
      read: (r) => num(r, "live_leads_held"),
      detail: (r) => `${n0(r, "live_leads_held")} of those leads are still open work.`,
    },
  },
};

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
export function readMetric(processKey: ProcessKey, metric: string, raw: RawMetrics): { value: number | null; label: string; unit: MetricUnit; detail: string } | null {
  const def = METRIC_REGISTRY[processKey][metric];
  return def ? { value: def.read(raw), label: def.label, unit: def.unit, detail: def.detail(raw) } : null;
}
