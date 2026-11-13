import { describe, expect, it } from "vitest";
import { normalizeDigits, numbersIn } from "./numbers";
import { validatePoints } from "./orca-read";
import { sanitizeProposals } from "./note-extract";
import { draftNumbersOk } from "../ai/draft";
import { openingOk, kbRestatementOk } from "../ai/call-prep";

describe("C2: Devanagari digits count as their Latin twins", () => {
  it("normalizeDigits / numbersIn", () => {
    expect(normalizeDigits("५ दिन")).toBe("5 दिन");
    expect(numbersIn("३.५ र १२")).toEqual(["3.5", "12"]);
    expect(numbersIn("IELTS 6.5")).toEqual(["6.5"]);
  });
  it("drafts: an invented '५ दिन' is refused; the real '5 days' (fact) allows ५", () => {
    expect(draftNumbersOk({ text: "तपाईंको ५ दिन", subject: null, why: "x" }, ["Deadline in 6 days"])).toBe(false);
    expect(draftNumbersOk({ text: "तपाईंको ५ दिन", subject: null, why: "x" }, ["Last call: 5 days ago"])).toBe(true);
  });
  it("the read: an invented ५ is dropped", () => {
    const facts = [{ id: "f", text: "calls: 46", href: "/home#week", linkLabel: "See why →" }];
    expect(validatePoints([{ claim: "५ missed", reason: "r", factIds: ["f"] }], facts)).toEqual([]);
    expect(validatePoints([{ claim: "४६ calls", reason: "r", factIds: ["f"] }], facts)).toHaveLength(1);
  });
  it("notes: a value with an invented ७ is dropped", () => {
    const ctx = { note: "IELTS 6.5 booked", current: {}, nextStageName: null, now: new Date("2026-11-09T08:00:00Z"), tz: "UTC", catalogs: { countries: [], fieldsOfStudy: [] } };
    expect(sanitizeProposals([{ field: "ielts_score", to: "७", quote: "IELTS 6.5" }], ctx)).toEqual([]);
  });
  it("call prep: opening line and KB restatement", () => {
    expect(openingOk("तपाईंले ५ मिनेट?", ["Intake: February 2027"])).toBe(false);
    expect(kbRestatementOk("७ विश्वविद्यालय", "4 partner universities")).toBe(false);
    expect(kbRestatementOk("४ partner universities", "4 partner universities")).toBe(true);
  });
});
