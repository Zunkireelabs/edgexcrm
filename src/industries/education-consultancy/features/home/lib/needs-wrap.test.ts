import { describe, expect, it } from "vitest";
import type { AttentionItem } from "../../pulse/lib/types";
import { attentionRows } from "./needs-you";

// Click-through round 5, M: only the person's activity-drop row with untouched leads may wrap.
const drop = (o: Partial<AttentionItem> = {}): AttentionItem => ({
  id: "s1", category: "needs_action", tone: "bad", icon: "down", subject: "Dikshya Rai", what: "activity down 77% against usual",
  figure: null, suggested: false, action: null, why: null, meta: null, staleHeld: 12, activity: { current: 3, usual: 22, downPct: 86 },
  links: [{ label: "Dikshya's activity", personId: "dikshya" }], drill: {} as AttentionItem["drill"], ...o,
});

describe("wrapWhy", () => {
  it("is set on the activity-drop row with untouched leads, and the line keeps its 'usual' figure", () => {
    const [r] = attentionRows([drop()], new Map(), "me");
    expect(r.wrapWhy).toBe(true);
    expect(r.why).toContain("usual 22");
  });
  it("is absent with no untouched leads", () => {
    expect(attentionRows([drop({ staleHeld: 0 })], new Map(), "me")[0]).not.toHaveProperty("wrapWhy");
  });
  it("is absent once nudged", () => {
    expect(attentionRows([drop()], new Map([["dikshya", { kind: "today" as const }]]), "me")[0]).not.toHaveProperty("wrapWhy");
  });
  it("is absent on a row about no person", () => {
    expect(attentionRows([drop({ icon: "clock", links: [], activity: undefined })], new Map(), "me")[0]).not.toHaveProperty("wrapWhy");
  });
});
