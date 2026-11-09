import { buildUserAuthContext } from "@/lib/api/auth";
import { applyLeadPatch } from "@/lib/leads/apply-lead-patch";
import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { pickSystemOwner, SMART_ASSIGNMENT_ACTOR } from "../../lib/assignment/outcome";
import { loadLeadForAssignment } from "./engine";

export type AssignResult =
  | { kind: "assigned"; ownerId: string }
  | { kind: "skipped"; reason: "already_assigned" | "lead_missing" | "no_owner" | "not_permitted" | "failed" };

/** The tenant owner Smart assignment runs as: the earliest-created active owner (deterministic). `strict`: a failed read throws instead of reading as "no owner". */
export async function findSystemOwner(tenantId: string, opts: { strict?: boolean } = {}): Promise<string | null> {
  const db = await scopedClientForTenant(tenantId);
  const { data, error } = await db.from("tenant_users").select("user_id, role, created_at, suspended_at").eq("role", "owner");
  if (error && opts.strict) throw new Error(`smart assignment: owner read failed: ${error.message}`);
  return pickSystemOwner((data ?? []) as unknown as Array<{ user_id: string; role: string; created_at: string; suspended_at: string | null }>);
}

/**
 * THE one place smart assignment writes. It runs the SAME server path as a human assignment (`applyLeadPatch`: chain of
 * custody, list routing, audit, notifications) as the tenant owner (the existing session-less pattern: buildUserAuthContext),
 * with `systemActor` so the audit row, the timeline and the notification say "Smart assignment", not the owner's name.
 * The lead is re-read here: if someone assigned it in the meantime, nothing is written ("already_assigned").
 */
export async function assignAsSmartAssignment(args: { tenantId: string; leadId: string; targetUserId: string; decisionId: string }): Promise<AssignResult> {
  const db = await scopedClientForTenant(args.tenantId);
  const lead = await loadLeadForAssignment(db, args.leadId);
  if (!lead) return { kind: "skipped", reason: "lead_missing" };
  if (lead.assigned_to) return { kind: "skipped", reason: "already_assigned" };
  const ownerId = await findSystemOwner(args.tenantId, { strict: true });
  if (!ownerId) return { kind: "skipped", reason: "no_owner" };
  const auth = await buildUserAuthContext(ownerId, args.tenantId);
  if (!auth) return { kind: "skipped", reason: "no_owner" };
  const outcome = await applyLeadPatch(auth, args.leadId, { assigned_to: args.targetUserId }, {
    requestId: crypto.randomUUID(),
    ip: null,
    userAgent: "smart-assignment",
    systemActor: { key: SMART_ASSIGNMENT_ACTOR.key, label: SMART_ASSIGNMENT_ACTOR.label, decisionId: args.decisionId },
  });
  if (outcome.kind === "ok") return { kind: "assigned", ownerId };
  return { kind: "skipped", reason: outcome.kind === "forbidden" ? "not_permitted" : "failed" };
}
