import type { ApplyLeadPatchOutcome } from "@/lib/leads/apply-lead-patch";

/** Fields `undo_lead_action` is allowed to restore from a captured `previousValues` snapshot. */
export const UNDOABLE_LEAD_FIELDS = ["list_id", "assigned_to", "status", "stage_id", "pipeline_id"] as const;

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
