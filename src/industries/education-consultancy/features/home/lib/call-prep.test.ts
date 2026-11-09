import { describe, expect, it } from "vitest";
import { askAbout, callPrepEligible, KB_MIN_SCORE, kbQuery, knownRows, maskPhone, pickKbChunk } from "./call-prep";

describe("eligibility", () => {
  it("only new-lead call rows", () => {
    const call = { type: "call", leadId: "l", phone: null, leadName: "S" } as const;
    expect(callPrepEligible({ kind: "new_uncalled", leadId: "l", primaryAction: call })).toBe(true);
    expect(callPrepEligible({ kind: "callback_overdue", leadId: "l", primaryAction: call })).toBe(false);
    expect(callPrepEligible({ kind: "new_uncalled", primaryAction: call })).toBe(false);
    expect(callPrepEligible({ kind: "new_uncalled", leadId: "l", primaryAction: { type: "open", href: "/x", label: "Open" } })).toBe(false);
  });
});

describe("maskPhone: as H3c shows it", () => {
  it("'+977 98•• ••• 412' style; the full number is never in the output", () => {
    expect(maskPhone("+977 9841234412")).toBe("+977 98•• ••• 412");
    expect(maskPhone("9841234412")).toBe("98•• ••• 412");
    expect(maskPhone("00977-984-123-4412")).toBe("+977 98•• ••• 412");
    expect(maskPhone("+977 9841234412")).not.toContain("1234");
  });
  it("short or missing numbers", () => {
    expect(maskPhone("123")).toBe("•••");
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone("")).toBeNull();
  });
});

describe("askAbout: only the B1 list, only what is empty", () => {
  const empty = {};
  it("an empty record asks about every fixed field", () => {
    expect(askAbout(empty).map((a) => a.key)).toEqual(["english_test", "decision_maker", "budget", "country", "intake", "course", "qualification"]);
  });
  it("lists only what is empty on this lead", () => {
    const r = { ielts_score: "6.5", sponsor_name: "Ram Thapa", destinations: "UK", field_of_study: "Business & Management", bachelor_gpa: "3.2" };
    expect(askAbout(r).map((a) => a.key)).toEqual(["budget", "intake"]);
  });
  it("a test plan counts as an English test; a role alone counts as who decides; any one GPA counts as a qualification", () => {
    const r = { english_test_plan: "IELTS Dec 2026", sponsor_relationship: "Father", plus_two_gpa: "78%", budget: "NPR 25 lakh", destinations: "UK", intake_term: "February 2027", field_of_study: "Nursing" };
    expect(askAbout(r)).toEqual([]);
  });
  it("never asks about passport or anything outside the B1 list", () => {
    expect(askAbout(empty).map((a) => a.label).join(" ")).not.toMatch(/passport/i);
  });
});

describe("knownRows: the record as it is", () => {
  const base = { destinations: ["Australia"], intakeTerm: "Feb 2027", fieldOfStudy: "Bachelor of Nursing", plusTwoStream: "Science", plusTwoGpa: "3.2", bachelorGpa: null, mastersGpa: null, ieltsScore: null, customFields: null };
  it("Wants / Studied / English test, with 'none on record' as in H3c", () => {
    expect(knownRows(base)).toEqual([
      { k: "Wants", v: "Bachelor of Nursing · Australia · Feb 2027" },
      { k: "Studied", v: "+2 Science · GPA 3.2" },
      { k: "English test", v: "none on record" },
    ]);
  });
  it("form answers (custom fields) follow, short text only, never contact details or documents", () => {
    const rows = knownRows({ ...base, customFields: { school: "Budhanilkantha", phone_number: "9841234567", passport_no: "PA1", document_url: "https://x", essay: "x".repeat(200), stream: "Science", hear_about: "Facebook" } });
    expect(rows.map((r) => r.k)).toEqual(["Wants", "Studied", "English test", "School", "Hear about"]);
    expect(JSON.stringify(rows)).not.toMatch(/9841234567|PA1|https/);
  });
  it("at most 6 form answers", () => {
    const cf = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`q${i}`, `a${i}`]));
    expect(knownRows({ ...base, customFields: cf }).filter((r) => /^Q\d$/.test(r.k))).toHaveLength(6);
  });
  it("nothing on the record: just the English test line", () => {
    expect(knownRows({ destinations: [], intakeTerm: null, fieldOfStudy: null, plusTwoStream: null, plusTwoGpa: null, bachelorGpa: null, mastersGpa: null, ieltsScore: null, customFields: null })).toEqual([{ k: "English test", v: "none on record" }]);
  });
});

describe("knowledge base: only a real match", () => {
  const chunk = (score: number, o = {}) => ({ content: "Partner universities take nursing students.", score, title: "Australia partners 2027.pdf", page: 3, ...o });
  it("no hit shows no box", () => {
    expect(pickKbChunk([], false)).toBeNull();
  });
  it("a chunk found by one search arm alone (max 1/61) is not a match; both arms (min 2/84) is", () => {
    expect(KB_MIN_SCORE).toBeGreaterThan(1 / 61);
    expect(KB_MIN_SCORE).toBeLessThan(2 / 84);
    expect(pickKbChunk([chunk(1 / 61)], false)).toBeNull();
    expect(pickKbChunk([chunk(2 / 84)], false)?.title).toBe("Australia partners 2027.pdf");
  });
  it("the keyword-only fallback (score 0, degraded) never qualifies", () => {
    expect(pickKbChunk([chunk(0)], true)).toBeNull();
    expect(pickKbChunk([chunk(0.05)], true)).toBeNull();
  });
  it("the best qualifying chunk wins, with its file and page", () => {
    const r = pickKbChunk([chunk(0.022, { title: "b.pdf" }), chunk(0.031, { title: "a.pdf", page: 7 }), chunk(0.01)], false);
    expect(r).toMatchObject({ title: "a.pdf", page: 7 });
  });
  it("an empty chunk is skipped", () => {
    expect(pickKbChunk([chunk(0.03, { content: "  " })], false)).toBeNull();
  });
  it("the search is the course + country only (no name, phone or email); empty means no search", () => {
    expect(kbQuery({ fieldOfStudy: "Nursing", destinations: ["Australia"] })).toBe("Nursing Australia");
    expect(kbQuery({ fieldOfStudy: null, destinations: [] })).toBe("");
  });
});
