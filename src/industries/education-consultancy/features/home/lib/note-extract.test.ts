import { describe, expect, it } from "vitest";
import { buildFieldPatch, callbackFromNextStep, noteExtractSchema, sanitizeProposals, type NoteExtractRaw } from "./note-extract";

const NOTE = "Planning UK, +2 in 2020, GPA 3.2. IELTS 6.5 booked for Dec. Father pays, budget NPR 25 lakh. Call him wed morning";
const ctx = { note: NOTE, current: {}, nextStageName: null as string | null };
const step = (o: Partial<NoteExtractRaw["nextStep"]>): NoteExtractRaw["nextStep"] => ({ kind: "call_back", day: null, date: null, part: null, time: null, ...o });

describe("noteExtractSchema", () => {
  it("rejects a field that is not on the fixed list: the model cannot invent fields", () => {
    const bad = { fields: [{ field: "passport_number", to: "PA1234567", quote: "x" }], nextStep: step({ kind: "none" }) };
    expect(noteExtractSchema.safeParse(bad).success).toBe(false);
    const ok = { fields: [{ field: "ielts_score", to: "6.5", quote: "IELTS 6.5" }], nextStep: step({ kind: "none" }) };
    expect(noteExtractSchema.safeParse(ok).success).toBe(true);
  });
});

describe("sanitizeProposals", () => {
  it("keeps a value whose quote and numbers are in the note", () => {
    const r = sanitizeProposals([{ field: "ielts_score", to: "6.5", quote: "IELTS 6.5" }, { field: "budget", to: "NPR 25 lakh", quote: "budget NPR 25 lakh" }], ctx);
    expect(r.map((x) => [x.field, x.to, x.from])).toEqual([["ielts_score", "6.5", ""], ["budget", "NPR 25 lakh", ""]]);
  });
  it("a note with no facts returns nothing", () => {
    expect(sanitizeProposals([], { ...ctx, note: "call busy" })).toEqual([]);
  });
  it("drops a quote that is not in the note", () => {
    expect(sanitizeProposals([{ field: "ielts_score", to: "7", quote: "scored seven" }], ctx)).toEqual([]);
  });
  it("drops a value carrying a number the note does not contain", () => {
    expect(sanitizeProposals([{ field: "ielts_score", to: "7.5", quote: "IELTS 6.5" }], ctx)).toEqual([]);
    expect(sanitizeProposals([{ field: "budget", to: "NPR 30 lakh", quote: "budget NPR 25 lakh" }], ctx)).toEqual([]);
  });
  it("shows from → to for a non-empty field, and drops a value that is already on the record", () => {
    const withCurrent = { ...ctx, current: { ielts_score: "6.0" } };
    expect(sanitizeProposals([{ field: "ielts_score", to: "6.5", quote: "IELTS 6.5" }], withCurrent)[0]).toMatchObject({ from: "6.0", to: "6.5" });
    expect(sanitizeProposals([{ field: "ielts_score", to: "6.5", quote: "IELTS 6.5" }], { ...ctx, current: { ielts_score: "6.5" } })).toEqual([]);
  });
  it("a country already on the lead is not proposed again", () => {
    expect(sanitizeProposals([{ field: "destinations", to: "UK", quote: "Planning UK" }], { ...ctx, current: { destinations: "Australia, UK" } })).toEqual([]);
  });
  it("a stage move only when the call log offers a next stage, and it names that stage", () => {
    const raw = [{ field: "stage" as const, to: "next", quote: "Father pays" }];
    expect(sanitizeProposals(raw, ctx)).toEqual([]);
    expect(sanitizeProposals(raw, { ...ctx, nextStageName: "Qualified" })[0]).toMatchObject({ field: "stage", to: "Qualified" });
  });
});

describe("callbackFromNextStep: morning 10:00, afternoon 14:00, evening 17:00 in the TENANT zone", () => {
  // Mon 9 Nov 2026, 08:00 UTC
  const now = new Date("2026-11-09T08:00:00.000Z");
  it("Wed morning in Asia/Kathmandu (UTC+5:45) is Wed 10:00 local = 04:15 UTC", () => {
    expect(callbackFromNextStep(step({ day: "wed", part: "morning" }), now, "Asia/Kathmandu")).toBe("2026-11-11T04:15:00.000Z");
  });
  it("the same words in UTC are 10:00 UTC", () => {
    expect(callbackFromNextStep(step({ day: "wed", part: "morning" }), now, "UTC")).toBe("2026-11-11T10:00:00.000Z");
  });
  it("afternoon 14:00, evening 17:00, an explicit time wins, nothing said is 10:00", () => {
    expect(callbackFromNextStep(step({ day: "tomorrow", part: "afternoon" }), now, "UTC")).toBe("2026-11-10T14:00:00.000Z");
    expect(callbackFromNextStep(step({ day: "tomorrow", part: "evening" }), now, "UTC")).toBe("2026-11-10T17:00:00.000Z");
    expect(callbackFromNextStep(step({ day: "tomorrow", part: "evening", time: "09:30" }), now, "UTC")).toBe("2026-11-10T09:30:00.000Z");
    expect(callbackFromNextStep(step({ day: "tomorrow" }), now, "UTC")).toBe("2026-11-10T10:00:00.000Z");
  });
  it("the tenant's date decides 'tomorrow', not the server's: 20:00 UTC Mon is already Tue in Kathmandu", () => {
    const late = new Date("2026-11-09T20:00:00.000Z");
    expect(callbackFromNextStep(step({ day: "tomorrow", part: "morning" }), late, "Asia/Kathmandu")).toBe("2026-11-11T04:15:00.000Z");
    expect(callbackFromNextStep(step({ day: "tomorrow", part: "morning" }), late, "UTC")).toBe("2026-11-10T10:00:00.000Z");
  });
  it("a weekday named on that weekday means next week", () => {
    expect(callbackFromNextStep(step({ day: "mon", part: "morning" }), now, "UTC")).toBe("2026-11-16T10:00:00.000Z");
  });
  it("a time already past today is not proposed; no day, or not a call-back, gives nothing", () => {
    expect(callbackFromNextStep(step({ day: "today", part: "morning" }), now, "UTC")).toBe("2026-11-09T10:00:00.000Z"); // still ahead: kept
    expect(callbackFromNextStep(step({ day: "today", part: "morning" }), new Date("2026-11-09T11:00:00.000Z"), "UTC")).toBeNull(); // already past
    expect(callbackFromNextStep(step({ day: "today", time: "07:00" }), now, "UTC")).toBeNull();
    expect(callbackFromNextStep(step({}), now, "UTC")).toBeNull();
    expect(callbackFromNextStep(step({ kind: "office_visit", day: "wed" }), now, "UTC")).toBeNull();
  });
});

describe("buildFieldPatch", () => {
  const current = { custom_fields: { stream: "Management", school: "Budhanilkantha" }, destinations: ["Australia"] };
  it("merges budget into custom_fields: the other keys survive", () => {
    const p = buildFieldPatch([{ field: "budget", to: "NPR 25 lakh" }], current);
    expect(p.custom_fields).toEqual({ stream: "Management", school: "Budhanilkantha", budget: "NPR 25 lakh" });
  });
  it("two custom fields in one save both land, with the old keys", () => {
    const p = buildFieldPatch([{ field: "budget", to: "NPR 25 lakh" }, { field: "english_test_plan", to: "IELTS, Dec 2026" }], current);
    expect(p.custom_fields).toEqual({ stream: "Management", school: "Budhanilkantha", budget: "NPR 25 lakh", english_test_plan: "IELTS, Dec 2026" });
  });
  it("writes real columns and ADDS a destination instead of replacing the list", () => {
    const p = buildFieldPatch([{ field: "ielts_score", to: "6.5" }, { field: "sponsor_name", to: "Father" }, { field: "destinations", to: "UK" }], current);
    expect(p).toMatchObject({ ielts_score: "6.5", sponsor_name: "Father", destinations: ["Australia", "UK"] });
    expect(p.custom_fields).toBeUndefined();
  });
  it("the stage is never in the field patch (the call log's own move carries it)", () => {
    expect(buildFieldPatch([{ field: "stage", to: "Qualified" }], current)).toEqual({});
  });
});
