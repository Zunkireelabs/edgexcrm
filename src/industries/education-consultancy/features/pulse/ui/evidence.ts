import type { EventsQuery } from "../lib/types";

/** What the evidence drawer is showing — every number on the page builds one of these. */
export interface EvidenceTarget {
  title: string;
  /** Breadcrumb tail, e.g. ["Sita Gurung", "Moved forward"]. */
  crumbs: string[];
  query: EventsQuery;
}

export function evidenceQueryString(q: EventsQuery, windowQs: string, extra: Record<string, string | number> = {}): string {
  const p = new URLSearchParams(windowQs);
  p.set("metric", q.metric);
  if (q.userId) p.set("user", q.userId);
  if (q.detail) p.set("detail", q.detail);
  if (q.branchId) p.set("branch", q.branchId);
  for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
  return p.toString();
}

export const METRIC_TITLE: Record<string, string> = {
  calls: "calls",
  notes: "notes (new and edited)",
  moves: "stage moves",
  moves_forward: "leads moved forward",
  back_archived: "leads moved back or archived",
  status_changes: "status changes",
  received: "new leads received",
  prospects: "leads moved to Prospects",
  reached_applications: "leads moved to Applications",
  applications_filed: "applications filed",
  stage_out: "leads that left a stage backwards or to Archive",
  new_leads: "new leads",
  untouched: "new leads untouched for over 48 hours",
};
