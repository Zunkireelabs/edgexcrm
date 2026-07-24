// Durable cron consumer for the Daily Digest agent (doc 03 §2, §4). A cron has no single
// tenant, so this enumerates every tenant with an active daily-digest identity via the
// service client (cross-tenant read — lint-allowed here, unlike under src/lib/ai/) and runs
// the agent once per tenant. All other guards (kill switch, budget, identity status) live
// inside runAgent(). Subject-less run: subjectType/subjectId are null.
import { inngest } from "@/lib/inngest/client";
import { createServiceClient } from "@/lib/supabase/server";
import { buildAgentAuthContext } from "@/lib/ai/agent-auth";
import { runAgent } from "@/lib/ai/agents/runtime";
import "@/lib/ai/agents/packs"; // module-load registration — must run before getAgentDefinition()
import { getAgentDefinition } from "@/lib/ai/agents/registry";
import { logger } from "@/lib/logger";

const DAILY_DIGEST_KEY = "daily-digest";

interface ActiveIdentityRow {
  id: string;
  tenant_id: string;
}

export const agentDailyDigest = inngest.createFunction(
  { id: "agent-daily-digest", triggers: [{ cron: "0 2 * * *" }] },
  async ({ step }) => {
    const identities = await step.run("load-active-identities", async () => {
      const db = await createServiceClient();
      const { data, error } = await db
        .from("agent_identities")
        .select("id, tenant_id")
        .eq("agent_key", DAILY_DIGEST_KEY)
        .eq("status", "active");
      if (error) throw error; // fail-closed → Inngest retries the step
      return (data as ActiveIdentityRow[] | null) ?? [];
    });

    if (identities.length === 0) {
      return { skipped: true, reason: "no active daily-digest identities" };
    }

    const def = getAgentDefinition(DAILY_DIGEST_KEY);
    if (!def) {
      logger.error("daily-digest AgentDefinition missing from registry");
      return { skipped: true, reason: "agent definition not registered" };
    }

    const results: Array<{ tenantId: string; result: unknown }> = [];
    for (const identity of identities) {
      const result = await step.run(`run-agent-${identity.tenant_id}`, async () => {
        const agentAuth = await buildAgentAuthContext(identity.id, identity.tenant_id);
        if (!agentAuth) return { skipped: true, reason: "agent identity vanished" };
        return runAgent(def, agentAuth, {
          event: "cron/daily-digest",
          subjectType: null,
          subjectId: null,
        });
      });
      results.push({ tenantId: identity.tenant_id, result });
    }
    return { ran: results.length, results };
  },
);
