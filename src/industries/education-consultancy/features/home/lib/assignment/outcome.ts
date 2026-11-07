export type AssignmentMode = "off" | "shadow" | "auto";
export const ASSIGNMENT_MODES: readonly AssignmentMode[] = ["off", "shadow", "auto"];

export interface DecisionLike {
  mode: "shadow" | "auto";
  pickedUserId: string | null;
  outcome: "matched" | "overridden" | "undone" | null;
  applied?: boolean;
}

/**
 * What a HUMAN assigning a lead means for an open decision.
 *   shadow: the pick was never applied, so the human choosing the same person = matched, anyone else = overridden.
 *   auto:   the pick is already applied; the human moving it to someone else = overridden (undo is its own outcome).
 *           Assigning it to the picked person again is a no-op, not a confirmation.
 * A decision with an outcome is final.
 */
export function classifyHumanAssignment(d: DecisionLike, assignedTo: string): "matched" | "overridden" | null {
  if (d.outcome !== null) return null;
  if (d.mode === "shadow") return assignedTo === d.pickedUserId ? "matched" : "overridden";
  return assignedTo === d.pickedUserId ? null : "overridden";
}

/** "Smart assignment agreed with your managers 34 of 40 times (85%)". Shadow decisions a human has resolved. */
export function agreement(decisions: Array<Pick<DecisionLike, "mode" | "outcome">>): { matched: number; total: number; pct: number | null } {
  const resolved = decisions.filter((d) => d.mode === "shadow" && (d.outcome === "matched" || d.outcome === "overridden"));
  const matched = resolved.filter((d) => d.outcome === "matched").length;
  return { matched, total: resolved.length, pct: resolved.length ? Math.round((matched / resolved.length) * 100) : null };
}

/** Only unassigned new leads are requested for assignment, and only when the tenant turned it on. */
export function shouldRequestAssignment(a: { mode: AssignmentMode; assignedTo: string | null | undefined }): boolean {
  return a.mode !== "off" && !a.assignedTo;
}

/**
 * Smart assignment writes as the tenant owner (the existing session-less pattern: buildUserAuthContext), chosen
 * deterministically: the EARLIEST-created, active (not suspended) owner. Null when the tenant has none.
 */
export function pickSystemOwner(rows: Array<{ user_id: string; role: string; created_at: string; suspended_at: string | null }>): string | null {
  const owners = rows.filter((r) => r.role === "owner" && !r.suspended_at);
  owners.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.user_id.localeCompare(b.user_id));
  return owners[0]?.user_id ?? null;
}

/** The assignee's notification names the rule, never the owner it runs as. */
export function smartAssignmentNotification(leadName: string): { title: string; message: string } {
  return { title: "Lead assigned to you", message: `Smart assignment assigned you ${leadName}` };
}

/** Undo only while the lead is still with the person smart assignment picked, and the decision is still open. */
export function canUndo(d: DecisionLike, currentAssignee: string | null): boolean {
  return d.mode === "auto" && d.outcome === null && !!d.pickedUserId && currentAssignee === d.pickedUserId;
}

export const SMART_ASSIGNMENT_ACTOR = { key: "smart_assignment", label: "Smart assignment" } as const;
