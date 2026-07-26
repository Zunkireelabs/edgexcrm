import type { ApplyLeadPatchOutcome } from "@/lib/leads/apply-lead-patch";

/** Fields `undo_lead_action` is allowed to restore from a captured `previousValues` snapshot. */
export const UNDOABLE_LEAD_FIELDS = ["list_id", "assigned_to", "status", "stage_id", "pipeline_id"] as const;

/**
 * Tool ids whose executed write can be undone. Lives here (not in
 * undo-lead-action.ts, which pulls in server-only deps — applyLeadPatch ->
 * next/headers via auth.ts) specifically so it stays importable from a
 * "use client" component: agent-detail-drawer.tsx's Actions-taken section
 * (5.4d) needs this same list client-side to decide whether to render an
 * Undo button, without dragging the whole server write-executor chain into
 * the client bundle. undo-lead-action.ts imports it from here directly and
 * re-exports it; the agent-writes undo route (and resolve-approval-refs)
 * import that re-export rather than this file, so there is still exactly
 * one list, just one indirection away.
 */
export const UNDOABLE_TOOL_IDS = ["update_lead_stage", "assign_lead"];

type NonOkOutcome = Exclude<ApplyLeadPatchOutcome, { kind: "ok" }>;

/**
 * Maps a non-"ok" applyLeadPatch outcome to the tools' house `{ error }` convention.
 * Shared by update_lead_stage and assign_lead so the mapping (incl. the "Lead not
 * found." parity with get_lead — no existence oracle) can't drift between them.
 */
export function leadPatchErrorResult(outcome: NonOkOutcome): { error: string } {
  switch (outcome.kind) {
    case "not_found":
      return { error: "Lead not found." };
    case "forbidden":
      return { error: outcome.message ?? "You don't have permission to make this change." };
    case "validation": {
      const messages = Object.entries(outcome.errors)
        .map(([field, msgs]) => `${field}: ${msgs.join(", ")}`)
        .join("; ");
      return { error: messages };
    }
    case "db_error":
      return { error: "Failed to update the lead. Try again." };
  }
}

/**
 * Narrows a successful outcome's `previousValues` (every updated column) down to the
 * allowlist `undo_lead_action` knows how to restore. Stored in the tool's result so
 * that action's `ai_write_actions` row is undoable (BRIEF-PHASE-4B-LEAD-WRITES.md §4).
 */
export function undoableLeadPrevious(previousValues: Record<string, unknown>): Record<string, unknown> {
  const previous: Record<string, unknown> = {};
  for (const field of UNDOABLE_LEAD_FIELDS) {
    if (field in previousValues) previous[field] = previousValues[field];
  }
  return previous;
}
