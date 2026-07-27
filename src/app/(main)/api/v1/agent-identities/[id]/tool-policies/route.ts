import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError, apiValidationError } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createAuditLog } from "@/lib/api/audit";
// Module-load registration — must run before getAgentDefinition()/getRegisteredTools()
// below, same reasoning as queries.ts's getAgentDetail (capabilities.ts docstring).
import "@/lib/ai/agents/packs";
import "@/lib/ai/tools/packs";
import { getAgentDefinition } from "@/lib/ai/agents/registry";
import { getRegisteredTools } from "@/lib/ai/tools/registry";
import type { AutomationLevel } from "@/lib/ai/agents/policy";

interface Props {
  params: Promise<{ id: string }>;
}

// doc-04 §2: send_email "ships default human_led and stays there until a
// tenant explicitly opts up". It isn't declared in any AgentDefinition
// today — pinned here anyway so a future agent that DOES declare it can
// never be loosened past human_led through this route on day one. Rejected
// outright (not silently coerced to human_led) — there is no legitimate
// request this route should honor for this tool id yet.
const PINNED_HUMAN_LED_TOOL_IDS = new Set(["send_email"]);

const SETTABLE_LEVELS = new Set<AutomationLevel>(["human_led", "agent_human"]);

interface IdentityAgentKeyRow {
  agent_key: string;
}

interface ExistingPolicyRow {
  automation_level: AutomationLevel;
}

/**
 * PATCH /api/v1/agent-identities/[id]/tool-policies
 * Writes one row of the per-agent x per-tool automation matrix (5.4d Part 5,
 * doc-04 §1). Body: { toolId, automationLevel }. `fully_automated` is
 * rejected here — the UI shows it disabled, this route is the actual gate
 * (doc-04 §2's two unmet prerequisites: no human actor for
 * ai_write_actions.user_id NOT NULL, and prompt-injection containment
 * doesn't exist yet — the executor fails closed on it regardless, but
 * refusing it here is what stops a stored policy from ever claiming
 * otherwise).
 */
export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/agent-identities/${id}/tool-policies` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const toolId = typeof body.toolId === "string" ? body.toolId : null;
  const automationLevel = typeof body.automationLevel === "string" ? (body.automationLevel as AutomationLevel) : null;
  if (!toolId) return apiValidationError({ toolId: ["toolId is required"] });
  if (!automationLevel) return apiValidationError({ automationLevel: ["automationLevel is required"] });

  const db = await scopedClient(auth);

  // 1. Agent must exist in THIS tenant — scopedClient's tenant filter makes
  // a cross-tenant id 404, not a leak of another tenant's agent.
  const { data: identityRaw } = await db.from("agent_identities").select("agent_key").eq("id", id).maybeSingle();
  const identity = identityRaw as unknown as IdentityAgentKeyRow | null;
  if (!identity) return apiNotFound("Agent");

  // 2. toolId must be a registry write-scope tool AND declared in this
  // agent's own AgentDefinition.toolIds — otherwise a caller could store a
  // policy for a tool the agent doesn't have (silent no-op forever) or a
  // typo'd id.
  const def = getAgentDefinition(identity.agent_key);
  const declaresThisTool = (def?.toolIds ?? []).includes(toolId);
  const registryTool = getRegisteredTools().find((t) => t.id === toolId);
  if (!declaresThisTool || registryTool?.scope !== "write") {
    return apiValidationError({ toolId: ["toolId must be a write-scope tool this agent declares"] });
  }

  // 3. fully_automated is refused outright — see docstring above.
  if (automationLevel === "fully_automated") {
    return apiValidationError({
      automationLevel: [
        "Fully automatic is not available yet — it requires agent actor attribution and prompt-injection containment that don't exist yet.",
      ],
    });
  }
  if (!SETTABLE_LEVELS.has(automationLevel)) {
    return apiValidationError({ automationLevel: ["automationLevel must be 'human_led' or 'agent_human'"] });
  }

  // 4. send_email is pinned to human_led — rejected regardless of the
  // requested level, not silently coerced.
  if (PINNED_HUMAN_LED_TOOL_IDS.has(toolId)) {
    return apiValidationError({ toolId: ["send_email stays human_led until a tenant explicitly opts up — not configurable here."] });
  }

  // Read the old value first so the audit log's `changes` reflects a real transition.
  const { data: existingRaw } = await db
    .from("agent_tool_policies")
    .select("automation_level")
    .eq("agent_id", id)
    .eq("tool_id", toolId)
    .maybeSingle();
  const existing = existingRaw as unknown as ExistingPolicyRow | null;
  const oldLevel = existing?.automation_level ?? "human_led"; // DEFAULT_AUTOMATION_LEVEL when no row exists yet

  // 5. Upsert on the mig-181 UNIQUE (tenant_id, agent_id, tool_id).
  const { data, error } = await db
    .from("agent_tool_policies")
    .upsert(
      { agent_id: id, tool_id: toolId, automation_level: automationLevel, updated_by: auth.userId, updated_at: new Date().toISOString() },
      { onConflict: "tenant_id,agent_id,tool_id" },
    )
    .select("id, agent_id, tool_id, automation_level, updated_by, updated_at")
    .single();

  if (error) {
    log.error({ error }, "Failed to upsert agent tool policy");
    return apiError("DB_ERROR", "Failed to update the automation policy", 500);
  }

  // 6. Audited — loosening a write policy is an explicit admin/owner action (doc-04 §1).
  await createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "agent_tool_policy.updated",
    entityType: "agent_identity",
    entityId: id,
    changes: { [toolId]: { old: oldLevel, new: automationLevel } },
    requestId,
  });

  log.info({ agentId: id, toolId, automationLevel }, "Agent tool policy updated");
  return apiSuccess(data);
}
