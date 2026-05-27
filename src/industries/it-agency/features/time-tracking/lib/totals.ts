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
