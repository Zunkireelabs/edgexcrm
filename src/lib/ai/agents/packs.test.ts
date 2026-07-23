import { describe, it, expect } from "vitest";
import "./packs"; // module-load registration — universal + every industry agent pack
import { getAgentDefinition, getAgentDefinitionsForIndustry } from "./registry";
import { describeCapabilities } from "./capabilities";

describe("agents/packs.ts registration", () => {
  it("registers follow-up-drafter for education_consultancy but not for other industries", () => {
    const eduKeys = getAgentDefinitionsForIndustry("education_consultancy").map((d) => d.key);
    const itAgencyKeys = getAgentDefinitionsForIndustry("it_agency").map((d) => d.key);

    expect(eduKeys).toContain("follow-up-drafter");
    expect(itAgencyKeys).not.toContain("follow-up-drafter");
  });

  it("getAgentDefinition resolves follow-up-drafter", () => {
    expect(getAgentDefinition("follow-up-drafter")).toBeDefined();
  });

  it("describeCapabilities on follow-up-drafter surfaces the lead.assigned trigger, the email draft tool, and its output kind", () => {
    const def = getAgentDefinition("follow-up-drafter")!;
    const summary = describeCapabilities(def);

    expect(summary.trigger).toMatch(/lead.*assigned/i);
    expect(summary.drafts).toContain("draft a follow-up email");
    expect(summary.produces).toEqual(["Draft email"]);
  });

  it("still registers the universal lead-triage agent (packs refactor doesn't drop universal defs)", () => {
    expect(getAgentDefinition("lead-triage")).toBeDefined();
    expect(getAgentDefinitionsForIndustry("it_agency").map((d) => d.key)).toContain("lead-triage");
  });
});
