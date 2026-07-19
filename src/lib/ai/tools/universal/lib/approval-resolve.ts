import { leadDisplayName } from "./format";

/**
 * BRIEF-PHASE-4D-APPROVAL-CARD-IDENTITY.md: the approval card is the consent
 * surface — the one moment a human decides whether a write happens. Every id
 * field on it must render a human label resolved server-side from the
 * database, tenant-scoped, never from model output (a hallucinated id would
 * come with a confidently hallucinated name attached). This module is the
 * pure, DOM-free half of that: which fields need resolution (`describeApprovalRows`)
 * and how a resolved/unresolved id renders (`resolveRowDisplay`). The actual
 * DB lookups live server-side in the resolve-approval-refs route.
 */

export const ENTITY_REF_KINDS = ["lead", "assignee", "knowledge_base", "undo_action"] as const;
export type EntityRefKind = (typeof ENTITY_REF_KINDS)[number];

export interface EntityRef {
  kind: EntityRefKind;
  /** null only for "undo_action" — sentinel for "the current user's most recent undoable action". */
  id: string | null;
}

/** Stable map key for a ref — also what the resolve-approval-refs response is keyed by. */
export function refKey(ref: EntityRef): string {
  return `${ref.kind}:${ref.id ?? "latest"}`;
}

export type ResolvedRef = { label: string } | { notFound: true };

export interface PreviewRow {
  label: string;
  /**
   * Renders in a scrollable full-text block instead of a single inline line.
   * Used for the exact text a write tool would create (a note's content, a
   * knowledge item's body) — Phase 4C requirement: the full text being
   * written must be visible on the card before approval, never truncated.
   * An approval a user cannot actually read is not consent.
   */
  long?: boolean;
  /** When set, the displayed value must come from resolving this ref — never rendered from `value`. */
  ref?: EntityRef;
  /** Static, already-known value. Only used when `ref` is absent. */
  value?: string;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function describeCreateTaskInput(input: unknown): PreviewRow[] {
  const i = (input ?? {}) as Record<string, unknown>;
  const rows: PreviewRow[] = [];
  const title = str(i.title);
  if (title) rows.push({ label: "Title", value: title });
  rows.push({ label: "Priority", value: str(i.priority) ?? "normal" });
  rows.push({ label: "Due date", value: str(i.dueDate) ?? "None" });
  const assigneeId = str(i.assigneeId);
  rows.push(assigneeId ? { label: "Assignee", ref: { kind: "assignee", id: assigneeId } } : { label: "Assignee", value: "You" });
  const leadId = str(i.leadId);
  if (leadId) rows.push({ label: "Lead", ref: { kind: "lead", id: leadId } });
  const description = str(i.description);
  if (description) rows.push({ label: "Description", value: description });
  return rows;
}

function describeUpdateLeadStageInput(input: unknown): PreviewRow[] {
  const i = (input ?? {}) as Record<string, unknown>;
  const rows: PreviewRow[] = [];
  const leadId = str(i.leadId);
  if (leadId) rows.push({ label: "Lead", ref: { kind: "lead", id: leadId } });
  // stageName is already a human name supplied by the caller (never an id); stageId
  // is out of scope for this brief (see BRIEF-PHASE-4D's affected-describer table).
  rows.push({ label: "Stage", value: str(i.stageName) ?? str(i.stageId) ?? "—" });
  return rows;
}

function describeAssignLeadInput(input: unknown): PreviewRow[] {
  const i = (input ?? {}) as Record<string, unknown>;
  const rows: PreviewRow[] = [];
  const leadId = str(i.leadId);
  if (leadId) rows.push({ label: "Lead", ref: { kind: "lead", id: leadId } });
  const assigneeId = str(i.assigneeId);
  rows.push(assigneeId ? { label: "Assignee", ref: { kind: "assignee", id: assigneeId } } : { label: "Assignee", value: "—" });
  return rows;
}

function describeUndoLeadActionInput(): PreviewRow[] {
  // No actionId (BRIEF-PHASE-4F) — undo always targets the caller's most
  // recent undoable action, so this ref's id is always the "latest" sentinel.
  return [{ label: "Action", ref: { kind: "undo_action", id: null }, long: true }];
}

function describeCreateLeadNoteInput(input: unknown): PreviewRow[] {
  const i = (input ?? {}) as Record<string, unknown>;
  const rows: PreviewRow[] = [];
  const leadId = str(i.leadId);
  if (leadId) rows.push({ label: "Lead", ref: { kind: "lead", id: leadId } });
  rows.push({ label: "Note", value: str(i.content) ?? "—", long: true });
  return rows;
}

function describeCreateKnowledgeItemInput(input: unknown): PreviewRow[] {
  const i = (input ?? {}) as Record<string, unknown>;
  const rows: PreviewRow[] = [];
  const knowledgeBaseId = str(i.knowledgeBaseId);
  rows.push(
    knowledgeBaseId
      ? { label: "Knowledge base", ref: { kind: "knowledge_base", id: knowledgeBaseId } }
      : { label: "Knowledge base", value: "—" },
  );
  rows.push({ label: "Title", value: str(i.title) ?? "—" });
  rows.push({ label: "Content", value: str(i.content) ?? "—", long: true });
  return rows;
}

/** Per-tool preview renderers. Falls back to a generic key/value dump for any write tool without one. */
const ROW_DESCRIBERS: Record<string, (input: unknown) => PreviewRow[]> = {
  create_task: describeCreateTaskInput,
  update_lead_stage: describeUpdateLeadStageInput,
  assign_lead: describeAssignLeadInput,
  undo_lead_action: describeUndoLeadActionInput,
  create_lead_note: describeCreateLeadNoteInput,
  create_knowledge_item: describeCreateKnowledgeItemInput,
};

export function describeApprovalRows(toolName: string, input: unknown): PreviewRow[] {
  const describer = ROW_DESCRIBERS[toolName];
  if (describer) return describer(input);
  if (!input || typeof input !== "object") return [];
  return Object.entries(input as Record<string, unknown>).map(([label, value]) => ({
    label,
    value: value === undefined || value === null ? "—" : String(value),
  }));
}

/** Dedupes the id-bearing rows down to the unique refs the card actually needs resolved. */
export function collectApprovalRefs(rows: PreviewRow[]): EntityRef[] {
  const seen = new Map<string, EntityRef>();
  for (const row of rows) {
    if (!row.ref) continue;
    seen.set(refKey(row.ref), row.ref);
  }
  return [...seen.values()];
}

export type RowTone = "normal" | "loading" | "notFound";
export interface RowDisplay {
  text: string;
  tone: RowTone;
}

/**
 * Turns a row + the resolved-refs map into what to render. An id that hasn't
 * resolved yet (`loading`) and an id that couldn't be resolved (`notFound`)
 * are deliberately distinct states — see BRIEF-PHASE-4D "Unresolvable ids are
 * a safety feature": a NOT-FOUND id must stay visible, styled destructively,
 * never silently fall back to the raw id looking like a normal value.
 */
export function resolveRowDisplay(row: PreviewRow, resolved: Record<string, ResolvedRef>): RowDisplay {
  if (!row.ref) return { text: row.value ?? "—", tone: "normal" };
  const entry = resolved[refKey(row.ref)];
  if (!entry) return { text: "Resolving…", tone: "loading" };
  if ("notFound" in entry) return { text: `NOT FOUND (${row.ref.id ?? "no matching action"})`, tone: "notFound" };
  return { text: entry.label, tone: "normal" };
}

// ── Server-side label formatting (imported by the resolve-approval-refs route too) ──

export function leadLabel(
  lead: { first_name?: string | null; last_name?: string | null; display_id?: string | null } | null | undefined,
): string {
  if (!lead) return "(no name)";
  const name = leadDisplayName(lead);
  if (!lead.display_id) return name;
  return name === "(no name)" ? lead.display_id : `${name} (${lead.display_id})`;
}

/** Name, falling back to email, falling back to "Unknown" — mirrors team_lookup's convention. */
export function assigneeLabel(name: string | null | undefined, email: string | null | undefined): string {
  return name || email || "Unknown";
}

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours === 0) {
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      return diffMinutes <= 1 ? "just now" : `${diffMinutes} minutes ago`;
    }
    return diffHours === 1 ? "1 hour ago" : `${diffHours} hours ago`;
  }
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export type UndoDescriptionInput =
  | { kind: "stage"; leadLabel: string; from: string; to: string; relativeTime: string }
  | { kind: "assignment"; leadLabel: string; from: string; to: string; relativeTime: string }
  | { kind: "generic"; toolId: string; relativeTime: string };

/** Builds the human sentence for an undo_lead_action card — never an id. */
export function buildUndoDescription(input: UndoDescriptionInput): string {
  switch (input.kind) {
    case "stage":
      return `Undo: stage change on ${input.leadLabel}, ${input.from} → ${input.to}, ${input.relativeTime}`;
    case "assignment":
      return `Undo: assignment change on ${input.leadLabel}, ${input.from} → ${input.to}, ${input.relativeTime}`;
    case "generic":
      return `Undo: "${input.toolId}" action, ${input.relativeTime} (not undoable)`;
  }
}
