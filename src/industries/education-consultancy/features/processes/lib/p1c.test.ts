import { describe, it, expect } from "vitest";
import { METRIC_REGISTRY, friendlySource, officeHoursText, readMetric } from "./metrics";
import { HEADLINE_METRIC, HEADLINE_STYLE, PROCESS_KEYS, TRIGGER_METRIC } from "./keys";
import { ADMIZZ_NEW_LEAD_RAW, ADMIZZ_SETUP } from "./fixtures";
import { buildBaselineSpec } from "./baseline";
import { liveRules, needsYou, onTrack, resolvePositionName, stepOwners, pluralizeRole, splitBold, writtenFrom, lastReviewed, reviewedText } from "./view";
import { parseProcessSpec, processSpecSchema } from "./spec";
import { buildStepViews, buildTrigger, headlineLabel, pickHeadline } from "../server/load-processes";

describe("headline + trigger metrics", () => {
  it("every headline and trigger metric exists in its registry", () => {
    for (const k of PROCESS_KEYS) expect(METRIC_REGISTRY[k][HEADLINE_METRIC[k]]).toBeDefined();
    for (const [k, m] of Object.entries(TRIGGER_METRIC)) expect(METRIC_REGISTRY[k as (typeof PROCESS_KEYS)[number]][m!]).toBeDefined();
  });
  it("picks the named step as headline, even when an earlier step has a value", () => {
    const spec = buildBaselineSpec("new_lead_first_call", ADMIZZ_SETUP);
    const steps = buildStepViews("new_lead_first_call", spec, ADMIZZ_NEW_LEAD_RAW);
    expect(pickHeadline("new_lead_first_call", steps)?.target.metric).toBe("first_contact_1h_pct");
  });
  it("keeps the first-contact step as headline after v2 switches it to working hours", () => {
    const spec = buildBaselineSpec("new_lead_first_call", ADMIZZ_SETUP);
    const v2 = { ...spec, steps: spec.steps.map((s) => (s.key === "first_contact" ? { ...s, target: { ...s.target, metric: "first_contact_1wh_pct", value: 75 } } : s)) };
    const raw = { ...ADMIZZ_NEW_LEAD_RAW, within_1wh: 24 };
    const steps = buildStepViews("new_lead_first_call", v2, raw);
    const h = pickHeadline("new_lead_first_call", steps)!;
    expect(h.target.metric).toBe("first_contact_1wh_pct");
    expect(h.target.value).toBe(75);
    expect(headlineLabel("new_lead_first_call", steps, raw)).toBe("contacted within 1 working hour");
  });
  it("leaver headline is leavers_holding (not the 0-workable step)", () => {
    const spec = buildBaselineSpec("leaver_handover", ADMIZZ_SETUP);
    const steps = buildStepViews("leaver_handover", spec, { leavers_holding: 7, all_leads_held: 3651, live_leads_held: 0 });
    const h = pickHeadline("leaver_handover", steps)!;
    expect(h.target.metric).toBe("leavers_holding");
    expect(h.value).toBe(7);
    expect(h.status).toBe("red");
  });
  it("falls back to the first step with a value when the shown version lacks the headline step", () => {
    const spec = buildBaselineSpec("new_lead_first_call", ADMIZZ_SETUP);
    const steps = buildStepViews("new_lead_first_call", { ...spec, steps: spec.steps.filter((s) => s.key !== "first_contact") }, ADMIZZ_NEW_LEAD_RAW);
    expect(pickHeadline("new_lead_first_call", steps)?.target.metric).toBe("owner_within_5min_pct");
  });
  it("trigger card reads the arrived number", () => {
    expect(buildTrigger("new_lead_first_call", ADMIZZ_NEW_LEAD_RAW)?.value).toBe(131);
    expect(buildTrigger("visa_to_enrolled", {})).toBeNull();
  });
});

describe("fraction matches detail", () => {
  it("every percent metric's fraction is the x of y its detail quotes", () => {
    const raw = { ...ADMIZZ_NEW_LEAD_RAW, moved_to_enrolled: 0, won_not_enrolled: 47, dropped: 46, with_reason: 0, reason_field_missing: false };
    for (const k of PROCESS_KEYS)
      for (const [name, def] of Object.entries(METRIC_REGISTRY[k])) {
        if (def.unit !== "percent") continue;
        const f = def.fraction!(raw)!;
        expect(f, name).not.toBeNull();
        expect(def.detail(raw), name).toContain(`${f.n} of ${f.d}`);
        expect(def.read(raw)).toBe(Math.round((f.n / f.d) * 1000) / 10);
      }
  });
});

describe("dropping a student, reason field missing", () => {
  const def = METRIC_REGISTRY.dropping_a_student.drops_with_reason_pct;
  it("is 0 of dropped (true: none has a reason)", () => {
    const raw = { dropped: 42, with_reason: null, reason_field_missing: true };
    expect(def.read(raw)).toBe(0);
    expect(def.fraction!(raw)).toEqual({ n: 0, d: 42 });
    expect(def.detail(raw)).toContain("None has a reason");
  });
  it("is null when nothing was dropped", () => {
    expect(def.read({ dropped: 0, reason_field_missing: true })).toBeNull();
    expect(def.fraction!({ dropped: 0, reason_field_missing: true })).toBeNull();
  });
  it("readMetric carries the fraction", () => {
    expect(readMetric("dropping_a_student", "drops_with_reason_pct", { dropped: 42, reason_field_missing: true })?.fraction).toEqual({ n: 0, d: 42 });
  });
  it("baseline text no longer says 'no data'", () => {
    const t = buildBaselineSpec("dropping_a_student", ADMIZZ_SETUP).steps[0].text;
    expect(t).not.toContain("no data");
    expect(t).toContain("today none has one");
  });
});

describe("leavers detail", () => {
  it("says how many are still open", () => {
    expect(METRIC_REGISTRY.leaver_handover.leavers_holding.detail({ leavers_holding: 7, all_leads_held: 3651, live_leads_held: 12 })).toBe(
      "7 people who left still hold 3,651 leads (12 of them still open).",
    );
  });
});

describe("Needs you / On track", () => {
  const mk = (status: string, h: "met" | "amber" | "red" | "unknown") => ({ shown: { status }, headline: { status: h } });
  it("needs you: draft, or red/amber headline", () => {
    expect(needsYou(mk("draft", "met"))).toBe(true);
    expect(needsYou(mk("live", "red"))).toBe(true);
    expect(needsYou(mk("live", "amber"))).toBe(true);
    expect(needsYou(mk("live", "met"))).toBe(false);
    expect(needsYou(mk("live", "unknown"))).toBe(false);
  });
  it("on track: live and met", () => {
    expect(onTrack(mk("live", "met"))).toBe(true);
    expect(onTrack(mk("draft", "met"))).toBe(false);
    expect(onTrack(mk("live", "red"))).toBe(false);
  });
});

describe("who does it", () => {
  const names = new Map([["counselor", "Counselor"], ["lead-executive", "Lead Executive"]]);
  it("resolves slugs, branch-manager -> Manager, unknown slug title-cased", () => {
    expect(resolvePositionName("counselor", names)).toBe("Counselor");
    expect(resolvePositionName("branch-manager", names)).toBe("Manager");
    expect(resolvePositionName("app-executive", names)).toBe("App Executive");
  });
  it("assign step says by hand only while smart assignment is off", () => {
    expect(stepOwners("assign", ["branch-manager"], names, "off")).toBe("Manager, by hand");
    expect(stepOwners("assign", ["branch-manager"], names, "shadow")).toBe("Manager, smart assignment");
    expect(stepOwners("first_contact", ["counselor", "lead-executive"], names, "off")).toBe("Counselor or Lead Executive");
  });
});

describe("rules that run", () => {
  it("only the new-lead process has rules, from HOME_RULES + mode", () => {
    expect(liveRules("visa_to_enrolled", "off")).toBeNull();
    const rows = liveRules("new_lead_first_call", "shadow")!;
    expect(rows.find((r) => r.label === "Assign within")?.value).toBe("5 min · smart assignment (shadow)");
    expect(rows.find((r) => r.label === "First contact")?.value).toBe("1 hour");
    expect(rows.find((r) => r.label === "Unreachable")?.value).toMatch(/^after \d+ no-answers$/);
    expect(rows.find((r) => r.label === "Decide within")?.value).toBe("14 days");
  });
});

describe("addendum: spec fields", () => {
  it("every baseline fills the trigger card fields and passes the schema", () => {
    for (const k of PROCESS_KEYS) {
      const spec = parseProcessSpec(k, buildBaselineSpec(k, ADMIZZ_SETUP));
      expect(spec.trigger.title, k).toBeTruthy();
      expect(spec.trigger.sources, k).toBeTruthy();
      expect(spec.trigger.target, k).toBeTruthy();
      expect(spec.trigger.drives?.length, k).toBeGreaterThan(0);
      for (const st of spec.steps) expect(st.reads?.length, `${k}/${st.key}`).toBeGreaterThan(0);
    }
  });
  it("new lead: the decide step is the DONE WHEN card; step texts lead with bold", () => {
    const spec = buildBaselineSpec("new_lead_first_call", ADMIZZ_SETUP);
    expect(spec.steps.map((s) => s.kind ?? "step")).toEqual(["step", "step", "step", "done"]);
    for (const st of spec.steps) expect(st.text.startsWith("**")).toBe(true);
  });
  it("old specs without the new fields still parse", () => {
    const spec = buildBaselineSpec("visa_to_enrolled", ADMIZZ_SETUP);
    const old = { ...spec, trigger: { text: spec.trigger.text, event: spec.trigger.event }, steps: spec.steps.map((st) => { const c: Record<string, unknown> = { ...st }; delete c.kind; delete c.reads; return c; }) };
    expect(processSpecSchema.safeParse(old).success).toBe(true);
  });
  it("rejects an unknown step kind", () => {
    const spec = buildBaselineSpec("visa_to_enrolled", ADMIZZ_SETUP);
    expect(processSpecSchema.safeParse({ ...spec, steps: [{ ...spec.steps[0], kind: "nope" }] }).success).toBe(false);
  });
});

describe("addendum: SOP + About text", () => {
  it("splitBold renders only **…** and keeps everything else as plain text", () => {
    expect(splitBold("**A manager assigns it** to a Counselor.")).toEqual([
      { text: "A manager assigns it", bold: true },
      { text: " to a Counselor.", bold: false },
    ]);
    expect(splitBold("<b>x</b> no bold")).toEqual([{ text: "<b>x</b> no bold", bold: false }]);
  });
  it("writtenFrom gives the 30 days ending at creation", () => {
    expect(writtenFrom("Admizz", "2026-11-07T12:00:00Z")).toBe("How Admizz worked, 8 Oct–7 Nov");
  });
  it("reviewedText: list meta wording", () => {
    const now = new Date("2026-11-07T12:00:00Z");
    expect(reviewedText(null, now)).toBe("not approved yet");
    expect(reviewedText("2026-11-07T08:00:00Z", now)).toBe("reviewed today");
    expect(reviewedText("2026-11-01T08:00:00Z", now)).toBe("reviewed 1 Nov");
  });
  it("lastReviewed: draft is 'Not yet'; same day says Today with the next review", () => {
    expect(lastReviewed(null, "2026-12-07T12:00:00Z")).toBe("Not yet");
    expect(lastReviewed("2026-11-07T10:00:00Z", "2026-12-07T12:00:00Z", new Date("2026-11-07T12:00:00Z"))).toBe("Today · next by 7 Dec");
    expect(lastReviewed("2026-11-01T10:00:00Z", null, new Date("2026-11-07T12:00:00Z"))).toBe("1 Nov");
  });
});

describe("round 2: wording, formatting, registry-driven display", () => {
  const spec = buildBaselineSpec("new_lead_first_call", ADMIZZ_SETUP);
  const steps = buildStepViews("new_lead_first_call", spec, { ...ADMIZZ_NEW_LEAD_RAW, owner_wait_median_min: 102 });
  it("every process has a headline style and the list labels keep their capitals", () => {
    for (const k of PROCESS_KEYS) expect(HEADLINE_STYLE[k]).toBeTruthy();
    const visa = buildBaselineSpec("visa_to_enrolled", ADMIZZ_SETUP);
    const vs = buildStepViews("visa_to_enrolled", visa, { moved_to_enrolled: 0, won_not_enrolled: 47 });
    expect(headlineLabel("visa_to_enrolled", vs, { moved_to_enrolled: 0, won_not_enrolled: 47 })).toBe("students with a visa moved to Enrolled");
    expect(vs[0].big).toBe("0%");
  });
  it("leaver label carries the lead count with a thousands separator", () => {
    const raw = { leavers_holding: 7, all_leads_held: 3651, live_leads_held: 0 };
    const ls = buildStepViews("leaver_handover", buildBaselineSpec("leaver_handover", ADMIZZ_SETUP), raw);
    expect(headlineLabel("leaver_handover", ls, raw)).toBe("leavers still hold 3,651 leads");
  });
  it("Gets an owner shows the median wait, with the % still driving the bar", () => {
    const assign = steps.find((s) => s.key === "assign")!;
    expect(assign.big).toBe("1.7 h");
    expect(assign.small).toBe("median wait");
    expect(assign.value).toBe(14.5);
    expect(assign.detail).toBe("17 of 117 within 5 minutes. A quarter waited over 8.7 h.");
    expect(assign.detail).not.toContain("incl.");
    expect(assign.note).toContain("already assigned");
    expect(assign.targetWords).toBe("within 5 minutes");
  });
  it("Qualified+ noun on the decide card only", () => {
    expect(steps.find((s) => s.key === "decide")!.small).toBe("85 of 131 Qualified+");
    expect(steps.find((s) => s.key === "first_contact")!.small).toBe("22 of 131");
  });
  it("friendly sources, merged, and the office hours the SQL uses", () => {
    expect(friendlySource(null)).toBe("website forms");
    expect(friendlySource("/register")).toBe("website forms");
    expect(friendlySource("event-page")).toBe("event page");
    expect(friendlySource("dashboard")).toBe("added by staff");
    expect(friendlySource("check_in")).toBe("check-in");
    expect(friendlySource("walk-in")).toBe("walk-in");
    expect(officeHoursText({})).toBe("9–6");
    expect(officeHoursText({ office_hours: { start: 10, end: 19 } })).toBe("10–7");
    const d = METRIC_REGISTRY.new_lead_first_call.arrived.detail({ by_source: [{ medium: null, n: 90 }, { medium: "/register", n: 8 }, { medium: "check_in", n: 8 }], outside_office_hours: 62 });
    expect(d).toBe("98 website forms · 8 check-in. 62 arrived outside 9–6.");
  });
  it("roles are pluralised for About", () => {
    expect(pluralizeRole("Manager")).toBe("Managers");
    expect(pluralizeRole("Lead Executive")).toBe("Lead Executives");
    expect(pluralizeRole("Sales")).toBe("Sales");
  });
  it("baseline fills summary, drivesSummary and targetText everywhere; show metric must exist", () => {
    for (const k of PROCESS_KEYS) {
      const sp = buildBaselineSpec(k, ADMIZZ_SETUP);
      expect(sp.summary, k).toContain("Admizz");
      expect(sp.drivesSummary, k).toBeTruthy();
      for (const st of sp.steps) expect(st.targetText, `${k}/${st.key}`).toBeTruthy();
    }
    expect(() => parseProcessSpec("new_lead_first_call", { ...spec, steps: [{ ...spec.steps[0], show: { metric: "nope" } }] })).toThrow(/show metric/);
  });
});
