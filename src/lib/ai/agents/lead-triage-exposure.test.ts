// Phase 6 slice 6.1 (BRIEF-6-1-LEAD-TRIAGE-WRITE-LOOP.md): Lead Triage now
// proposes its follow-up task via create_task (a real registry scope:"write"
// tool, policy-gated through write-executor.ts) instead of the dead-end
// propose_task draft. Mirrors mcp-client-exposure.test.ts's D9 assertion —
// the same hard rule (every declared write tool must have an approval
// executor) applies to every AgentDefinition, not just mcp-client.
import { describe, it, expect } from "vitest";
import "@/lib/ai/tools/packs"; // module-load registration — must run before getRegisteredTools()
import "./packs"; // module-load registration — must run before getAgentDefinition()
import { getAgentDefinition } from "./registry";
import { getRegisteredTools } from "@/lib/ai/tools/registry";
import { APPROVAL_EXECUTORS } from "./approval-gate";
import { describeCapabilities } from "./capabilities";

describe("lead-triage AgentDefinition — 6.1 write-loop exposure", () => {
  const def = getAgentDefinition("lead-triage");
  if (!def) throw new Error("lead-triage AgentDefinition not registered");

  it("declares create_task, not propose_task", () => {
    expect(def.toolIds).toContain("create_task");
    expect(def.toolIds).not.toContain("propose_task");
  });

  it("declares write_action_proposal, not task_suggestion, among its outputKinds", () => {
    expect(def.outputKinds).toContain("write_action_proposal");
    expect(def.outputKinds).not.toContain("task_suggestion");
  });

  it("create_task is a real registry scope:\"write\" tool with an APPROVAL_EXECUTORS entry", () => {
    const registered = getRegisteredTools();
    const createTask = registered.find((t) => t.id === "create_task");
    expect(createTask?.scope).toBe("write");
    expect(Object.keys(APPROVAL_EXECUTORS)).toContain("create_task");
  });

  it("describeCapabilities no longer returns the draft-only guarantee now that a write tool is declared", () => {
    const summary = describeCapabilities(def);

    expect(summary.writes).toContain("create a task");
    expect(summary.guarantee).not.toMatch(/cannot change your crm directly/i);
    expect(summary.guarantee).toMatch(/approval settings/i);
  });
});

// Phase 6 slice 6.2 (BRIEF-6-2-LEAD-TRIAGE-PROMPT-QUALITY.md): the prompt was
// scoring the model's confidence in its own analysis instead of the lead —
// every duplicate it correctly flagged still scored 100. These are
// regression guards, not proof the model behaves correctly (a unit test
// can't assert model behaviour) — they only catch a future edit silently
// dropping the rubric or the never-assign instruction. See the brief's
// report for the actual live evidence (real agent runs against real leads).
describe("lead-triage AgentDefinition — 6.2 prompt quality regression guards", () => {
  const def = getAgentDefinition("lead-triage");
  if (!def) throw new Error("lead-triage AgentDefinition not registered");
  const prompt = def.systemPrompt({ tenantId: "test-tenant", industryId: null });

  it("scores a confirmed duplicate low, not high", () => {
    expect(prompt).toMatch(/duplicate/i);
    expect(prompt).toMatch(/0-20/);
    expect(prompt).toMatch(/never scores above 20/i);
  });

  it("caps the score when the lead has no contact method", () => {
    expect(prompt).toMatch(/missing both email and phone/i);
  });

  it("tells the model the score must follow the reasoning, not its confidence", () => {
    expect(prompt).toMatch(/not a rating of how confident you are/i);
  });

  it("instructs the agent to never invent an assigneeId", () => {
    expect(prompt).toMatch(/never pass an assigneeId/i);
  });

  // Found via live testing while verifying this slice: search_leads has no
  // self-exclusion, so it can return the lead being triaged as one of its
  // own "duplicate" search results. Without this guard the agent misread
  // that as a confirmed duplicate of itself.
  it("warns that search_leads can return the subject lead itself, not a real duplicate", () => {
    expect(prompt).toMatch(/same id as the one from/i);
  });
});
