import { describe, it, expect } from "vitest";
import { autoEnrollPillText, autoEnrollStageNames, autoEnrollTooltip } from "./stage-rule-label";

const t = (name: string, sort: number, is_active = true) => ({ list_id: name, is_active, lead_lists: { name, sort_order: sort } });

describe("auto-enroll pill", () => {
  it("lists only ACTIVE stages, in stage order (not insertion order)", () => {
    expect(autoEnrollStageNames({ sequence_stage_triggers: [t("Prospects", 20), t("Qualified", 10), t("Old", 5, false)] })).toEqual(["Qualified", "Prospects"]);
  });
  it("is empty when auto-enroll is off or the field is missing (older rows)", () => {
    expect(autoEnrollStageNames({})).toEqual([]);
    expect(autoEnrollStageNames({ sequence_stage_triggers: [] })).toEqual([]);
    expect(autoEnrollPillText([])).toBe("");
  });
  it("names up to two stages, then abbreviates", () => {
    expect(autoEnrollPillText(["Qualified"])).toBe("Auto-enroll · Qualified");
    expect(autoEnrollPillText(["Qualified", "Prospects"])).toBe("Auto-enroll · Qualified, Prospects");
    expect(autoEnrollPillText(["Qualified", "Prospects", "Applications"])).toBe("Auto-enroll · Qualified +2");
  });
  it("a deleted stage still renders (never crashes the list)", () => {
    expect(autoEnrollStageNames({ sequence_stage_triggers: [{ list_id: "x", is_active: true, lead_lists: null }] })).toEqual(["Deleted stage"]);
  });
  it("the tooltip spells the rule out", () => {
    expect(autoEnrollTooltip(["Qualified", "Prospects"])).toContain("Qualified or Prospects");
    expect(autoEnrollTooltip(["Qualified", "Prospects", "Applications"])).toContain("Qualified, Prospects, Applications");
  });
});
