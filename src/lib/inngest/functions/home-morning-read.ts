// Orca's read on Home (EDGEX-87 Part B2): made at 7:00 tenant time for people who opened Home in the last 7 days.
// Runs hourly at :15 and acts only in a tenant's 7 o'clock hour (Asia/Kathmandu is UTC+5:45, so 01:15 UTC is exactly 7:00 there);
// a person who already has today's read is skipped, so a retry never makes it twice. Idempotent by construction.
import { inngest } from "@/lib/inngest/client";
import { runMorningReadsForTenant, tenantsForMorningReads, type MorningResult } from "@/industries/education-consultancy/features/home/server/orca-read-job";

export const homeMorningRead = inngest.createFunction(
  { id: "home-morning-read", triggers: [{ cron: "15 * * * *" }] },
  async ({ step }) => {
    const tenants = await step.run("list-tenants", () => tenantsForMorningReads());
    const results: Record<string, MorningResult | { error: string }> = {};
    for (const tenantId of tenants) {
      results[tenantId] = await step.run(`reads-${tenantId}`, async () => {
        try {
          return await runMorningReadsForTenant(tenantId);
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }
      });
    }
    return results;
  },
);
