import type { IndustryId } from "@/industries/_registry";
import type { AgentDefinition } from "./types";

const definitions: AgentDefinition[] = [];

export function registerAgentDefinition(def: AgentDefinition): void {
  definitions.push(def);
}

export function getAgentDefinition(key: string): AgentDefinition | undefined {
  return definitions.find((d) => d.key === key);
}

export function getAgentDefinitionsForEvent(event: string): AgentDefinition[] {
  return definitions.filter((d) => d.triggers.some((t) => "event" in t && t.event === event));
}

// Universal defs (industries === undefined) plus any whose `industries` list
// includes this tenant's industry — the same "universal + industry-matched"
// rule buildToolset(auth) applies to registry tools (tools/registry.ts).
export function getAgentDefinitionsForIndustry(industryId: string | null): AgentDefinition[] {
  return definitions.filter(
    (d) => d.industries === undefined || (industryId !== null && d.industries.includes(industryId as IndustryId)),
  );
}

// Test-only: mirrors registry.ts's __clearRegistryForTests.
export function __clearAgentRegistryForTests(): void {
  definitions.length = 0;
}

/**
 * Lead Triage (universal, doc 03 §4) — the first launch agent. Runs on every
 * new lead: checks for likely duplicates, proposes a fit score, and proposes
 * a first follow-up task via create_task (Phase 6 slice 6.1 — previously
 * propose_task, a dead-end draft nothing ever turned into a real task).
 * create_task is a registry scope:"write" tool, so it flows through the same
 * policy-enforced write spine every other declared write tool does
 * (write-executor.ts) — no new execution path for this agent.
 *
 * Once an industry pack exists (`src/industries/<id>/ai/agents/*.ts`), this
 * file's registry should collect those too, the same way tools/packs.ts
 * aggregates industry tool packs. Not built yet — only this one universal
 * agent exists in 5.1b.
 */
export const leadTriageAgent: AgentDefinition = {
  key: "lead-triage",
  name: "Lead Triage",
  description: "Scores new leads for fit, flags likely duplicates, and suggests a first follow-up task.",
  triggers: [{ event: "crm/lead.created" }],
  toolIds: ["get_lead", "search_leads", "propose_score", "create_task"],
  outputKinds: ["score_suggestion", "write_action_proposal"],
  maxSteps: 8,
  systemPrompt: () =>
    "You are the Lead Triage agent for this CRM tenant. A new lead was just created. Use get_lead to read " +
    "its details, then search_leads to check whether it looks like a duplicate of an existing lead (similar " +
    "name/email/phone). search_leads can return the lead you're triaging itself (same id as the one from " +
    "get_lead) — that is not a duplicate, it's just this lead; only a DIFFERENT lead id with matching details " +
    "counts as a duplicate.\n\n" +
    "Then call propose_score with a 0-100 fit/quality score and your reasoning (mention any likely duplicate " +
    "you found). The score must follow from your reasoning — it is a rating of the LEAD, not a rating of how " +
    "confident you are in your own analysis. Use this rubric:\n" +
    "- 0-20: a confirmed or likely duplicate of an existing lead. This overrides every other consideration — " +
    "a duplicate never scores above 20, no matter how complete or promising it otherwise looks.\n" +
    "- 21-50: not a duplicate, but missing both email and phone (no way to contact them). Capped here even " +
    "if everything else about the lead looks strong.\n" +
    "- 51-80: not a duplicate, has at least one contact method (email or phone) but not both, or is only a " +
    "partial fit.\n" +
    "- 81-100: not a duplicate, has both email and phone, and is a clear fit.\n\n" +
    "Finally call create_task with a sensible first follow-up task. Never pass an assigneeId — omit it every " +
    "time. The task is queued for human review and belongs to whoever approves it; you have no basis for " +
    "picking a specific person, so guessing one is always wrong. Your create_task call is queued for human " +
    "review and only ever runs once a human approves it — you cannot change this or any lead's data yourself, " +
    "assign anyone, or send anything.",
};

registerAgentDefinition(leadTriageAgent);

/**
 * Daily Digest (universal, doc 03 §4) — the spine's first CRON-triggered, subject-less agent.
 * Once a day it reads the tenant's pipeline and records a short digest for the team to read.
 * Draft-only — propose_digest is the only "write", landing one informational row in
 * agent_outputs (subject NULL). It cannot change any lead or send anything.
 */
export const dailyDigestAgent: AgentDefinition = {
  key: "daily-digest",
  name: "Daily Digest",
  description: "Summarizes each day's pipeline activity into a short digest for the team to read.",
  triggers: [{ cron: "0 2 * * *" }], // 02:00 UTC ≈ 07:45 Asia/Kathmandu; per-tenant TZ deferred
  toolIds: ["pipeline_summary", "search_leads", "propose_digest"],
  outputKinds: ["daily_digest"],
  maxSteps: 6,
  systemPrompt: () =>
    "You are the Daily Digest agent for this CRM tenant. Once a day, summarize the current state " +
    "of the sales pipeline for the team. Use pipeline_summary to get lead counts per stage, and " +
    "optionally search_leads to surface a few notable recent or unassigned leads. Then call " +
    "propose_digest exactly once with a concise, plain-language summary (a few sentences) plus " +
    "optional short highlight bullet points. You only record a summary for humans to read — you " +
    "cannot change any lead, assign anyone, or send anything.",
};

registerAgentDefinition(dailyDigestAgent);

/**
 * External MCP Client (Phase 5 slice 5.5, doc 03/04 + BRIEF-PHASE-5-5-MCP-SERVER.md
 * D1) — the universal actor identity an external MCP client (Claude, another
 * agent host) acts as once a tenant admin hires it via the normal Fleet path
 * (POST /api/v1/agent-identities, agentKey:"mcp-client") and mints an
 * integration-category API key. This is NOT a model-driven agent: `triggers`
 * is deliberately empty (never auto-triggered by an event/cron — driven only
 * by an inbound /api/mcp request) and `systemPrompt` is NEVER sent to any
 * model — the caller's own model is the "brain"; this definition exists only
 * to give that external caller a real per-tenant opt-in, a position-derived
 * permission profile, and a row in the 5.4d Configure automation matrix, by
 * reusing the exact same agent-identity/policy/approval machinery every other
 * agent goes through (D1's "no new actor type" decision).
 *
 * toolIds per D9 (verified, not assumed — see the 5.5 brief §2 D9 and the
 * slice's report): reads are get_lead/search_leads/team_lookup/pipeline_summary,
 * each proven to run cleanly under an AgentAuthContext (no assertUserAuth, no
 * auth.userId read). pipeline_summary was previously excluded because it still
 * called assertUserAuth(auth) and threw for any AgentAuthContext caller; Phase 7
 * (7.3) made it agent-safe — it now scopes purely via auth.permissions +
 * resolveLeadVisibilityPlan, the same path get_lead/search_leads use — so it is
 * back in the read set the 5.5 brief's D9 originally assumed it would be in.
 * Writes are create_task/update_lead_stage/assign_lead — every one has an
 * APPROVAL_EXECUTORS entry (approval-gate.ts), the hard rule this registry
 * entry must satisfy so an agent_human approval can never resolve to "no
 * approval executor registered". assign_lead is only viable because
 * team_lookup (its assignee-id resolution path) passes the AgentAuthContext
 * check; had team_lookup failed, assign_lead would have been dropped too.
 */
export const mcpClientAgent: AgentDefinition = {
  key: "mcp-client",
  name: "External MCP Client",
  description:
    "An external agent host (Claude, another MCP client) connected over the Model Context Protocol with an " +
    "integration API key. Every write it proposes is queued for human review or approval exactly like any " +
    "other agent's — it never executes a write inline.",
  triggers: [],
  toolIds: ["get_lead", "search_leads", "team_lookup", "pipeline_summary", "create_task", "update_lead_stage", "assign_lead"],
  outputKinds: ["write_action_proposal"],
  // Never sent to any model — an MCP client's model is external and never
  // calls into runAgent()/generateText(). Kept only so AgentDefinition's
  // required shape is satisfied and so describeCapabilities() has a
  // consistent def to summarize for the Fleet/Configure UI.
  systemPrompt: () =>
    "Not used — this definition is driven only by inbound MCP tool calls from an external caller, never by runAgent().",
};

registerAgentDefinition(mcpClientAgent);
