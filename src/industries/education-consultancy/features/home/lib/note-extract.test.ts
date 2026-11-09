import { describe, expect, it } from "vitest";
import { buildFieldPatch, buildUndoPatch, callbackFromNextStep, captureUndo, intakeWithYear, matchCatalog, noteExtractSchema, sanitizeProposals, type NoteExtractRaw } from "./note-extract";

const NOTE = "Planning UK, +2 in 2020, GPA 3.2. IELTS 6.5 booked for Dec. Father pays, budget NPR 25 lakh. Call him wed morning";
const NOW = new Date("2026-11-09T08:00:00.000Z"); // Nov 2026
const CATALOGS = { countries: ["UK", "Australia", "USA"], fieldsOfStudy: ["Medical & Pharmacy", "Business & Management", "Engineering & Technology"] };
const ctx = { note: NOTE, current: {} as Record<string, string>, nextStageName: null as string | null, now: NOW, tz: "Asia/Kathmandu", catalogs: CATALOGS };
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
  it("F6: a country is ADDED, shown as 'Australia, UK' with no strike-through, and `to` stays the one new country", () => {
    const [p] = sanitizeProposals([{ field: "destinations", to: "UK", quote: "Planning UK" }], { ...ctx, current: { destinations: "Australia" } });
    expect(p).toMatchObject({ to: "UK", shows: "Australia, UK", additive: true });
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

describe("F3: intake month + year, written in the tenant's words", () => {
  it("'Feb' said in Nov 2026 is February 2027 (the next time that month comes round)", () => {
    expect(intakeWithYear("Feb", "intake Feb", NOW, "Asia/Kathmandu")).toBe("February 2027");
  });
  it("this month, and later months, are this year", () => {
    expect(intakeWithYear("November", "", NOW, "UTC")).toBe("November 2026");
    expect(intakeWithYear("Dec", "", NOW, "UTC")).toBe("December 2026");
  });
  it("'Sept 2027' keeps 2027; a year in the quote is used when `to` has none", () => {
    expect(intakeWithYear("Sept 2027", "", NOW, "UTC")).toBe("September 2027");
    expect(intakeWithYear("September", "September 2028 intake", NOW, "UTC")).toBe("September 2028");
  });
  it("no month, no intake", () => {
    expect(intakeWithYear("next year", "", NOW, "UTC")).toBeNull();
  });
  it("the proposal carries the year, but the number guard still drops a year the NOTE never said", () => {
    const ok = sanitizeProposals([{ field: "intake_term", to: "Dec", quote: "IELTS 6.5 booked for Dec" }], ctx);
    expect(ok[0]).toMatchObject({ field: "intake_term", to: "December 2026" });
    const invented = sanitizeProposals([{ field: "intake_term", to: "Dec 2027", quote: "IELTS 6.5 booked for Dec" }], ctx);
    expect(invented).toEqual([]);
  });
});

describe("F3: countries and fields of study must be on the TENANT's list", () => {
  it("'uk' matches the tenant's 'UK' and is written in THEIR spelling", () => {
    expect(matchCatalog("uk", ["UK", "USA"])).toBe("UK");
    expect(matchCatalog("🇺🇸 usa", ["UK", "USA"])).toBe("USA");
  });
  it("a country not on the list is dropped, not repaired", () => {
    expect(sanitizeProposals([{ field: "destinations", to: "Narnia", quote: "Planning UK" }], ctx)).toEqual([]);
    expect(sanitizeProposals([{ field: "destinations", to: "United Kingdom", quote: "Planning UK" }], ctx)).toEqual([]);
    expect(sanitizeProposals([{ field: "destinations", to: "uk", quote: "Planning UK" }], ctx)[0]).toMatchObject({ to: "UK" });
  });
  it("'Nursing' is not a field of study here: dropped; a catalog value is kept", () => {
    const note = "wants to study nursing, business";
    expect(sanitizeProposals([{ field: "field_of_study", to: "Nursing", quote: "study nursing" }], { ...ctx, note })).toEqual([]);
    const [p] = sanitizeProposals([{ field: "field_of_study", to: "business & management", quote: "business" }], { ...ctx, note });
    expect(p).toMatchObject({ field: "field_of_study", to: "Business & Management", label: "Field of study" });
  });
});

describe("F4: highest qualification %/GPA", () => {
  const note = "Bachelor in 2022, GPA 3.2, also +2 with 78%";
  it("writes the matching <level>_gpa column, and only the HIGHEST level named", () => {
    const r = sanitizeProposals(
      [{ field: "plus_two_gpa", to: "78%", quote: "+2 with 78%" }, { field: "bachelor_gpa", to: "3.2", quote: "GPA 3.2" }],
      { ...ctx, note },
    );
    expect(r.map((x) => x.field)).toEqual(["bachelor_gpa"]);
    expect(buildFieldPatch([{ field: "bachelor_gpa", to: "3.2" }], { custom_fields: null, destinations: null })).toEqual({ bachelor_gpa: "3.2" });
  });
  it("a score the note never said is dropped", () => {
    expect(sanitizeProposals([{ field: "bachelor_gpa", to: "3.9", quote: "GPA 3.2" }], { ...ctx, note })).toEqual([]);
  });
});

describe("F9: Undo restores only the fields Orca wrote", () => {
  const before = { custom_fields: { stream: "Management" } as Record<string, unknown>, destinations: ["Australia"], ielts_score: null, sponsor_name: "Mother" } as Parameters<typeof captureUndo>[1];
  const ticked = [{ field: "budget" as const, to: "NPR 25 lakh" }, { field: "ielts_score" as const, to: "6.5" }, { field: "destinations" as const, to: "UK" }, { field: "sponsor_name" as const, to: "Father" }];
  const patch = buildFieldPatch(ticked, before);
  const items = captureUndo(ticked, before, patch);
  const after = { ...before, custom_fields: patch.custom_fields as Record<string, unknown>, destinations: patch.destinations as string[], ielts_score: "6.5", sponsor_name: "Father" } as Parameters<typeof captureUndo>[1];

  it("puts every ticked field back, and keeps the other custom keys", () => {
    const u = buildUndoPatch(items, after);
    expect(u.restored.sort()).toEqual(["budget", "destinations", "ielts_score", "sponsor_name"]);
    expect(u.patch).toMatchObject({ ielts_score: null, sponsor_name: "Mother", destinations: ["Australia"] });
    expect(u.patch.custom_fields).toEqual({ stream: "Management" }); // budget removed, stream kept
  });
  it("never touches a field the person has changed since", () => {
    const edited = { ...after, sponsor_name: "Uncle", custom_fields: { ...after.custom_fields, budget: "NPR 30 lakh" } } as Parameters<typeof captureUndo>[1];
    const u = buildUndoPatch(items, edited);
    expect(u.skipped.sort()).toEqual(["budget", "sponsor_name"]);
    expect(u.patch.sponsor_name).toBeUndefined();
    expect(u.patch.custom_fields).toBeUndefined();
    expect(u.patch.ielts_score).toBeNull();
  });
  it("only ticked fields are in the snapshot: an unticked one is never restored", () => {
    const partial = captureUndo([{ field: "ielts_score", to: "6.5" }], before, buildFieldPatch([{ field: "ielts_score", to: "6.5" }], before));
    expect(partial.map((i) => i.field)).toEqual(["ielts_score"]);
  });
});
