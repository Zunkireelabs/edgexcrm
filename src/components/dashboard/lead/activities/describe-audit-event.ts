import { describeSubmission } from "./lead-activity-labels";

/**
 * ONE place for how a lead audit event reads. The lead page's Activity tab and the record preview both use it,
 * so the wording can't drift. `verb` is the sentence start, `object` the thing it points at (shown in ink by the
 * preview); the full line is `verb + " " + object`.
 */
export type AuditKind =
  | "stage" | "assigned" | "unassigned" | "graduated" | "list" | "submission" | "consent"
  | "created" | "updated" | "deleted" | "checklist" | "note" | "default";

export interface AuditEventInput {
  action: string;
  entity_type: string;
  changes: Record<string, { old: unknown; new: unknown }> | null;
}

export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function describeAuditEvent(
  activity: AuditEventInput,
  /** Label for an assignee id (the Activity tab shows the email; the preview the name). */
  assigneeLabel: (id: string) => string | null | undefined,
): { kind: AuditKind; verb: string; object: string | null } {
  const action = activity.action.toLowerCase();
  const changes = activity.changes || {};

  if (changes.status || changes.stage_id) {
    return { kind: "stage", verb: "Stage changed to", object: `"${formatAuditValue(changes.status?.new || changes.stage_id?.new)}"` };
  }
  if (changes.assigned_to) {
    const to = changes.assigned_to.new;
    if (to) return { kind: "assigned", verb: "Assigned to", object: assigneeLabel(String(to)) || "a team member" };
    return { kind: "unassigned", verb: "Unassigned", object: null };
  }
  if (action === "lead.graduated") {
    const list = changes.list?.new;
    return { kind: "graduated", verb: `Graduated to Sales Leads${list ? ` · ${formatAuditValue(list)}` : ""}`, object: null };
  }
  if (changes.list) return { kind: "list", verb: "Moved to", object: formatAuditValue(changes.list.new) };
  if (action === "lead.submission") return { kind: "submission", verb: describeSubmission(changes), object: null };
  if (action.includes("consent") && action.includes("sign")) return { kind: "consent", verb: "Signed the consent", object: null };
  if (action === "create" || action === "created") return { kind: "created", verb: "Lead created", object: null };
  if (action === "update" || action === "updated") return { kind: "updated", verb: "Lead updated", object: null };
  if (action === "delete" || action === "deleted") return { kind: "deleted", verb: "Lead deleted", object: null };
  if (activity.entity_type === "checklist" || action.includes("checklist")) return { kind: "checklist", verb: `Checklist ${action}`, object: null };
  if (activity.entity_type === "note" || action.includes("note")) {
    return { kind: "note", verb: action === "lead.note_added" ? "Note added" : `Note ${action}`, object: null };
  }
  return { kind: "default", verb: `${activity.action} ${activity.entity_type}`, object: null };
}
