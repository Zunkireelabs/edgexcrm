import { describe, it, expect } from "vitest";
import { buildBaselineSpec, HOME_RULES } from "./baseline";
import { ADMIZZ_SETUP } from "./fixtures";
import { defaultPolicy, derivePolicy } from "./policy";
import { processSpecSchema, type ProcessSpec } from "./spec";
import { DEFAULT_OFFICE_HOURS, type OfficeHours } from "./working-hours";

const OH: OfficeHours = { days: [0, 1, 2, 3, 4, 5], startMin: 540, endMin: 1080, source: "saved" };
const live = (spec: ProcessSpec) => ({ version: 2, approvedAt: "2026-11-08T05:00:00Z", ownerName: "Manish", spec });
const v1 = () => buildBaselineSpec("new_lead_first_call", ADMIZZ_SETUP);
const v2 = (): ProcessSpec => {
  const s = structuredClone(v1());
  const fc = s.steps.find((x) => x.key === "first_contact")!;
  fc.target = { metric: "first_contact_1wh_pct", op: ">=", value: 75, unit: "percent" };
  return s;
};

describe("derivePolicy", () => {
  it("v1 spec -> 60 minutes on the plain clock, today's other numbers", () => {
    const p = derivePolicy(live(v1()), OH);
    expect(p.firstContact).toEqual({ minutes: 60, clock: "clock" });
    expect(p.assignWithinMin).toBe(5);
    expect(p.unreachableAfterCalls).toBe(HOME_RULES.unreachableAfterCalls);
    expect(p.decideWithinDays).toBe(HOME_RULES.decideWithinDays);
    expect(p.officeHours).toBe(OH);
    expect(p.source).toEqual({ processKey: "new_lead_first_call", version: 2, approvedAt: "2026-11-08T05:00:00Z", ownerName: "Manish", approvedByName: null });
  });
  it("v2 spec (first_contact_1wh_pct) -> 60 working minutes", () => {
    expect(derivePolicy(live(v2()), OH).firstContact).toEqual({ minutes: 60, clock: "working" });
  });
  it("positions come from the First contact step's `who`; an empty list reads as no positions", () => {
    expect(derivePolicy(live(v1()), OH).firstTouchPositions).toEqual(v1().steps.find((s) => s.key === "first_contact")!.who);
    const s = v1();
    s.steps.find((x) => x.key === "first_contact")!.who = [];
    expect(derivePolicy(live(s), OH).firstTouchPositions).toBeNull();
  });
  it("the optional `rules` block overrides unreachable / decide-within; one field alone leaves the other at today's value", () => {
    const s = { ...v1(), rules: { unreachableAfterCalls: 5, decideWithinDays: 21 } };
    const p = derivePolicy(live(s), OH);
    expect([p.unreachableAfterCalls, p.decideWithinDays]).toEqual([5, 21]);
    const half = derivePolicy(live({ ...v1(), rules: { decideWithinDays: 30 } }), OH);
    expect([half.unreachableAfterCalls, half.decideWithinDays]).toEqual([HOME_RULES.unreachableAfterCalls, 30]);
  });
  it("a missing Assign or First contact step keeps today's value for just that field", () => {
    const s = v1();
    s.steps = s.steps.filter((x) => x.key !== "assign" && x.key !== "first_contact");
    const p = derivePolicy(live(s), OH);
    expect(p.assignWithinMin).toBe(5);
    expect(p.firstContact).toEqual({ minutes: 60, clock: "clock" });
    expect(p.firstTouchPositions).toBeNull();
  });
});

describe("defaultPolicy (the emergency path)", () => {
  it("is today's values with source null", () => {
    const p = defaultPolicy();
    expect(p).toEqual({
      firstContact: { minutes: 60, clock: "clock" },
      assignWithinMin: 5,
      unreachableAfterCalls: HOME_RULES.unreachableAfterCalls,
      decideWithinDays: HOME_RULES.decideWithinDays,
      firstTouchPositions: null,
      officeHours: DEFAULT_OFFICE_HOURS,
      source: null,
    });
  });
});

describe("the spec `rules` block", () => {
  const base = () => structuredClone(v1());
  it("is optional: a v1/v2 without it still parses", () => {
    expect(processSpecSchema.safeParse(base()).success).toBe(true);
  });
  it("accepts 2–10 unreachable calls and 3–60 decide days, nothing outside", () => {
    const ok = (rules: unknown) => processSpecSchema.safeParse({ ...base(), rules }).success;
    expect(ok({ unreachableAfterCalls: 2, decideWithinDays: 3 })).toBe(true);
    expect(ok({ unreachableAfterCalls: 10, decideWithinDays: 60 })).toBe(true);
    expect(ok({ unreachableAfterCalls: 1 })).toBe(false);
    expect(ok({ unreachableAfterCalls: 11 })).toBe(false);
    expect(ok({ decideWithinDays: 2 })).toBe(false);
    expect(ok({ decideWithinDays: 61 })).toBe(false);
    expect(ok({ decideWithinDays: 14.5 })).toBe(false);
  });
});
