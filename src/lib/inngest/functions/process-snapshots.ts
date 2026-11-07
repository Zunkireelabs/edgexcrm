// Processes (EDGEX-109 P1): nightly metric snapshot of every tenant's processes, for trends and before -> after.
// 20:45 UTC = 02:30 in Kathmandu, 15 minutes after the smart-assignment stats job (20:30 UTC).
import { inngest } from "@/lib/inngest/client";
import { snapshotTenant, tenantsWithProcesses } from "@/industries/education-consultancy/features/processes/server/snapshots";

export const processSnapshots = inngest.createFunction(
  { id: "process-snapshots", triggers: [{ cron: "45 20 * * *" }] },
  async ({ step }) => {
    const tenants = await step.run("list-tenants", () => tenantsWithProcesses());
    const results: Record<string, { written: number; skipped: number } | { error: string }> = {};
    for (const tenantId of tenants) {
      results[tenantId] = await step.run(`snapshot-${tenantId}`, async () => {
        try {
          return await snapshotTenant(tenantId);
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      });
    }
    return results;
  },
);
