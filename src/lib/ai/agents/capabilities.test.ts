import { describe, it, expect } from "vitest";
import { describeCapabilities } from "./capabilities";
import type { AgentDefinition } from "./types";

const LEAD_TRIAGE_DEF: AgentDefinition = {
  key: "lead-triage",
  name: "Lead Triage",
  description: "Scores new leads for fit, flags likely duplicates, and suggests a first follow-up task.",
  triggers: [{ event: "crm/lead.created" }],
  toolIds: ["get_lead", "search_leads", "propose_score", "propose_task"],
  outputKinds: ["score_suggestion", "task_suggestion"],
  systemPrompt: () => "",
};

describe("describeCapabilities", () => {
  it("derives trigger/reads/drafts/produces for the Lead Triage def", () => {
    const summary = describeCapabilities(LEAD_TRIAGE_DEF);

    expect(summary.trigger).toBe("When a new lead is created");
    expect(summary.reads).toEqual(["read a lead's full profile", "search across leads"]);
    expect(summary.drafts).toEqual(["draft a fit/quality score", "draft a follow-up task"]);
    expect(summary.produces).toEqual(["Score suggestion", "Task suggestion"]);
    expect(summary.guarantee).toMatch(/cannot change your crm directly/i);
  });

  it("humanizes an unknown tool id instead of throwing", () => {
    const def: AgentDefinition = {
      ...LEAD_TRIAGE_DEF,
      toolIds: ["get_lead", "some_new_read_tool", "propose_followup_call"],
    };

    const summary = describeCapabilities(def);

    expect(summary.reads).toContain("some new read tool");
    expect(summary.drafts).toContain("draft a followup call");
  });

  it("humanizes an unknown output kind instead of throwing", () => {
    const def: AgentDefinition = {
      ...LEAD_TRIAGE_DEF,
      outputKinds: ["score_suggestion", "some_future_kind" as never],
    };

    const summary = describeCapabilities(def);

    expect(summary.produces).toEqual(["Score suggestion", "some future kind"]);
  });

  it("phrases a cron trigger as a schedule", () => {
    const def: AgentDefinition = {
      ...LEAD_TRIAGE_DEF,
      triggers: [{ cron: "0 6 * * *" }],
    };

    const summary = describeCapabilities(def);

    expect(summary.trigger).toBe("On a schedule (0 6 * * *)");
  });

  it("phrases a manual trigger", () => {
    const def: AgentDefinition = {
      ...LEAD_TRIAGE_DEF,
      triggers: [{ event: "manual" }],
    };

    const summary = describeCapabilities(def);

    expect(summary.trigger).toBe("When run manually");
  });

  it("joins multiple triggers", () => {
    const def: AgentDefinition = {
      ...LEAD_TRIAGE_DEF,
      triggers: [{ event: "crm/lead.created" }, { cron: "0 6 * * *" }],
    };

    const summary = describeCapabilities(def);

    expect(summary.trigger).toBe("When a new lead is created or On a schedule (0 6 * * *)");
  });
});
