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
