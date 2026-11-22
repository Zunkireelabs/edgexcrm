import { describe, expect, it } from "vitest";
import type { Lead } from "@/types/database";
import { looksMistypedEmail, suggestNextStep } from "./suggest";

const NOW = new Date("2026-11-22T12:00:00Z").getTime();
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function lead(over: Partial<Lead> = {}): Lead {
  return {
    email: "a@gmail.com",
    phone: "+9779800000000",
    on_hold: false,
    callback_due_at: null,
    last_touched_at: daysAgo(1),
    destinations: ["UK"],
    degree_level: "Bachelor",
    pre_app_fee_status: null,
    passport_number: null,
    ...over,
  } as Lead;
}
const run = (l: Lead, stageSlug: string | null = "prospects", staleDays = 3) =>
  suggestNextStep({ lead: l, stageSlug, staleDays, now: NOW });

describe("looksMistypedEmail", () => {
  it("flags known provider typos and malformed addresses", () => {
    expect(looksMistypedEmail("x@gmil.com")).toBe(true);
    expect(looksMistypedEmail("x@gmail.con")).toBe(true);
    expect(looksMistypedEmail("x@nodot")).toBe(true);
    expect(looksMistypedEmail("nope")).toBe(true);
  });
  it("leaves real and empty addresses alone", () => {
    expect(looksMistypedEmail("x@gmail.com")).toBe(false);
    expect(looksMistypedEmail("x@some-college.edu.np")).toBe(false);
    expect(looksMistypedEmail(null)).toBe(false);
    expect(looksMistypedEmail("")).toBe(false);
  });
});

describe("suggestNextStep rule order", () => {
  it("on hold wins over everything", () => {
    expect(run(lead({ on_hold: true, callback_due_at: daysAgo(1) }))?.text).toBe("On hold — revisit later");
  });
  it("callback due is urgent", () => {
    expect(run(lead({ callback_due_at: daysAgo(1) }))).toEqual({ text: "Call back — callback due", urgent: true });
  });
  it("a future callback is ignored", () => {
    expect(run(lead({ callback_due_at: new Date(NOW + 86_400_000).toISOString() }))?.text).not.toBe("Call back — callback due");
  });
  it("no contact details", () => {
    expect(run(lead({ email: null, phone: null }))?.text).toBe("Add contact details");
  });
  it("mistyped email", () => {
    expect(run(lead({ email: "laxman45@gmil.com" }))).toEqual({ text: "Fix email — looks mistyped", urgent: true });
  });
  it("never touched", () => {
    expect(run(lead({ last_touched_at: null }))?.text).toBe("Intro call not yet booked");
  });
  it("stale touch uses the tenant threshold", () => {
    expect(run(lead({ last_touched_at: daysAgo(5) }), "prospects", 3)?.text).toBe("Follow up — 5d since touch");
    expect(run(lead({ last_touched_at: daysAgo(5) }), "prospects", 7)?.text).not.toMatch(/Follow up/);
  });
});

describe("suggestNextStep by stage", () => {
  it("prospects: study plan, then fee, then move on", () => {
    expect(run(lead({ degree_level: null }))?.text).toBe("Qualify — confirm study level");
    expect(run(lead({ destinations: [] }))?.text).toBe("Qualify — confirm study level");
    expect(run(lead())?.text).toBe("Collect pre-application fee");
    expect(run(lead({ pre_app_fee_status: "paid" }))?.text).toBe("Move to Applications");
    expect(run(lead({ pre_app_fee_status: "waiver" }))?.text).toBe("Move to Applications");
  });
  it("applications: passport first, then offer letter", () => {
    expect(run(lead(), "applications")?.text).toBe("Collect passport + transcripts");
    expect(run(lead({ passport_number: "P123" }), "applications")?.text).toBe("Chase university offer letter");
  });
  it("qualified and pre-qualified", () => {
    expect(run(lead(), "qualified")?.text).toBe("Move to Prospects");
    expect(run(lead(), "pre-qualified")?.text).toBe("Book counselling session");
  });
  it("unknown stage falls back", () => {
    expect(run(lead(), null)?.text).toBe("Review lead");
  });
});
