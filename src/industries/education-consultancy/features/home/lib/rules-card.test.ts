import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultPolicy, derivePolicy } from "../../processes/lib/policy";
import { buildBaselineSpec } from "../../processes/lib/baseline";
import { ADMIZZ_SETUP } from "../../processes/lib/fixtures";
import { liveRules, measuredRules, rulesFooter } from "../../processes/lib/view";
import { buildRulesCard } from "./rules-card";
import { shortWait, unassignedRow } from "./needs-you";
import { resolveFirstTouchPositions, type TenantDb } from "../server/assignment/settings";

const OH = { days: [0, 1, 2, 3, 4, 5], startMin: 540, endMin: 1080, source: "saved" as const };
const v2Spec = () => {
  const s = buildBaselineSpec("new_lead_first_call", ADMIZZ_SETUP);
  s.steps.find((x) => x.key === "first_contact")!.target = { metric: "first_contact_1wh_pct", op: ">=", value: 75, unit: "percent" };
  return s;
};
const live = (spec = v2Spec()) => derivePolicy({ version: 2, approvedAt: "2026-11-07T08:00:00Z", ownerName: "Manish", approvedByName: "Manish", spec }, OH);

describe("buildRulesCard (T2)", () => {
  it("rows and footer from a live v2", () => {
    const c = buildRulesCard(live(), "off", "Asia/Kathmandu");
    expect(c.rows).toEqual([
      { label: "Assign within", value: "5 min · by hand" },
      { label: "First contact", value: "1 working hour" },
      { label: "Office hours", value: "Sun–Fri, 9–6" },
    ]);
    expect(c.footer).toBe("From New lead → first call v2, approved by Manish on 7 Nov.");
    expect(c.href).toBe("/processes/new_lead_first_call");
  });
  it("assignment mode words", () => {
    expect(buildRulesCard(live(), "shadow", "UTC").rows[0].value).toBe("5 min · shadow");
    expect(buildRulesCard(live(), "auto", "UTC").rows[0].value).toBe("5 min · auto");
  });
  it("plain clock reads '1 hour'", () => {
    expect(buildRulesCard(live(buildBaselineSpec("new_lead_first_call", ADMIZZ_SETUP)), "off", "UTC").rows[1].value).toBe("1 hour");
  });
  it("no live process: today's defaults and the plain sentence, no Open link", () => {
    const c = buildRulesCard(defaultPolicy(), "off", "UTC");
    expect(c.footer).toBe("Today's defaults: no process is live yet.");
    expect(c.href).toBeNull();
    expect(c.rows[1].value).toBe("1 hour");
  });
  it("the date is cut in the tenant zone, not the server's", () => {
    // approved 7 Nov 20:00 UTC is already 8 Nov in Kathmandu.
    const p = derivePolicy({ version: 2, approvedAt: "2026-11-07T20:00:00Z", ownerName: null, approvedByName: "Manish", spec: v2Spec() }, OH);
    expect(buildRulesCard(p, "off", "Asia/Kathmandu").footer).toContain("on 8 Nov");
    expect(buildRulesCard(p, "off", "America/New_York").footer).toContain("on 7 Nov");
  });
});

describe("unassignedRow against the process target (T2)", () => {
  const base = { count: 3, oldestAt: "2026-11-08T05:00:00Z", now: new Date("2026-11-08T05:20:00Z"), plan: { kind: "none" } as never, leadIds: ["a", "b", "c"], chooseHref: "/leads" };
  it("over the target: red, 'Waiting 12 min · target 5 min'", () => {
    const r = unassignedRow({ ...base, target: { waitMin: 12, targetMin: 5 } })!;
    expect(r.chip).toEqual({ text: "Waiting 12 min · target 5 min", tone: "bad" });
    expect(r.tone).toBe("bad");
  });
  it("under (or at) the target: blue, 'Waiting 3 min'", () => {
    expect(unassignedRow({ ...base, target: { waitMin: 3, targetMin: 5 } })!.chip).toEqual({ text: "Waiting 3 min", tone: "new" });
    expect(unassignedRow({ ...base, target: { waitMin: 5, targetMin: 5 } })!.tone).toBe("new");
  });
  it("no live process: today's plain hours wording, blue", () => {
    const r = unassignedRow(base)!;
    expect(r.chip).toEqual({ text: "Waiting 1 h", tone: "new" });
    expect(r.tone).toBe("new");
  });
  it("shortWait", () => {
    expect([shortWait(0), shortWait(12), shortWait(89), shortWait(90), shortWait(60 * 50)]).toEqual(["1 min", "12 min", "89 min", "2 h", "2 days"]);
  });
});

describe("Rules card on the process page", () => {
  it("new lead: five rows from the reader; a v2 says working hour; a rules block shows", () => {
    const rows = liveRules("new_lead_first_call", "off", live())!;
    expect(rows.map((r) => r.value)).toEqual(["5 min · by hand", "1 working hour", "on the day booked", "after 3 no-answers", "14 days"]);
    const spec = { ...v2Spec(), rules: { unreachableAfterCalls: 4, decideWithinDays: 21 } };
    expect(liveRules("new_lead_first_call", "off", live(spec))!.slice(3).map((r) => r.value)).toEqual(["after 4 no-answers", "21 days"]);
  });
  it("without a policy it is today's constants", () => {
    expect(liveRules("new_lead_first_call", "shadow")![1].value).toBe("1 hour");
  });
  it("the footer: the P2 sentence for new lead, 'Measured only today' + the ticket for the others", () => {
    expect(rulesFooter("new_lead_first_call", true)).toBe("Change a rule here (through a new version) and Home, assignment and reminders change with it.");
    expect(rulesFooter("visa_to_enrolled", true)).toBe("Measured only today. EDGEX-105 makes it run.");
    expect(rulesFooter("dropping_a_student", false)).toBe("Measured only today. EDGEX-107 makes it run.");
    expect(rulesFooter("leaver_handover", false)).toBe("Measured only today. EDGEX-108 makes it run.");
  });
  it("measured-only rows come from the steps' targets", () => {
    expect(measuredRules([{ title: "Move to Enrolled", target: { op: ">=", value: 80, unit: "percent" }, targetWords: null }, { title: "Reason", target: { op: "<=", value: 0, unit: "count" }, targetWords: "none left" }])).toEqual([
      { label: "Move to Enrolled", value: "at least 80%" },
      { label: "Reason", value: "none left" },
    ]);
  });
});

describe("smart assignment takes 'who' from the live process (T4)", () => {
  const db = { from: () => ({ select: () => ({ is: () => ({ gte: () => ({ eq: async () => ({ count: 0 }) }) }) }), then: undefined }) } as unknown as TenantDb;
  const saved = { mode: "auto" as const, firstTouchPositions: ["lead-caller"], positionsSaved: true };
  it("the process's positions win over the saved ones", async () => {
    expect(await resolveFirstTouchPositions(db, saved, new Date(), ["counselor", "lead-executive"])).toEqual(["counselor", "lead-executive"]);
  });
  it("no process positions (null or empty): the saved ones, as before", async () => {
    expect(await resolveFirstTouchPositions(db, saved, new Date(), null)).toEqual(["lead-caller"]);
    expect(await resolveFirstTouchPositions(db, saved, new Date(), [])).toEqual(["lead-caller"]);
  });
  it("derivePolicy hands the First contact step's who to the engine", () => {
    expect(live().firstTouchPositions).toEqual(v2Spec().steps.find((s) => s.key === "first_contact")!.who);
  });
});

describe("wiring guards (the readers are really used)", () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), "utf8");
  it("the engine picks from the live process's positions first", () => {
    const src = read("../server/assignment/engine.ts");
    expect(src).toContain("loadProcessPolicy(db, tenantId)");
    expect(src).toContain("resolveFirstTouchPositions(db, settings, now, policy.firstTouchPositions)");
  });
  it("owner Home passes the clock to education_home_impact and compares the wait with the process target", () => {
    const src = read("../server/load-manager.ts");
    expect(src).toContain("p_working: working");
    expect(src).toContain("workingMinutesBetween(new Date(unassigned.oldestAt)");
    expect(src).toContain("targetMin: policy.assignWithinMin");
  });
  it("counsellor Home builds its rules from the reader", () => {
    const src = read("../server/load-page.ts");
    expect(src).toContain("toHomePolicy(await loadProcessPolicy(db, auth.tenantId))");
    expect(src).toContain("const ctx = { now, tz, policy }");
  });
});
