import { describe, it, expect } from "vitest";
import { applyChanges, changeTitle, currentValue, describeDrives, parsePart, changeInputSchema } from "./changes";
import { buildBaselineSpec } from "./baseline";
import { ADMIZZ_SETUP } from "./fixtures";
import { METRIC_REGISTRY, metricMinDays, targetOptionsFor } from "./metrics";
import { withinOneWorkingHour, workingClockStart } from "./working-hours";

const live = () => buildBaselineSpec("new_lead_first_call", ADMIZZ_SETUP);
const POS = new Set(["counselor", "lead-executive", "branch-manager"]);
const step = (spec: ReturnType<typeof live>, k: string) => spec.steps.find((s) => s.key === k)!;

describe("parsePart", () => {
  it("accepts the four kinds", () => {
    expect(parsePart("trigger")).toEqual({ kind: "trigger" });
    expect(parsePart("done")).toEqual({ kind: "done" });
    expect(parsePart("exceptions")).toEqual({ kind: "exceptions" });
    expect(parsePart("step:assign")).toEqual({ kind: "step", key: "assign" });
  });
  it.each(["", "step:", "steps:assign", "Trigger", "other"])("throws on %j", (p) => {
    expect(() => parsePart(p)).toThrow(/Unknown part/);
  });
});

describe("applyChanges: target", () => {
  it("sets the number and leaves the words of a percent target alone", () => {
    const out = applyChanges("new_lead_first_call", live(), [{ part: "step:first_contact", field: "target", after: { value: 85 } }], POS);
    expect(step(out, "first_contact").target.value).toBe(85);
    expect(step(out, "first_contact").targetText).toBe("within 1 hour");
  });
  it("switches to a target option: metric, unit and words follow", () => {
    const out = applyChanges("new_lead_first_call", live(), [{ part: "step:first_contact", field: "target", after: { value: 80, metric: "first_contact_1wh_pct" } }], POS);
    expect(step(out, "first_contact").target).toMatchObject({ metric: "first_contact_1wh_pct", unit: "percent", value: 80 });
    expect(step(out, "first_contact").targetText).toBe("within 1 working hour");
  });
  it("refuses a metric that is not an option for that step", () => {
    expect(() => applyChanges("new_lead_first_call", live(), [{ part: "step:assign", field: "target", after: { value: 80, metric: "first_contact_1wh_pct" } }])).toThrow(/not a target option/);
    expect(() => applyChanges("new_lead_first_call", live(), [{ part: "step:first_contact", field: "target", after: { value: 80, metric: "arrived" } }])).toThrow(/not a target option/);
  });
  it("range-checks by unit", () => {
    const t = (value: number) => () => applyChanges("new_lead_first_call", live(), [{ part: "step:first_contact", field: "target", after: { value } }]);
    expect(t(101)).toThrow(/between 0 and 100/);
    expect(t(-1)).toThrow(/between 0 and 100/);
    expect(t(100)).not.toThrow();
    expect(() => applyChanges("leaver_handover", buildBaselineSpec("leaver_handover", ADMIZZ_SETUP), [{ part: "step:no_open_leads", field: "target", after: { value: 1.5 } }])).toThrow(/whole number/);
  });
  it("a count target drops its words so the page regenerates 'at most N'", () => {
    const spec = buildBaselineSpec("leaver_handover", ADMIZZ_SETUP);
    expect(step(spec, "no_open_leads").targetText).toBe("no open leads left");
    const out = applyChanges("leaver_handover", spec, [{ part: "step:no_open_leads", field: "target", after: { value: 3 } }]);
    expect(step(out, "no_open_leads").target.value).toBe(3);
    expect(step(out, "no_open_leads").targetText).toBeUndefined();
  });
  it("needs a number, and a step", () => {
    expect(() => applyChanges("new_lead_first_call", live(), [{ part: "step:first_contact", field: "target", after: "90" }])).toThrow(/needs a number/);
    expect(() => applyChanges("new_lead_first_call", live(), [{ part: "trigger", field: "target", after: { value: 5 } }])).toThrow(/Only a step/);
    expect(() => applyChanges("new_lead_first_call", live(), [{ part: "step:nope", field: "target", after: { value: 5 } }])).toThrow(/Unknown step/);
  });
});

describe("applyChanges: wording", () => {
  it("trigger, step, done", () => {
    const out = applyChanges("new_lead_first_call", live(), [
      { part: "trigger", field: "wording", after: "  A lead is created.  " },
      { part: "step:assign", field: "wording", after: "**A manager assigns it** fast." },
      { part: "done", field: "wording", after: "The lead is decided." },
    ]);
    expect(out.trigger.text).toBe("A lead is created.");
    expect(step(out, "assign").text).toBe("**A manager assigns it** fast.");
    expect(out.doneWhen).toBe("The lead is decided.");
  });
  it("exceptions is a list of non-empty strings", () => {
    const out = applyChanges("new_lead_first_call", live(), [{ part: "exceptions", field: "wording", after: ["One", " Two "] }]);
    expect(out.exceptions).toEqual(["One", "Two"]);
    expect(() => applyChanges("new_lead_first_call", live(), [{ part: "exceptions", field: "wording", after: ["ok", " "] }])).toThrow(/can't be empty/);
    expect(() => applyChanges("new_lead_first_call", live(), [{ part: "exceptions", field: "wording", after: "not a list" }])).toThrow(/short list/);
  });
  it("empty or oversize text is refused", () => {
    expect(() => applyChanges("new_lead_first_call", live(), [{ part: "done", field: "wording", after: "   " }])).toThrow(/can't be empty/);
    expect(() => applyChanges("new_lead_first_call", live(), [{ part: "done", field: "wording", after: "x".repeat(1300) }])).toThrow(/too long/);
    expect(() => applyChanges("new_lead_first_call", live(), [{ part: "done", field: "wording", after: 5 }])).toThrow(/can't be empty/);
  });
});

describe("applyChanges: who", () => {
  it("sets position slugs (deduped) that exist", () => {
    const out = applyChanges("new_lead_first_call", live(), [{ part: "step:call_back", field: "who", after: ["counselor", "counselor", "branch-manager"] }], POS);
    expect(step(out, "call_back").who).toEqual(["counselor", "branch-manager"]);
  });
  it("refuses an unknown slug, an empty list, a non-step part", () => {
    expect(() => applyChanges("new_lead_first_call", live(), [{ part: "step:call_back", field: "who", after: ["ghost"] }], POS)).toThrow(/Unknown position: ghost/);
    expect(() => applyChanges("new_lead_first_call", live(), [{ part: "step:call_back", field: "who", after: [] }], POS)).toThrow(/at least one/);
    expect(() => applyChanges("new_lead_first_call", live(), [{ part: "done", field: "who", after: ["counselor"] }], POS)).toThrow(/Only a step/);
  });
});

describe("applyChanges: general", () => {
  it("never mutates the live spec", () => {
    const before = live();
    const snap = JSON.stringify(before);
    applyChanges("new_lead_first_call", before, [{ part: "step:first_contact", field: "target", after: { value: 99 } }]);
    expect(JSON.stringify(before)).toBe(snap);
  });
  it("applies in order and rejects an unknown field", () => {
    const out = applyChanges("new_lead_first_call", live(), [
      { part: "step:first_contact", field: "target", after: { value: 70 } },
      { part: "step:first_contact", field: "target", after: { value: 75 } },
    ]);
    expect(step(out, "first_contact").target.value).toBe(75);
    expect(() => applyChanges("new_lead_first_call", live(), [{ part: "done", field: "colour" as never, after: "x" }])).toThrow(/Unknown field/);
  });
  it("no changes = the same spec", () => {
    expect(applyChanges("new_lead_first_call", live(), [])).toEqual(live());
  });
});

describe("currentValue (a change's `before`)", () => {
  it("reads each part x field", () => {
    const s = live();
    expect(currentValue(s, "step:first_contact", "target")).toEqual({ value: 80, metric: "first_contact_1h_pct" });
    expect(currentValue(s, "step:first_contact", "who")).toEqual(["counselor", "lead-executive"]);
    expect(currentValue(s, "trigger", "wording")).toBe(s.trigger.text);
    expect(currentValue(s, "done", "wording")).toBe(s.doneWhen);
    expect(currentValue(s, "exceptions", "wording")).toEqual(s.exceptions);
    expect(currentValue(s, "step:assign", "wording")).toBe(step(s, "assign").text);
    expect(() => currentValue(s, "done", "target")).toThrow();
  });
});

describe("describeDrives", () => {
  const st = { drives: ["Home: new lead not called"] };
  it("target / who / wording", () => {
    expect(describeDrives({ field: "target", after: {} }, st)).toBe("Home: new lead not called uses the new target");
    expect(describeDrives({ field: "who", after: ["counselor", "x"] }, st, new Map([["counselor", "Counselor"]]))).toBe("Home: new lead not called goes to Counselor, x");
    expect(describeDrives({ field: "wording", after: "x" }, st)).toBe("No product change: wording only");
  });
  it("several drives, none, and no step", () => {
    expect(describeDrives({ field: "target", after: {} }, { drives: ["A", "B"] })).toBe("A, B use the new target");
    expect(describeDrives({ field: "who", after: ["c"] }, { drives: ["A", "B"] })).toBe("A, B go to c");
    expect(describeDrives({ field: "target", after: {} }, { drives: [] })).toBe("No product change yet");
    expect(describeDrives({ field: "who", after: ["c"] }, undefined)).toBe("No product change yet");
  });
});

describe("changeTitle", () => {
  it("names the part", () => {
    const s = live();
    expect(changeTitle({ part: "step:first_contact", field: "target" }, s)).toBe("First contact: target");
    expect(changeTitle({ part: "trigger", field: "wording" }, s)).toBe("Trigger: wording");
    expect(changeTitle({ part: "done", field: "wording" }, null)).toBe("Done when: wording");
    expect(changeTitle({ part: "step:zzz", field: "who" }, s)).toBe("zzz: who");
  });
});

describe("changeInputSchema", () => {
  it("needs a why and bounds the evidence", () => {
    expect(changeInputSchema.safeParse({ part: "done", field: "wording", after: "x", why: "  " }).success).toBe(false);
    const ok = changeInputSchema.safeParse({ part: "done", field: "wording", after: "x", why: "because" });
    expect(ok.success && ok.data.evidence).toEqual([]);
    expect(changeInputSchema.safeParse({ part: "done", field: "wording", after: "x", why: "y", evidence: Array(9).fill({ metric: "a", label: "b", value: 1 }) }).success).toBe(false);
  });
});

describe("registry: target options + minDays + the new metric", () => {
  it("first-contact step offers hour and working hour; others none", () => {
    expect(targetOptionsFor("new_lead_first_call", "first_contact").map((o) => o.metric)).toEqual(["first_contact_1h_pct", "first_contact_1wh_pct"]);
    expect(targetOptionsFor("new_lead_first_call", "assign")).toEqual([]);
    expect(targetOptionsFor("visa_to_enrolled", "x")).toEqual([]);
  });
  it("minDays: default 7, qualified 14", () => {
    expect(metricMinDays("new_lead_first_call", "first_contact_1h_pct")).toBe(7);
    expect(metricMinDays("new_lead_first_call", "reached_qualified_pct")).toBe(14);
    expect(metricMinDays("new_lead_first_call", "unknown")).toBe(7);
  });
  it("first_contact_1wh_pct reads within_1wh / arrived, and is 'no data' on an old snapshot", () => {
    const def = METRIC_REGISTRY.new_lead_first_call.first_contact_1wh_pct;
    expect(def.read({ arrived: 200, within_1wh: 50 })).toBe(25);
    expect(def.fraction?.({ arrived: 200, within_1wh: 50 })).toEqual({ n: 50, d: 200 });
    expect(def.read({ arrived: 200 })).toBeNull();
    expect(def.read({ arrived: 0, within_1wh: 0 })).toBeNull();
  });
  it("the old metric keys are all still there", () => {
    expect(Object.keys(METRIC_REGISTRY.new_lead_first_call)).toEqual(expect.arrayContaining(["arrived", "owner_within_5min_pct", "owner_wait_median_min", "first_contact_1h_pct", "callbacks_kept_pct", "reached_qualified_pct"]));
  });
});

describe("working clock start (twin of migration 287's wstart)", () => {
  const KTM = "Asia/Kathmandu"; // UTC+5:45
  const at = (s: string) => new Date(s);
  it("inside office hours: the clock starts at arrival", () => {
    const t = at("2026-11-02T05:00:00Z"); // 10:45 KTM
    expect(workingClockStart(t, KTM)).toEqual(t);
  });
  it("before 09:00: the same day's 09:00", () => {
    // 02:00Z = 07:45 KTM -> 09:00 KTM = 03:15Z
    expect(workingClockStart(at("2026-11-02T02:00:00Z"), KTM)).toEqual(at("2026-11-02T03:15:00Z"));
  });
  it("at/after 18:00: the next day's 09:00", () => {
    // 12:15Z = 18:00 KTM exactly -> next day 09:00 KTM = 03:15Z on the 3rd
    expect(workingClockStart(at("2026-11-02T12:15:00Z"), KTM)).toEqual(at("2026-11-03T03:15:00Z"));
    expect(workingClockStart(at("2026-11-02T17:00:00Z"), KTM)).toEqual(at("2026-11-03T03:15:00Z"));
  });
  it("09:00 sharp is inside; 17:59 is inside", () => {
    expect(workingClockStart(at("2026-11-02T03:15:00Z"), KTM)).toEqual(at("2026-11-02T03:15:00Z"));
    expect(workingClockStart(at("2026-11-02T12:14:00Z"), KTM)).toEqual(at("2026-11-02T12:14:00Z"));
  });
  it("month and year roll over", () => {
    expect(workingClockStart(at("2026-12-31T18:00:00Z"), "UTC")).toEqual(at("2027-01-01T09:00:00Z"));
  });
  it("other timezones (DST) use the tenant's clock, not UTC's", () => {
    // New York in EDT (UTC-4) on 2026-06-10: 23:30Z = 19:30 local -> next day 09:00 EDT = 13:00Z
    expect(workingClockStart(at("2026-06-10T23:30:00Z"), "America/New_York")).toEqual(at("2026-06-11T13:00:00Z"));
    // and in EST (UTC-5) on 2026-12-10
    expect(workingClockStart(at("2026-12-10T23:30:00Z"), "America/New_York")).toEqual(at("2026-12-11T14:00:00Z"));
  });
  it("within 1 working hour: a 21:00 lead called at 09:40 next morning counts; a 10:30 call does not; never = false", () => {
    const created = at("2026-11-02T15:15:00Z"); // 21:00 KTM
    expect(withinOneWorkingHour(created, at("2026-11-03T03:55:00Z"), KTM)).toBe(true); // 09:40 KTM
    expect(withinOneWorkingHour(created, at("2026-11-03T04:46:00Z"), KTM)).toBe(false); // 10:31 KTM
    expect(withinOneWorkingHour(created, null, KTM)).toBe(false);
  });
});
