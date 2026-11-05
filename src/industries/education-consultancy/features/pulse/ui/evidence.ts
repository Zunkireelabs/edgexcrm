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

/** Title + breadcrumb tail for a drawer, in the mockup's words ("9 students delivered to Applications" / "To Applications"). */
export function evidenceLabels(metric: string, n: number, opts: { stage?: string } = {}): { title: string; crumb: string } {
  const one = n === 1;
  switch (metric) {
    case "reached_applications": return { title: `${n} student${one ? "" : "s"} delivered to Applications`, crumb: "To Applications" };
    case "prospects": return { title: `${n} lead${one ? "" : "s"} delivered to Prospects`, crumb: "To Prospects" };
    case "applications_filed": return { title: `${n} application${one ? "" : "s"} filed`, crumb: "Filed" };
    case "moves_forward": return { title: `${n} lead${one ? "" : "s"} moved to ${opts.stage ?? "the next stage"}`, crumb: opts.stage ? `To ${opts.stage}` : "Moved" };
    case "moves": return { title: `${n} stage move${one ? "" : "s"}`, crumb: "Moved" };
    case "back_archived": return { title: `${n} lead${one ? "" : "s"} moved back or archived`, crumb: "Back" };
    case "received": return { title: `${n} new lead${one ? "" : "s"} received`, crumb: "Received" };
    case "untouched": return { title: `${n} lead${one ? "" : "s"} untouched this period`, crumb: "Untouched" };
    case "status_changes": return { title: `${n} status change${one ? "" : "s"}`, crumb: "Status" };
    case "calls": return { title: `${n} call${one ? "" : "s"}`, crumb: "Calls" };
    case "notes": return { title: `${n} note${one ? "" : "s"}`, crumb: "Notes" };
    default: return { title: `${n} ${METRIC_TITLE[metric] ?? metric}`, crumb: metric };
  }
}
