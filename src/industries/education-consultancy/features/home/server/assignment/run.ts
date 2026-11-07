import { logger } from "@/lib/logger";
import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { assignAsSmartAssignment } from "./assign";
import { decideForLead } from "./engine";
import { loadAssignmentSettings } from "./settings";

export type RunResult =
  | { status: "skipped"; reason: "off" | "already_decided" | "already_assigned" | "lead_missing" | "no_candidate" | "no_owner" | "not_permitted" | "failed" }
  | { status: "shadow"; decisionId: string; pickedUserId: string }
  | { status: "assigned"; decisionId: string; pickedUserId: string };

/**
 * The body of the assignment Inngest function, idempotent per lead (one decision row per lead: UNIQUE(tenant_id, lead_id)).
 *   off     nothing.
 *   Nobody could take it (all suspended / on leave / dormant / over the cap): the decision is stored with no pick and the lead stays
 *   unassigned for the owner's "Assign N new leads" row. There is no fallback pick.
 *   shadow  compute and store the pick; assign nothing. A human's later assignment is matched against it.
 *   auto    store the pick, then assign through assignAsSmartAssignment (re-reads the lead inside; skips if assigned meanwhile).
 */
export async function runSmartAssignment(tenantId: string, leadId: string, now: Date = new Date()): Promise<RunResult> {
  const db = await scopedClientForTenant(tenantId);
  const settings = await loadAssignmentSettings(db);
  if (settings.mode === "off") return { status: "skipped", reason: "off" };

  const { data: existing } = await db.from("lead_assignment_decisions").select("id").eq("lead_id", leadId).maybeSingle();
  if (existing) return { status: "skipped", reason: "already_decided" };

  const decided = await decideForLead(tenantId, leadId, now);
  if (!decided) return { status: "skipped", reason: "lead_missing" };
  if (decided.lead.assigned_to) return { status: "skipped", reason: "already_assigned" };
  const { decision } = decided;
  const { data: row, error } = await db
    .from("lead_assignment_decisions")
    .insert({
      lead_id: leadId,
      mode: settings.mode,
      // Null when nobody could take it: the decision is still stored (why, each person's filter) and the lead stays unassigned.
      picked_user_id: decision.pickedUserId,
      candidates: decision.candidates,
      why: decision.why,
      branch_basis: decision.branch,
      // What the lead's branch was before smart assignment moved it (assigning to a person moves a lead to their branch); Undo puts it back.
      prior_branch_id: decided.lead.branch_id,
    })
    .select("id")
    .single();
  if (error || !row) {
    // A concurrent run won the unique constraint: this one is the duplicate.
    return { status: "skipped", reason: "already_decided" };
  }
  const decisionId = (row as unknown as { id: string }).id;
  const pickedUserId = decision.pickedUserId;
  if (!pickedUserId) return { status: "skipped", reason: "no_candidate" };

  if (settings.mode === "shadow") return { status: "shadow", decisionId, pickedUserId };

  const r = await assignAsSmartAssignment({ tenantId, leadId, targetUserId: pickedUserId, decisionId });
  if (r.kind === "skipped") {
    logger.info({ tenantId, leadId, reason: r.reason }, "smart assignment skipped");
    return { status: "skipped", reason: r.reason };
  }
  await db.from("lead_assignment_decisions").update({ applied: true, acted_as_user_id: r.ownerId }).eq("id", decisionId);
  return { status: "assigned", decisionId, pickedUserId };
}
