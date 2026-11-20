import { describe, it, expect } from "vitest";
import "@/lib/ai/tools/packs";
import "@/lib/ai/agents/packs";
import { getAgentDefinition, getAgentDefinitionsForEvent, getAgentDefinitionsForIndustry } from "@/lib/ai/agents/registry";
import { getRegisteredTools } from "@/lib/ai/tools/registry";
import { AGED_EVENT, IMPROVER_EVENT } from "@/industries/education-consultancy/features/processes/server/improver/tools";

describe("the Process Improver (Orca) definition", () => {
  const def = getAgentDefinition("process-improver")!;

  it("is registered for education only, on the two improver events, using the agent model", () => {
    expect(def).toBeTruthy();
    expect(def.industries).toEqual(["education_consultancy"]);
    expect(getAgentDefinitionsForIndustry("education_consultancy").map((d) => d.key)).toContain("process-improver");
    expect(getAgentDefinitionsForIndustry("it_agency").map((d) => d.key)).not.toContain("process-improver");
    expect(getAgentDefinitionsForEvent(IMPROVER_EVENT).map((d) => d.key)).toEqual(["process-improver"]);
    expect(getAgentDefinitionsForEvent(AGED_EVENT).map((d) => d.key)).toEqual(["process-improver"]);
    expect(def.defaultModel).toBe("agent");
  });
  it("has no registry tools, no write tools and no draft-tool ids: its only writes are its own guarded tools", () => {
    expect(def.toolIds).toEqual([]);
    expect(def.outputKinds).toEqual(["process_read"]);
  });
  it("its tools are run-scoped: they never enter the registry the interactive assistant and the MCP door read", () => {
    const ids = getRegisteredTools().map((t) => t.id);
    for (const id of ["process_read", "process_breakdown", "propose_process_draft", "process_compare", "record_process_read"]) expect(ids).not.toContain(id);
  });
  it("the prompt states the rules the guard enforces: tool numbers only, evidence with a link, no re-proposing, on target means no draft, owner approves", () => {
    const p = def.systemPrompt({ tenantId: "t", industryId: "education_consultancy" });
    for (const phrase of ["copied exactly", "evidenceRefs", "linkable", "recentlyRejectedIdeas", "on target", "never edit a live process", "never change a setting"]) expect(p.toLowerCase()).toContain(phrase.toLowerCase());
    expect(p).toContain(IMPROVER_EVENT);
    expect(p).toContain(AGED_EVENT);
  });
});
