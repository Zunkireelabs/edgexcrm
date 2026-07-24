import { generateText, stepCountIs } from "ai";
import { model } from "@/lib/ai/provider";
import { MODELS, ACTIVE_PROVIDER } from "@/lib/ai/models";
import { startTrace } from "@/lib/ai/telemetry";
import { scopedClient } from "@/lib/supabase/scoped";
import { isAgentsEnabledForTenant } from "@/lib/ai/flag";
import { checkAgentDailyBudget } from "@/lib/ai/budget";
import "@/lib/ai/tools/packs"; // module-load registration — must run before getRegisteredTools()
import "@/lib/ai/agents/packs"; // module-load registration — must run before getAgentDefinition(s)
import { getRegisteredTools } from "@/lib/ai/tools/registry";
import { toAiSdkTools } from "@/lib/ai/tools/adapter";
import { logger } from "@/lib/logger";
import type { AgentAuthContext } from "@/lib/ai/agent-auth";
import type { AgentTool } from "@/lib/ai/tools/types";
import type { IndustryId } from "@/industries/_registry";
import { buildDraftTools } from "./draft-tools";
import type { AgentDefinition } from "./types";

const MAX_ERROR_LENGTH = 500;

export interface AgentRunTrigger {
  event: string;
  subjectType: string | null;
  subjectId: string | null;
}

export type RunAgentResult =
  | { status: "skipped"; reason: string }
  | { status: "cancelled"; runId: string; reason: string }
  | { status: "completed"; runId: string }
  | { status: "failed"; runId: string; error: string };

/**
 * Builds this run's toolset: registry read tools declared in `def.toolIds`,
 * filtered by the agent's industry + position permissions exactly like a
 * human's buildToolset(auth) would, EXCEPT no `AI_WRITE_TOOLS_ENABLED` escape
 * hatch — a scope:"write" registry tool must never reach an agent (doc 03
 * §3's "the only writes this phase are the draft tools"). Throwing here
 * (instead of silently filtering) turns a misconfigured AgentDefinition into
 * a loud startup-time failure rather than a silent capability leak.
 */
function buildAgentToolset(def: AgentDefinition, agentAuth: AgentAuthContext): AgentTool[] {
  const candidates = getRegisteredTools().filter((t) => def.toolIds.includes(t.id));

  for (const t of candidates) {
    if (t.scope === "write") {
      throw new Error(
        `Agent definition "${def.key}" declares registry write-scope tool "${t.id}" — write tools may never ` +
          `enter a background agent's toolset (Phase 5 is draft-only).`,
      );
    }
  }

  return candidates.filter((t) => {
    if (t.industries !== undefined) {
      if (agentAuth.industryId === null) return false;
      if (!t.industries.includes(agentAuth.industryId as IndustryId)) return false;
    }
    if (t.requiredPermission !== undefined && agentAuth.permissions[t.requiredPermission] !== true) {
      return false;
    }
    return true;
  });
}

function buildTriggerPrompt(trigger: AgentRunTrigger): string {
  if (trigger.subjectType && trigger.subjectId) {
    return `Triggering event: ${trigger.event}. Subject: ${trigger.subjectType} ${trigger.subjectId}.`;
  }
  return `Triggering event: ${trigger.event}.`;
}

/**
 * Runs one AgentDefinition once, end to end (doc 03 §3): guards (tenant kill
 * switch, agent identity active, daily budget) -> agent_runs row -> a
 * generateText tool loop over this run's toolset (registry read tools + the
 * draft tools) -> persisted outcome. Every "write" the model can make lands
 * only in agent_outputs, via the draft tools — see draft-tools.ts.
 */
export async function runAgent(
  def: AgentDefinition,
  agentAuth: AgentAuthContext,
  trigger: AgentRunTrigger,
): Promise<RunAgentResult> {
  const { tenantId, agentId } = agentAuth;
  const db = await scopedClient(agentAuth);

  // Guards BEFORE any model call or agent_runs row — a paused/disabled agent
  // produces no run at all, not a cancelled one (doc 03 §6 acceptance item).
  if (!(await isAgentsEnabledForTenant(tenantId))) {
    return { status: "skipped", reason: "agents disabled for this tenant" };
  }

  const { data: identityRow } = await db.from("agent_identities").select("status").eq("id", agentId).maybeSingle();
  const identity = identityRow as { status: string } | null;
  if (!identity || identity.status !== "active") {
    return { status: "skipped", reason: "agent identity missing or paused" };
  }

  // Sync and pure — a misconfigured definition (declaring a scope:"write"
  // registry tool) throws HERE, before any agent_runs row exists, rather
  // than after one has already been inserted as "running" with nothing left
  // to ever mark it completed/failed/cancelled.
  const toolset = buildAgentToolset(def, agentAuth);

  const budget = await checkAgentDailyBudget(db, tenantId);

  const { data: runRow, error: runInsertError } = await db
    .from("agent_runs")
    .insert({
      agent_id: agentId,
      trigger_event: trigger.event,
      subject_type: trigger.subjectType,
      subject_id: trigger.subjectId,
      status: budget.overBudget ? "cancelled" : "running",
      ...(budget.overBudget ? { error: "Daily agent output-token budget exhausted", finished_at: new Date().toISOString() } : {}),
    })
    .select("id")
    .single();
  if (runInsertError || !runRow) {
    throw new Error(`Failed to create agent_runs row: ${runInsertError?.message ?? "no row returned"}`);
  }
  const runId = (runRow as { id: string }).id;

  if (budget.overBudget) {
    logger.warn({ tenantId, agentId, runId }, "agent run cancelled — daily agent budget exhausted");
    return { status: "cancelled", runId, reason: "daily agent budget exhausted" };
  }

  const trace = startTrace({ runId, tenantId, industryId: agentAuth.industryId, surface: "background_agent" });
  trace.span(`agent:${def.key}`, { trigger: trigger.event, subjectType: trigger.subjectType, subjectId: trigger.subjectId });

  const modelKind = def.defaultModel ?? "fast";
  const toolCtx = { auth: agentAuth, db, logger, runId };
  const draftTools = buildDraftTools({
    agentId,
    runId,
    db,
    subjectType: trigger.subjectType ?? "unknown",
    subjectId: trigger.subjectId ?? "",
  });
  const tools = {
    ...toAiSdkTools(toolset, toolCtx),
    // Draft tools, like registry read tools, are gated by def.toolIds — an
    // agent only gets the draft tools it declares. (Previously every agent
    // got all draft tools.)
    ...Object.fromEntries(Object.entries(draftTools).filter(([id]) => def.toolIds.includes(id))),
  };

  try {
    const { usage, steps } = await generateText({
      model: model(modelKind),
      system: def.systemPrompt({ tenantId, industryId: agentAuth.industryId }),
      prompt: buildTriggerPrompt(trigger),
      tools,
      stopWhen: stepCountIs(def.maxSteps ?? 8),
      maxRetries: 1,
    });

    await db
      .from("agent_runs")
      .update({
        status: "completed",
        usage: {
          inputTokens: usage.inputTokens ?? null,
          outputTokens: usage.outputTokens ?? null,
          toolCalls: steps.length,
        },
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);

    await db.from("ai_usage_events").insert({
      agent_id: agentId,
      run_id: runId,
      model: MODELS[ACTIVE_PROVIDER][modelKind],
      input_tokens: usage.inputTokens ?? null,
      output_tokens: usage.outputTokens ?? null,
      tool_calls: steps.length,
      surface: "background_agent",
    });

    trace.end({ ok: true, model: MODELS[ACTIVE_PROVIDER][modelKind], inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
    return { status: "completed", runId };
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, MAX_ERROR_LENGTH) : "Agent run failed";
    await db
      .from("agent_runs")
      .update({ status: "failed", error: message, finished_at: new Date().toISOString() })
      .eq("id", runId);
    trace.end({ ok: false });
    logger.error({ err, tenantId, agentId, runId }, "agent run failed");
    return { status: "failed", runId, error: message };
  }
}
