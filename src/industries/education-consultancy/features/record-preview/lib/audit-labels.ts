import { describeSubmission } from "@/components/dashboard/lead/activities/lead-activity-labels";

export interface AuditRow {
  id: string;
  action: string;
  entity_type: string;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  user_id: string | null;
  created_at: string;
}

const fmt = (v: unknown): string => (v === null || v === undefined ? "None" : typeof v === "object" ? JSON.stringify(v) : String(v));

/**
 * Verb/object of one audit event, worded exactly like the lead page's Activity tab (`getActivityDisplay` in
 * activity-tab.tsx is private to that file, so the same branches live here). Returns null for events the preview skips.
 */
export function describeAudit(row: AuditRow, assigneeName: (id: string) => string | null): { verb: string; object: string | null } | null {
  const action = row.action.toLowerCase();
  const changes = row.changes ?? {};
  if (changes.status || changes.stage_id) return { verb: "stage changed to", object: fmt(changes.status?.new ?? changes.stage_id?.new) };
  if (changes.assigned_to) {
    const to = changes.assigned_to.new;
    return to ? { verb: "assigned to", object: assigneeName(String(to)) ?? "a team member" } : { verb: "unassigned", object: null };
  }
  if (changes.list) return { verb: "moved to", object: fmt(changes.list.new) };
  if (action === "lead.submission") return { verb: describeSubmission(changes).toLowerCase().replace(/^lead created/, "created the lead"), object: null };
  if (action === "create" || action === "created") return { verb: "created the lead", object: null };
  if (action.includes("consent") && action.includes("sign")) return { verb: "signed the consent", object: null };
  return null;
}
