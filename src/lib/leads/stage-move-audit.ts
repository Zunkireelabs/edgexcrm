/**
 * The audit-log entry for "who holds this lead at the moment it changed stage".
 *
 * System Activity shows a stage move as `Moved from "X" to "Y" · with <name>`. A move that doesn't change the
 * assignee never writes `assigned_to`, so without this the line has no name. EVERY place that writes a stage
 * move (`changes.list`) must also write `changes.holder = holderChange(...)` — `stage-move-audit.contract.test.ts`
 * fails the build if a writer forgets.
 *
 * It is a separate key on purpose, NOT `assigned_to`: `assigned_to` drives assignment events, notifications and
 * undo, and must only appear when the assignee really changed. Add it AFTER `previousValues` is computed.
 */
export function holderChange(assignedTo: string | null | undefined): { old: unknown; new: unknown } {
  return { old: null, new: assignedTo ?? null };
}

/**
 * Exact list ids for a stage move, written NEXT TO `changes.list` (which keeps the human-readable names System
 * Activity reads). Names can be renamed or deleted; ids can't, so Pulse prefers `list_ids` when present.
 * Add it AFTER `previousValues` is computed — it must never reach the undo source.
 */
export function listIdsChange(
  oldId: string | null | undefined,
  newId: string | null | undefined,
): { old: string | null; new: string | null } {
  return { old: oldId ?? null, new: newId ?? null };
}

/** Marker for a stage move made through the bulk route; Pulse keeps these out of per-person "Did" scores. */
export const BULK_VIA = "bulk" as const;
