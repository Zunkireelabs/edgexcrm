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
  if (!decision.pickedUserId) return { status: "skipped", reason: "no_candidate" };

  const { data: row, error } = await db
    .from("lead_assignment_decisions")
    .insert({
      lead_id: leadId,
      mode: settings.mode,
      picked_user_id: decision.pickedUserId,
      candidates: decision.candidates,
      why: decision.why,
      fallback: decision.fallback,
    })
    .select("id")
    .single();
  if (error || !row) {
    // A concurrent run won the unique constraint: this one is the duplicate.
    return { status: "skipped", reason: "already_decided" };
  }
  const decisionId = (row as unknown as { id: string }).id;

  if (settings.mode === "shadow") return { status: "shadow", decisionId, pickedUserId: decision.pickedUserId };

  const r = await assignAsSmartAssignment({ tenantId, leadId, targetUserId: decision.pickedUserId, decisionId });
  if (r.kind === "skipped") {
    logger.info({ tenantId, leadId, reason: r.reason }, "smart assignment skipped");
    return { status: "skipped", reason: r.reason };
  }
  await db.from("lead_assignment_decisions").update({ applied: true, acted_as_user_id: r.ownerId }).eq("id", decisionId);
  return { status: "assigned", decisionId, pickedUserId: decision.pickedUserId };
}
