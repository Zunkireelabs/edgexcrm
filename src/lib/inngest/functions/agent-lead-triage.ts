// Durable Inngest consumer for the crm/lead.created event (doc 03 §2, §4).
// Runs the Lead Triage agent for every tenant that has hired it (an active
// agent_identities row) — everything else (tenant kill switch, per-tenant
// grant, daily budget) is enforced inside runAgent() itself, so this
// function only needs to find the identity and hand off.
import { inngest } from "@/lib/inngest/client";
import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { buildAgentAuthContext } from "@/lib/ai/agent-auth";
import { runAgent } from "@/lib/ai/agents/runtime";
import "@/lib/ai/agents/packs"; // module-load registration — must run before getAgentDefinition()
import { getAgentDefinition } from "@/lib/ai/agents/registry";
import { logger } from "@/lib/logger";

const LEAD_TRIAGE_KEY = "lead-triage";

interface AgentIdentityIdRow {
  id: string;
}

export const agentLeadTriage = inngest.createFunction(
  {
    id: "agent-lead-triage",
    triggers: [{ event: "crm/lead.created" }],
    concurrency: { limit: 4, key: "event.data.tenantId" },
  },
  async ({ event, step }) => {
    const { tenantId, entityId: leadId } = event.data as { tenantId: string; entityId: string };

    const identityId = await step.run("load-agent-identity", async () => {
      const db = await scopedClientForTenant(tenantId);
      const { data } = await db
        .from("agent_identities")
        .select("id")
        .eq("agent_key", LEAD_TRIAGE_KEY)
        .eq("status", "active")
        .maybeSingle();
      return (data as AgentIdentityIdRow | null)?.id ?? null;
    });

    if (!identityId) {
      return { skipped: true, reason: "no active lead-triage agent identity for this tenant" };
    }

    const result = await step.run("run-agent", async () => {
      const def = getAgentDefinition(LEAD_TRIAGE_KEY);
      if (!def) {
        logger.error({ tenantId }, "lead-triage AgentDefinition missing from registry");
        return { skipped: true, reason: "agent definition not registered" };
      }

      const agentAuth = await buildAgentAuthContext(identityId, tenantId);
      if (!agentAuth) return { skipped: true, reason: "agent identity vanished between load and run" };

      return runAgent(def, agentAuth, {
        event: "crm/lead.created",
        subjectType: "lead",
        subjectId: leadId,
      });
    });

    return result;
  },
);
