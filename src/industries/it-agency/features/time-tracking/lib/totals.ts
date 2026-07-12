import type { TimeEntry } from "@/types/database";

export function calculateBillableMinutes(entries: TimeEntry[]): number {
  return entries
    .filter((e) => e.is_billable && e.approval_status === "approved")
    .reduce((sum, e) => sum + e.minutes, 0);
}

export function calculateBillableAmount(entries: TimeEntry[]): number {
  return entries
    .filter((e) => e.is_billable && e.approval_status === "approved" && e.rate_snapshot != null)
    .reduce((sum, e) => sum + (e.minutes / 60) * (e.rate_snapshot ?? 0), 0);
}

// Cost = Σ over APPROVED entries (billable OR not) of (minutes/60 × cost_rate_snapshot).
// Entries approved before a cost rate was set have cost_rate_snapshot = null and
// contribute 0 — no backfill, cost tracking is forward-looking.
export function calculateCostAmount(entries: TimeEntry[]): number {
  return entries
    .filter((e) => e.approval_status === "approved" && e.cost_rate_snapshot != null)
    .reduce((sum, e) => sum + (e.minutes / 60) * (e.cost_rate_snapshot ?? 0), 0);
}

export interface MinutesBySource {
  timer: number;
  manual: number;
  total: number;
}

export function calculateMinutesBySource(entries: TimeEntry[]): MinutesBySource {
  let timer = 0;
  let manual = 0;
  for (const e of entries) {
    if (e.source === "timer") timer += e.minutes;
    else manual += e.minutes;
  }
  return { timer, manual, total: timer + manual };
}

export interface MarginResult {
  margin: number;
  marginPct: number | null;
}

// Margin = billable revenue − cost. Margin% is null (not 0) when there's no
// revenue to divide by, so callers can distinguish "no data" from "0% margin".
export function calculateMargin(revenue: number, cost: number): MarginResult {
  const margin = revenue - cost;
  return { margin, marginPct: revenue > 0 ? margin / revenue : null };
}
