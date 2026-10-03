import { describe, it, expect } from "vitest";
import { checkStepEdit, lockedUpToStep, type ExistingStep } from "./step-edit-rules";
import type { SequenceStepInput } from "./validate-steps";

// Editing the structure of a sequence that leads are running: steps they have reached are locked (order, wait, kind),
// everything after them is free, wording is always free.

const existing: ExistingStep[] = [
  { step_order: 1, delay_days: 0, draft_source: "template" },
  { step_order: 2, delay_days: 3, draft_source: "template" },
  { step_order: 3, delay_days: 4, draft_source: "ai" },
  { step_order: 4, delay_days: 7, draft_source: "template" },
];
const same = (): SequenceStepInput[] => existing.map((e) => ({ step_order: e.step_order, delay_days: e.delay_days, draft_source: e.draft_source as "template" | "ai", subject_template: "s", body_template: "b" }));

describe("lockedUpToStep", () => {
  it("nothing is locked when no lead is running", () => {
    expect(lockedUpToStep(null, 4)).toBe(0);
  });
  it("a lead that handled N steps has a draft for N+1, so 1..N+1 are in use", () => {
    expect(lockedUpToStep(0, 4)).toBe(1); // just enrolled: the step-1 draft exists
    expect(lockedUpToStep(2, 4)).toBe(3);
  });
  it("never beyond the last step that exists", () => {
    expect(lockedUpToStep(4, 4)).toBe(4);
    expect(lockedUpToStep(9, 4)).toBe(4);
  });
});

describe("checkStepEdit", () => {
  it("anything goes when nothing is locked", () => {
    const radical = [{ step_order: 1, delay_days: 9, draft_source: "ai", ai_instructions: "x" }] as SequenceStepInput[];
    expect(checkStepEdit(existing, radical, 0)).toEqual({ ok: true });
  });

  it("unchanged structure passes at any lock level (text edits are always allowed)", () => {
    expect(checkStepEdit(existing, same(), 4)).toEqual({ ok: true });
    expect(checkStepEdit(existing, same().map((s) => ({ ...s, subject_template: "new wording" })), 4)).toEqual({ ok: true });
  });

  it("steps AFTER the lock can be added, removed, retimed and reordered freely", () => {
    // leads are on step 2 (locked 1..2): change step 3's wait/kind, drop step 4, add step 5
    const edited = same().slice(0, 3).map((s) => (s.step_order === 3 ? { ...s, delay_days: 1, draft_source: "template" as const } : s));
    edited.push({ step_order: 4, delay_days: 2, draft_source: "template", subject_template: "n", body_template: "n" });
    edited.push({ step_order: 5, delay_days: 2, draft_source: "template", subject_template: "n", body_template: "n" });
    expect(checkStepEdit(existing, edited, 2)).toEqual({ ok: true });
  });

  it("appending a follow-up at the end is allowed even when leads are on the last step", () => {
    const appended = [...same(), { step_order: 5, delay_days: 3, draft_source: "template" as const, subject_template: "n", body_template: "n" }];
    expect(checkStepEdit(existing, appended, 4)).toEqual({ ok: true });
  });

  it("changing the wait of a step leads have reached is refused, with a plain message", () => {
    const edited = same().map((s) => (s.step_order === 2 ? { ...s, delay_days: 10 } : s));
    const result = checkStepEdit(existing, edited, 3);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/Steps 1–3 are already in use/);
    expect(!result.ok && result.message).toMatch(/from step 4 on/);
  });

  it("changing the drafting kind of a locked step is refused", () => {
    const edited = same().map((s) => (s.step_order === 3 ? { ...s, draft_source: "template" as const } : s));
    expect(checkStepEdit(existing, edited, 3).ok).toBe(false);
  });

  it("removing or reordering a locked step is refused", () => {
    expect(checkStepEdit(existing, same().filter((s) => s.step_order !== 2), 3).ok).toBe(false);
    // swap steps 1 and 2 (their orders now carry the other step's wait)
    const swapped = same().map((s) => (s.step_order === 1 ? { ...s, delay_days: 3 } : s.step_order === 2 ? { ...s, delay_days: 0 } : s));
    expect(checkStepEdit(existing, swapped, 3).ok).toBe(false);
  });

  it("a missing delay_days / draft_source on the incoming step means the defaults (0 / template)", () => {
    const incoming = [
      { step_order: 1, subject_template: "s", body_template: "b" },
      { step_order: 2, delay_days: 3, subject_template: "s", body_template: "b" },
    ] as SequenceStepInput[];
    expect(checkStepEdit(existing.slice(0, 2), incoming, 2)).toEqual({ ok: true });
  });
});

describe("checkStepEdit — send time", () => {
  it("changing the send time of a locked step is refused", () => {
    const next = same();
    next[1].send_time = "15:00"; // step 2 is locked (lockedUpTo 3)
    expect(checkStepEdit(existing, next, 3).ok).toBe(false);
  });
  it("changing the send time of a step after the lock is allowed", () => {
    const next = same();
    next[3].send_time = "15:00"; // step 4 is free
    expect(checkStepEdit(existing, next, 3).ok).toBe(true);
  });
  it("empty and missing send time count as the same", () => {
    const next = same();
    next[1].send_time = "";
    expect(checkStepEdit(existing, next, 3).ok).toBe(true);
  });
});
