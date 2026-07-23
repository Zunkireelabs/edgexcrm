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
 * new lead: checks for likely duplicates and proposes a fit score + a first
 * follow-up task. Draft-only — propose_score/propose_task are the only
 * "writes" it can make, and both land in agent_outputs for human review.
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
  toolIds: ["get_lead", "search_leads", "propose_score", "propose_task"],
  outputKinds: ["score_suggestion", "task_suggestion"],
  maxSteps: 8,
  systemPrompt: () =>
    "You are the Lead Triage agent for this CRM tenant. A new lead was just created. Use get_lead to read " +
    "its details, then search_leads to check whether it looks like a duplicate of an existing lead (similar " +
    "name/email/phone). Then call propose_score with a 0-100 fit/quality score and your reasoning (mention " +
    "any likely duplicate you found), and propose_task with a sensible first follow-up task. You may only " +
    "propose suggestions for a human to review — you cannot change this or any lead's data, assign anyone, " +
    "or send anything.",
};

registerAgentDefinition(leadTriageAgent);
