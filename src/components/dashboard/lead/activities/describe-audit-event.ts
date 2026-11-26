import { describeSubmission, humanizeIntakeValue } from "./lead-activity-labels";
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

// Fields whose old -> new value is short, plain and safe to print on the timeline line ("updated email from a to b").
// Deliberately an allow-list: passport / date of birth / fee / financial details, notes, tags, destinations and other
// structured values are NOT here, so they keep reading as just "updated passport details" and never leak onto the timeline.
const SHOW_VALUES: Record<string, { label: string; format?: (v: string) => string }> = {
  email: { label: "email" },
  phone: { label: "phone" },
  city: { label: "city" },
  country: { label: "country" },
  field_of_study: { label: "field of study" },
  degree_level: { label: "degree level" },
  intake_source: { label: "source", format: humanizeIntakeValue },
};
const MAX_SHOWN_VALUE = 60;
const MAX_DETAILED_FIELDS = 3;

/** A stored value as short plain text; "" when empty; null when it is not a simple value (an object, a list…) and so must not be printed. */
function shortValue(v: unknown, format?: (v: string) => string): string | null {
  if (v === null || v === undefined) return "";
  if (typeof v !== "string" && typeof v !== "number") return null;
  let t = String(v).trim();
  if (format && t) t = format(t);
  return t.length > MAX_SHOWN_VALUE ? `${t.slice(0, MAX_SHOWN_VALUE - 1)}…` : t;
}

/** "email from a to b" / "email to b" / "email (was a)"; null when there is nothing safe or useful to say. */
function describeValueChange(label: string, oldV: unknown, newV: unknown, format?: (v: string) => string): string | null {
  const o = shortValue(oldV, format);
  const n = shortValue(newV, format);
  if (o === null || n === null || (!o && !n)) return null;
  if (!o) return `${label} to ${n}`;
  if (!n) return `${label} (was ${o})`;
  return `${label} from ${o} to ${n}`;
}

const asChange = (c: unknown): { old: unknown; new: unknown } | null =>
  c && typeof c === "object" && !Array.isArray(c) && "new" in c ? (c as { old: unknown; new: unknown }) : null;

/**
 * What one edit changed, as the pieces of "Updated …": the field's name, plus its old and new value for the short safe fields
 * above (up to three of them; every other changed field is just named, exactly as before).
 */
export function describeFieldChanges(changes: Record<string, unknown> | null | undefined): { text: string; detailed: boolean } {
  const all = changes ?? {};
  const seen = new Set<string>();
  const parts: string[] = [];
  let detailed = 0;
  for (const key of Object.keys(all)) {
    const label = FIELD_LABELS[key] ?? key.replace(/_/g, " ");
    if (seen.has(label)) continue;
    seen.add(label);
    let part: string | null = null;
    if (detailed < MAX_DETAILED_FIELDS) {
      if (key === "first_name" || key === "last_name") {
        const f = asChange(all.first_name);
        const l = asChange(all.last_name);
        const full = (a: unknown, b: unknown) => [a, b].map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean).join(" ");
        if (f || l) part = describeValueChange("name", full(f?.old, l?.old), full(f?.new, l?.new));
      } else if (SHOW_VALUES[key]) {
        const c = asChange(all[key]);
        if (c) part = describeValueChange(SHOW_VALUES[key].label, c.old, c.new, SHOW_VALUES[key].format);
      }
    }
    if (part) detailed += 1;
    parts.push(part ?? label);
  }
  // Values can contain commas ("Kathmandu, Nepal"), so lines that carry values are separated with ";" instead.
  return { text: parts.join(detailed > 0 ? "; " : ", "), detailed: detailed > 0 };
}

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
    const { text } = describeFieldChanges(changes);
    return { kind: "updated", verb: text ? `Updated ${text}` : "Updated the lead", object: null };
  }
  if (action === "create" || action === "created" || action === "lead.created") return { kind: "created", verb: "Lead created", object: null };
  if (action === "delete" || action === "deleted" || action === "lead.deleted") return { kind: "deleted", verb: "Deleted the lead", object: null };
  if (activity.entity_type === "checklist" || action.includes("checklist")) return { kind: "checklist", verb: `Checklist ${action}`, object: null };
  if (activity.entity_type === "note" || action.includes("note")) {
    return { kind: "note", verb: action === "lead.note_added" ? "Note added" : `Note ${action}`, object: null };
  }
  return { kind: "default", verb: "Updated the lead", object: null };
}
