import { inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/logger";
import { shouldRequestAssignment } from "../../lib/assignment/outcome";
import { loadAssignmentMode } from "./settings";

/** The event the assignment function listens on. Deliberately NOT crm/lead.created: that one only exists when AI agents are on. */
export const ASSIGNMENT_REQUESTED_EVENT = "crm/lead.assignment.requested";

/**
 * Ask for a smart assignment of a NEW, still-unassigned lead. Called ONLY from the single-lead creation sites (dashboard
 * create, public form submit, integration create). Never from imports, bulk create, ETL or merges: a 7.5k import must
 * never auto-assign (assignment-sites.test.ts holds that line). A cheap settings read first, so a tenant on "off" sends
 * nothing and spends no Inngest quota. Never throws: lead creation must not depend on it.
 */
export async function requestSmartAssignment(args: { tenantId: string; leadId: string; assignedTo: string | null | undefined }): Promise<void> {
  try {
    if (args.assignedTo) return;
    const mode = await loadAssignmentMode(args.tenantId);
    if (!shouldRequestAssignment({ mode, assignedTo: args.assignedTo })) return;
    await inngest.send({ name: ASSIGNMENT_REQUESTED_EVENT, data: { tenantId: args.tenantId, leadId: args.leadId } });
  } catch (err) {
    logger.error({ err, leadId: args.leadId }, "smart assignment request failed (non-blocking)");
  }
}
