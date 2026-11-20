import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { logger } from "@/lib/logger";
import { classifyHumanAssignment } from "../../lib/assignment/outcome";

/**
 * A human just assigned `leadId` to `assignedTo`. If smart assignment has an open decision for the lead, record whether
 * the human agreed (shadow: matched / overridden) or moved an auto pick (overridden). Called after the fact from
 * applyLeadPatch and the bulk-assign route; best-effort and silent, so it can never change or fail an assignment.
 */
export async function recordHumanAssignment(args: { tenantId: string; leadId: string; assignedTo: string; actorId: string }): Promise<void> {
  try {
    const db = await scopedClientForTenant(args.tenantId);
    const { data } = await db
      .from("lead_assignment_decisions")
      .select("id, mode, picked_user_id, outcome")
      .eq("lead_id", args.leadId)
      .is("outcome", null)
      .maybeSingle();
    const d = data as unknown as { id: string; mode: "shadow" | "auto"; picked_user_id: string | null; outcome: null } | null;
    if (!d) return;
    const outcome = classifyHumanAssignment({ mode: d.mode, pickedUserId: d.picked_user_id, outcome: null }, args.assignedTo);
    if (!outcome) return;
    await db
      .from("lead_assignment_decisions")
      .update({ outcome, outcome_at: new Date().toISOString(), outcome_by: args.actorId, final_user_id: args.assignedTo })
      .eq("id", d.id)
      .is("outcome", null);
  } catch (err) {
    logger.error({ err, leadId: args.leadId }, "recordHumanAssignment failed (non-blocking)");
  }
}
