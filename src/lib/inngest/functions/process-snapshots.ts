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
    // EDGEX-109 P4a: once the night's numbers are in, ask Orca to check for live versions that just turned 7 days old.
    // Fire-and-forget: a failure to enqueue never touches the snapshots above.
    for (const tenantId of tenants) {
      try {
        await step.sendEvent(`reads-check-${tenantId}`, { name: "process/reads.check", data: { tenantId } });
      } catch {
        /* quiet by design */
      }
    }
    return results;
  },
);
