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
