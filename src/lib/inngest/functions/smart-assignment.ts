// Smart lead assignment (EDGEX-87 A3): rule-based and explainable, not an LLM. Two functions:
//   smart-assignment-on-lead   crm/lead.assignment.requested -> compute the pick (shadow) or compute + assign (auto). Idempotent per lead.
//   smart-assignment-stats     nightly: refresh the rate stats + Pulse's 7-day flags for every tenant that has it on.
import { inngest } from "@/lib/inngest/client";
import { ASSIGNMENT_REQUESTED_EVENT } from "@/industries/education-consultancy/features/home/server/assignment/request";
import { runSmartAssignment } from "@/industries/education-consultancy/features/home/server/assignment/run";
import { refreshTenantStats, tenantsWithAssignmentOn } from "@/industries/education-consultancy/features/home/server/assignment/refresh-stats";

export const smartAssignmentOnLead = inngest.createFunction(
  {
    id: "smart-assignment-on-lead",
    triggers: [{ event: ASSIGNMENT_REQUESTED_EVENT }],
    concurrency: { limit: 4, key: "event.data.tenantId" },
    // The same lead requested twice (a retry, a double submit) is one run.
    idempotency: "event.data.leadId",
  },
  async ({ event, step }) => {
    const { tenantId, leadId } = event.data as { tenantId: string; leadId: string };
    return step.run("decide-and-assign", () => runSmartAssignment(tenantId, leadId));
  },
);

export const smartAssignmentStats = inngest.createFunction(
  // 20:30 UTC = 02:15 in Kathmandu: after the working day, before the next one.
  { id: "smart-assignment-stats", triggers: [{ cron: "30 20 * * *" }] },
  async ({ step }) => {
    const tenants = await step.run("list-tenants", () => tenantsWithAssignmentOn());
    const results: Record<string, { rows: number; flagged: number } | { error: string }> = {};
    for (const tenantId of tenants) {
      results[tenantId] = await step.run(`refresh-${tenantId}`, async () => {
        try {
          return await refreshTenantStats(tenantId);
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      });
    }
    return results;
  },
);
