// Process Improver "Orca" (EDGEX-109 P4a, doc 03 / docs/reference/03-INNGEST-BACKGROUND-JOBS.md).
//  - `process-improver-weekly`: hourly Fri-Sun UTC; for every education tenant whose local time is Saturday 20:00-20:59, plan the processes
//    worth a run (live, no open draft, off target, not run this week) and run Orca once per process. Drafts are waiting on Sunday morning.
//  - `process-improver-reads`: fired by the nightly snapshot job (event `process/reads.check`); for every live version that is 7+ days old
//    and has no read yet, run Orca once to write its read.
// Both are quiet by design: a failed or skipped run is a log line, never an error that stops anything (the live process keeps running Home).
import { inngest } from "@/lib/inngest/client";
import { logger } from "@/lib/logger";
import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { AGED_EVENT, IMPROVER_EVENT } from "@/industries/education-consultancy/features/processes/server/improver/tools";
import {
  ensureImproverIdentity,
  isWeeklyHour,
  listImproverTenants,
  planReadRuns,
  planWeeklyRuns,
  runImprover,
} from "@/industries/education-consultancy/features/processes/server/improver/run";

export const READS_CHECK_EVENT = "process/reads.check";

export const processImproverWeekly = inngest.createFunction(
  { id: "process-improver-weekly", triggers: [{ cron: "0 * * * 5,6,0" }] },
  async ({ step }) => {
    const now = new Date();
    const tenants = await step.run("list-tenants", async () => (await listImproverTenants()).filter((t) => isWeeklyHour(now, t.tz)));
    if (tenants.length === 0) return { skipped: true, reason: "no tenant is at Saturday 20:00" };

    const results: Record<string, unknown> = {};
    for (const t of tenants) {
      results[t.tenantId] = await step.run(`improve-${t.tenantId}`, async () => {
        try {
          const agentId = await ensureImproverIdentity(t.tenantId);
          if (!agentId) return { skipped: "no active Orca identity" };
          const db = await scopedClientForTenant(t.tenantId);
          const plan = await planWeeklyRuns(db, t.tenantId, agentId, new Date());
          const ran: Array<{ key: string; status: string }> = [];
          for (const p of plan) {
            const r = await runImprover(t.tenantId, agentId, IMPROVER_EVENT, p.processId);
            ran.push({ key: p.key, status: r.status });
          }
          return { planned: plan.length, ran };
        } catch (e) {
          logger.error({ err: e, tenantId: t.tenantId }, "process improver weekly: tenant failed");
          return { error: e instanceof Error ? e.message : String(e) };
        }
      });
    }
    return results;
  },
);

export const processImproverReads = inngest.createFunction(
  { id: "process-improver-reads", triggers: [{ event: READS_CHECK_EVENT }] },
  async ({ event, step }) => {
    const tenantId = (event.data as { tenantId?: unknown } | undefined)?.tenantId;
    if (typeof tenantId !== "string" || tenantId.length === 0) return { skipped: true, reason: "no tenantId" };
    return step.run(`reads-${tenantId}`, async () => {
      try {
        const allowed = (await listImproverTenants()).some((t) => t.tenantId === tenantId);
        if (!allowed) return { skipped: "tenant has no AI grant" };
        const agentId = await ensureImproverIdentity(tenantId);
        if (!agentId) return { skipped: "no active Orca identity" };
        const db = await scopedClientForTenant(tenantId);
        const plan = await planReadRuns(db, agentId, new Date());
        const ran: Array<{ versionId: string; status: string }> = [];
        for (const p of plan) {
          const r = await runImprover(tenantId, agentId, AGED_EVENT, p.processId);
          ran.push({ versionId: p.versionId, status: r.status });
        }
        return { planned: plan.length, ran };
      } catch (e) {
        logger.error({ err: e, tenantId }, "process improver reads: failed");
        return { error: e instanceof Error ? e.message : String(e) };
      }
    });
  },
);
