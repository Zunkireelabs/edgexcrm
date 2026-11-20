import { describeSubmission } from "./lead-activity-labels";
import { FINANCIAL_COLUMNS, QUALIFICATION_DETAIL_COLUMNS } from "@/lib/leads/student-record-columns";

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

const FIELD_LABELS: Record<string, string> = {
  first_name: "name", last_name: "name", phone: "phone", email: "email", destinations: "destinations",
  field_of_study: "field of study", degree_level: "degree level", tags: "tags", intake_source: "source", source: "source",
  custom_fields: "details", notes: "notes", status: "stage", stage_id: "stage", city: "city", country: "country",
  company_name: "company", designation: "designation", salutation: "salutation", preferred_contact_method: "contact method",
  // The structured address is saved as several columns; one edit should read as one "address".
  full_address: "address", address_province: "address", address_district: "address", address_municipality: "address",
  address_ward: "address", address_tole: "address",
  // Qualification (migration 236) and financial (migration 239) details: one label each, not 19 + 4 raw column names.
  ...Object.fromEntries(QUALIFICATION_DETAIL_COLUMNS.map((c) => [c, "qualification details"])),
  ...Object.fromEntries(FINANCIAL_COLUMNS.map((c) => [c, "financial details"])),
};

/** "tags, phone" for a lead.updated event's changed columns (de-duplicated, never a raw column list of 19). */
export function changedFieldLabels(changes: Record<string, unknown> | null | undefined): string[] {
  const seen = new Set<string>();
  for (const key of Object.keys(changes ?? {})) seen.add(FIELD_LABELS[key] ?? key.replace(/_/g, " "));
  return [...seen];
}

/**
 * The words for an audit event. Every audit row on the lead page goes through here (the Activity tab, the Overview
 * list and the record preview), and NO raw action key ("lead.updated") may reach the screen: an action nobody
 * taught this function falls back to "Updated the lead".
 */
export function describeAuditEvent(
  activity: AuditEventInput,
  /** Label for an assignee id (the Activity tab shows the email; the preview the name). */
  assigneeLabel: (id: string) => string | null | undefined,
): { kind: AuditKind; verb: string; object: string | null } {
  const action = activity.action.toLowerCase();
  const changes = activity.changes || {};

  if (action === "lead.merged") return { kind: "updated", verb: "Merged a duplicate record", object: null };
  if (action === "lead.note_edited") return { kind: "note", verb: "Edited a note", object: null };
  // Stage #678 (Nov 2026): the audit row stores the collaborator's user id; resolve it so the line says who. If the id
  // can't be resolved (account gone, not in the team list) the line stays plain. (Stage's own wording, "Collaborator
  // added: Name", lives in the old Activity panel; this feed reads "<actor> <verb> <object>".)
  if (action === "lead.collaborator_added") {
    const who = changes.collaborator?.new ? assigneeLabel(String(changes.collaborator.new)) : null;
    return who ? { kind: "assigned", verb: "Added collaborator", object: who } : { kind: "assigned", verb: "Added a collaborator", object: null };
  }
  if (action === "lead.collaborator_removed") {
    const who = changes.collaborator?.old ? assigneeLabel(String(changes.collaborator.old)) : null;
    return who ? { kind: "unassigned", verb: "Removed collaborator", object: who } : { kind: "unassigned", verb: "Removed a collaborator", object: null };
  }
  if (action === "lead.branch_shared") {
    const branch = changes.branch?.new as string | null;
    return { kind: "assigned", verb: `Shared to ${branch || "a branch"}`, object: null };
  }
  if (action === "lead.branch_revoked") return { kind: "unassigned", verb: `Removed from ${(changes.branch?.old as string | null) || "a branch"}`, object: null };
  if (action === "lead.branch_assigned") {
    const to = changes.assigned_to?.new;
    const branch = (changes.branch?.new as string | null) || "a branch";
    return to ? { kind: "assigned", verb: `Assigned to ${assigneeLabel(String(to)) || "a team member"} in ${branch}`, object: null } : { kind: "unassigned", verb: `Unassigned in ${branch}`, object: null };
  }
  if (action === "application.reordered") return { kind: "updated", verb: "Reordered applications", object: null };
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
  if (action === "update" || action === "updated" || action === "lead.updated" || action === "lead.update") {
    const labels = changedFieldLabels(changes);
    return { kind: "updated", verb: labels.length ? `Updated ${labels.join(", ")}` : "Updated the lead", object: null };
  }
  if (action === "create" || action === "created" || action === "lead.created") return { kind: "created", verb: "Lead created", object: null };
  if (action === "delete" || action === "deleted" || action === "lead.deleted") return { kind: "deleted", verb: "Deleted the lead", object: null };
  if (activity.entity_type === "checklist" || action.includes("checklist")) return { kind: "checklist", verb: `Checklist ${action}`, object: null };
  if (activity.entity_type === "note" || action.includes("note")) {
    return { kind: "note", verb: action === "lead.note_added" ? "Note added" : `Note ${action}`, object: null };
  }
  return { kind: "default", verb: "Updated the lead", object: null };
}
