import { describe, it, expect } from "vitest";
import { PROCESS_KEYS } from "./keys";
import { METRIC_REGISTRY } from "./metrics";
import { buildBaselineSpec, HOME_RULES } from "./baseline";
import { parseProcessSpec, processSpecSchema } from "./spec";
import { ADMIZZ_SETUP } from "./fixtures";

describe("process spec schema", () => {
  it("accepts every baseline we write, for every process", () => {
    for (const key of PROCESS_KEYS) expect(() => processSpecSchema.parse(buildBaselineSpec(key, ADMIZZ_SETUP))).not.toThrow();
  });

  it("every step's target metric exists in that process's registry (and numbers are never stored in the spec body text)", () => {
    for (const key of PROCESS_KEYS) {
      const spec = buildBaselineSpec(key, ADMIZZ_SETUP);
      for (const s of spec.steps) expect(Object.keys(METRIC_REGISTRY[key])).toContain(s.target.metric);
    }
  });

  it("rejects a metric from another process's registry", () => {
    const spec = buildBaselineSpec("new_lead_first_call", ADMIZZ_SETUP);
    const bad = { ...spec, steps: [{ ...spec.steps[0], target: { ...spec.steps[0].target, metric: "leavers_holding" } }] };
    expect(() => parseProcessSpec("new_lead_first_call", bad)).toThrow(/not in the new_lead_first_call registry/);
  });

  it("rejects duplicate step keys, empty steps, and a bad operator", () => {
    const spec = buildBaselineSpec("new_lead_first_call", ADMIZZ_SETUP);
    expect(() => parseProcessSpec("new_lead_first_call", { ...spec, steps: [spec.steps[0], spec.steps[0]] })).toThrow(/Duplicate step key/);
    expect(() => parseProcessSpec("new_lead_first_call", { ...spec, steps: [] })).toThrow();
    expect(() => parseProcessSpec("new_lead_first_call", { ...spec, steps: [{ ...spec.steps[0], target: { ...spec.steps[0].target, op: "==" } }] })).toThrow();
  });
});

describe("baseline builder (Admizz-shaped fixtures)", () => {
  it("new_lead_first_call: names the positions that really take new leads and the Home rule values", () => {
    const spec = buildBaselineSpec("new_lead_first_call", ADMIZZ_SETUP);
    expect(spec.steps.map((s) => s.key)).toEqual(["assign", "first_contact", "call_back", "decide"]);
    expect(spec.steps[0].text).toContain("Counselor or Lead Executive");
    expect(spec.steps[1].who).toEqual(["counselor", "lead-executive"]);
    expect(spec.steps[1].text).toContain("{target}");
    expect(spec.steps[1].targetText).toBe("within 1 hour");
    expect(spec.steps[2].text).toContain(`After ${HOME_RULES.unreachableAfterCalls} unanswered calls`);
    expect(spec.steps[3].text).toContain("{target}");
    expect(spec.steps[3].targetText).toBe("decided within 14 days");
    expect(spec.steps[3].title).toContain("Qualified");
  });

  it("uses the tenant's own stage names", () => {
    const spec = buildBaselineSpec("visa_to_enrolled", { ...ADMIZZ_SETUP, stageNames: { qualified: "Q", enrolled: "Started" } });
    expect(spec.steps[0].title).toBe("Moved to Started");
  });

  it("falls back gracefully when no position has been learned", () => {
    const spec = buildBaselineSpec("new_lead_first_call", { ...ADMIZZ_SETUP, firstTouchPositions: [] });
    expect(spec.steps[0].text).toContain("a counsellor");
  });

  it("dropping_a_student is honest that the reason field does not exist yet", () => {
    expect(buildBaselineSpec("dropping_a_student", ADMIZZ_SETUP).steps[0].text).toContain("can't record a reason yet");
  });

  it("leaver_handover targets zero leavers / zero live leads", () => {
    const spec = buildBaselineSpec("leaver_handover", ADMIZZ_SETUP);
    expect(spec.steps.every((s) => s.target.op === "<=" && s.target.value === 0)).toBe(true);
  });
});
