import { describe, it, expect } from "vitest";
import { buildMeasures, changeValue, comparePeriods, measureMetrics, previousOnlyMetrics, specMetrics, waitText } from "./compare";
import { buildBaselineSpec } from "./baseline";
import { ADMIZZ_NEW_LEAD_RAW, ADMIZZ_SETUP } from "./fixtures";
import { buildImprovementLog, dayKey, groupLogEvents, thirtyDaysOn, type LogChange, type LogVersion } from "./improvements-log";
import { previousVersion } from "../server/compare";

const DAY = 86_400_000;
const approved = new Date("2026-11-01T00:00:00Z");

describe("comparePeriods", () => {
  it("previous = the 30 days before approval; current = approval -> now, capped at 30 days", () => {
    const p = comparePeriods(approved, new Date(approved.getTime() + 3 * DAY + 5000));
    expect(p.previous.from).toEqual(new Date(approved.getTime() - 30 * DAY));
    expect(p.previous.to).toEqual(approved);
    expect(p.current).toEqual({ from: approved, to: new Date(approved.getTime() + 3 * DAY + 5000) });
    expect(p.daysLive).toBe(3);
    const late = comparePeriods(approved, new Date(approved.getTime() + 90 * DAY));
    expect(late.current.to).toEqual(new Date(approved.getTime() + 30 * DAY));
    expect(late.daysLive).toBe(90);
  });
  it("approved 'now' = 0 days live", () => {
    expect(comparePeriods(approved, approved).daysLive).toBe(0);
  });
});

describe("compare labels (the S3 wording) and direction", () => {
  it("each measure uses its compareLabel, falling back to label, and knows which way is better", () => {
    const ms = buildMeasures("new_lead_first_call", ["owner_wait_median_min", "first_contact_1wh_pct", "callbacks_kept_pct", "reached_qualified_pct", "arrived"], null, null, 30);
    expect(ms.map((m) => m.label)).toEqual(["Wait for an owner (median)", "Called within 1 working hour", "Call-backs kept on the day", "New leads that reached Qualified", "Leads that arrived"]);
    expect(ms.map((m) => m.better)).toEqual(["down", "up", "up", "up", "down"]);
  });
});

describe("previous-only measures are labelled", () => {
  it("'Called within 1 hour (v1's measure)'", () => {
    const ms = buildMeasures("new_lead_first_call", ["first_contact_1wh_pct", "first_contact_1h_pct"], null, null, 5, { previousOnly: new Set(["first_contact_1h_pct"]), previousVersion: 1 });
    expect(ms.map((m) => m.label)).toEqual(["Called within 1 working hour", "Called within 1 hour (v1's measure)"]);
  });
});

describe("changeValue", () => {
  it("percent -> points, min -> % on the old value, count -> absolute", () => {
    expect(changeValue("percent", 16, 29)).toBe(13);
    expect(changeValue("percent", 29.5, 16.2)).toBe(-13.3);
    expect(changeValue("min", 120, 90)).toBe(-25);
    expect(changeValue("min", 0, 90)).toBeNull();
    expect(changeValue("count", 47, 40)).toBe(-7);
  });
  it("null when either side is unknown", () => {
    expect(changeValue("percent", null, 10)).toBeNull();
    expect(changeValue("percent", 10, null)).toBeNull();
  });
});

describe("buildMeasures: ready / minDays / wait text", () => {
  const before = { ...ADMIZZ_NEW_LEAD_RAW };
  const after = { ...ADMIZZ_NEW_LEAD_RAW, within_1h: 60, within_1wh: 80, callbacks_kept: 20, reached_qualified: 100, owner_wait_median_min: 60 };
  const metrics = ["owner_wait_median_min", "first_contact_1wh_pct", "callbacks_kept_pct", "reached_qualified_pct"];

  it("3 days in: nothing is ready, the change column waits, the 14-day measure shows no 'after' at all", () => {
    const ms = buildMeasures("new_lead_first_call", metrics, before, after, 3);
    expect(ms.every((m) => !m.ready && m.change === null)).toBe(true);
    expect(ms.find((m) => m.metric === "callbacks_kept_pct")).toMatchObject({ waitText: "after 7 days", after: 25.6 });
    expect(ms.find((m) => m.metric === "reached_qualified_pct")).toMatchObject({ ready: false, after: null, waitText: "needs 14 days (the step's own target)", minDays: 14 });
  });
  it("under 1 full day live: no numbers yet, only the wait text", () => {
    const ms = buildMeasures("new_lead_first_call", metrics, before, after, 0);
    expect(ms.every((m) => m.after === null && m.change === null && !m.ready)).toBe(true);
  });
  it("1 full day live: v2's number shows, only the Change column waits; the 14-day measure stays empty with its wait text", () => {
    const ms = buildMeasures("new_lead_first_call", metrics, before, after, 1);
    const by = Object.fromEntries(ms.map((m) => [m.metric, m]));
    expect(by.first_contact_1wh_pct).toMatchObject({ after: 61.1, change: null, ready: false, waitText: "after 7 days" });
    expect(by.owner_wait_median_min).toMatchObject({ after: 60, change: null });
    expect(by.reached_qualified_pct).toMatchObject({ after: null, change: null, waitText: "needs 14 days (the step's own target)" });
  });
  it("8 days in: the 7-day measures are ready with their change; the 14-day one still waits", () => {
    const ms = buildMeasures("new_lead_first_call", metrics, before, after, 8);
    const by = Object.fromEntries(ms.map((m) => [m.metric, m]));
    expect(by.first_contact_1wh_pct).toMatchObject({ ready: true, waitText: "", before: 23.7, after: 61.1 });
    expect(by.first_contact_1wh_pct.change).toBe(37.4);
    expect(by.owner_wait_median_min).toMatchObject({ unit: "min", before: 114, after: 60, change: -47.4 });
    expect(by.reached_qualified_pct).toMatchObject({ ready: false, change: null, after: null });
  });
  it("15 days in: everything is ready", () => {
    const ms = buildMeasures("new_lead_first_call", metrics, before, after, 15);
    expect(ms.every((m) => m.ready && m.waitText === "")).toBe(true);
    expect(ms.find((m) => m.metric === "reached_qualified_pct")!.change).not.toBeNull();
  });
  it("an old snapshot without the new key reads as no data, never 0", () => {
    const old = { ...ADMIZZ_NEW_LEAD_RAW } as Record<string, unknown>;
    delete old.within_1wh;
    const m = buildMeasures("new_lead_first_call", ["first_contact_1wh_pct"], old, after, 10)[0];
    expect(m.before).toBeNull();
    expect(m.change).toBeNull();
  });
  it("a missing raw side is null, unknown metrics are skipped", () => {
    expect(buildMeasures("new_lead_first_call", ["arrived", "nope"], null, null, 10)).toEqual([expect.objectContaining({ metric: "arrived", before: null, after: null, change: null })]);
  });
  it("waitText wording", () => {
    expect(waitText(7)).toBe("after 7 days");
    expect(waitText(14)).toBe("needs 14 days (the step's own target)");
  });
});

describe("which measures", () => {
  it("target + show metrics in step order, and the union with the previous version's", () => {
    const cur = buildBaselineSpec("new_lead_first_call", ADMIZZ_SETUP);
    expect(specMetrics(cur)).toEqual(["owner_within_5min_pct", "owner_wait_median_min", "first_contact_1h_pct", "callbacks_kept_pct", "reached_qualified_pct"]);
    const next = structuredClone(cur);
    next.steps[1].target.metric = "first_contact_1wh_pct";
    // v1's "1 hour" measure sits right after v2's "1 working hour" (same step), not last.
    expect(measureMetrics(cur, next)).toEqual(["owner_within_5min_pct", "owner_wait_median_min", "first_contact_1wh_pct", "first_contact_1h_pct", "callbacks_kept_pct", "reached_qualified_pct"]);
    expect([...previousOnlyMetrics(cur, next)]).toEqual(["first_contact_1h_pct"]);
    expect(measureMetrics(null, cur)).toEqual(specMetrics(cur));
  });
  it("previousVersion = the highest earlier version that was ever approved", () => {
    const vs = [
      { version: 1, approved_at: "a" },
      { version: 2, approved_at: null }, // rejected draft
      { version: 3, approved_at: "c" },
    ];
    expect(previousVersion(vs, vs[2])).toBe(vs[0]);
    expect(previousVersion(vs, vs[0])).toBeNull();
  });
});

describe("improvements log", () => {
  const v = (o: Partial<LogVersion> & { id: string; version: number }): LogVersion => ({
    processKey: "new_lead_first_call", status: "retired", source: "person", created_at: "2026-10-01T00:00:00Z", approved_at: null, approved_by: null, rejected_at: null, rejected_by: null, rejected_reason: null, ...o,
  });
  const names = new Map([["u1", "Manish"]]);
  const versions: LogVersion[] = [
    v({ id: "v1", version: 1, source: "system", status: "retired", approved_at: "2026-10-02T00:00:00Z", approved_by: "u1" }),
    v({ id: "v2", version: 2, status: "live", created_at: "2026-10-05T00:00:00Z", approved_at: "2026-10-10T00:00:00Z", approved_by: "u1" }),
    v({ id: "v3", version: 3, status: "rejected", created_at: "2026-11-01T00:00:00Z", rejected_at: "2026-11-02T00:00:00Z", rejected_by: "u1", rejected_reason: "Not now" }),
  ];
  const changes: LogChange[] = [{ id: "c1", processKey: "new_lead_first_call", versionId: "v2", title: "First contact: count in working hours", why: "Almost half our new leads arrive after 6 pm, so nobody can call them within an hour. Count the hour from 9 am instead.", status: "taken", author_user_id: "u1", author_kind: "person", created_at: "2026-10-06T00:00:00Z" }];

  it("derives baseline, suggested, approved, rejected and '30 days on', newest first", () => {
    const log = buildImprovementLog({ versions, changes, names, measuresByVersion: new Map([["v2", []]]), now: new Date("2026-11-20T00:00:00Z") });
    expect(log.map((e) => `${e.kind}:${e.version}`)).toEqual(["thirty_days:2", "rejected:3", "approved:2", "suggested:2", "approved:1", "baseline:1"]);
    expect([...log].map((e) => e.at)).toEqual([...log].map((e) => e.at).sort().reverse());
    const rej = log.find((e) => e.kind === "rejected")!;
    expect(rej).toMatchObject({ actor: "Manish", reason: "Not now", text: "New lead → first call: draft v3 rejected" });
    expect(log.find((e) => e.kind === "suggested")).toMatchObject({ actor: "Manish", text: "New lead → first call: change suggested" });
  });
  it("the mockup's meta lines: suggested, live (taken / not taken), rejected, 30 days on", () => {
    const more: LogChange[] = [...changes, { ...changes[0], id: "c2", title: "Call-back kept: new wording", status: "not_taken", created_at: "2026-10-07T00:00:00Z" }];
    const log = buildImprovementLog({ versions, changes: more, names, measuresByVersion: new Map(), now: new Date("2026-11-20T00:00:00Z") });
    expect(log.find((e) => e.kind === "suggested")!.meta).toBe('Manish · Call-back kept: new wording · "Almost half our new leads arrive after 6 pm, so nobody can call them within an h…"');
    expect(log.find((e) => e.kind === "approved" && e.version === 2)).toMatchObject({
      text: "New lead → first call: v2 live",
      meta: "1 change: First contact: count in working hours · suggested by Manish, approved by Manish · 1 change not taken",
    });
    expect(log.find((e) => e.kind === "rejected")!.meta).toBe('Rejected by Manish · "Not now"');
    expect(log.find((e) => e.kind === "thirty_days")).toMatchObject({ text: "New lead → first call: v2, 30 days on" });
    expect(log.find((e) => e.kind === "thirty_days")!.meta).toMatch(/^Same measures as v1, /);
    expect(log.find((e) => e.kind === "approved" && e.version === 1)).toMatchObject({ text: "New lead → first call: baseline approved", meta: "v1 approved by Manish" });
  });
  it("skipThirtyDays leaves them out (the cheap list-card variant)", () => {
    const log = buildImprovementLog({ versions, changes, names, measuresByVersion: new Map(), now: new Date("2026-11-20T00:00:00Z"), skipThirtyDays: true });
    expect(log.some((e) => e.kind === "thirty_days")).toBe(false);
  });
  it("groups baselines written / approved the same day by the same person, leaves the rest", () => {
    const keys = ["new_lead_first_call", "visa_to_enrolled", "dropping_a_student", "leaver_handover"] as const;
    const vs: LogVersion[] = keys.map((k, i) => v({ id: `b${i}`, processKey: k, version: 1, source: "system", status: "live", created_at: `2026-11-07T10:0${i}:00Z`, approved_at: `2026-11-07T11:0${i}:00Z`, approved_by: "u1" }));
    const log = groupLogEvents(buildImprovementLog({ versions: vs, changes: [], names, measuresByVersion: new Map(), now: new Date("2026-11-08T00:00:00Z") }), "UTC");
    expect(log.map((e) => e.text)).toEqual(["4 baselines approved", "4 processes written from your data"]);
    expect(log[0].processKeys).toEqual([...keys].reverse());
    expect(log[0].meta).toBe("Manish approved v1 of When someone leaves the team, Dropping a student, Visa → Enrolled, New lead → first call");
    expect(log[1].meta).toMatch(/^v1 as-is baseline of each, from /);
  });
  it("two baselines on different days stay two rows", () => {
    const vs: LogVersion[] = [
      v({ id: "a", version: 1, source: "system", created_at: "2026-11-07T10:00:00Z" }),
      v({ id: "b", processKey: "visa_to_enrolled", version: 1, source: "system", created_at: "2026-11-09T10:00:00Z" }),
    ];
    const log = groupLogEvents(buildImprovementLog({ versions: vs, changes: [], names, measuresByVersion: new Map(), now: new Date("2026-11-10T00:00:00Z") }), "UTC");
    expect(log).toHaveLength(2);
  });
  it("dayKey follows the tenant timezone", () => {
    expect(dayKey("2026-11-07T20:00:00Z", "UTC")).toBe("2026-11-07");
    expect(dayKey("2026-11-07T20:00:00Z", "Asia/Kathmandu")).toBe("2026-11-08");
  });
  it("before -> after button: approved v2+ and every '30 days on', not v1", () => {
    const log = buildImprovementLog({ versions, changes, names, measuresByVersion: new Map(), now: new Date("2026-11-20T00:00:00Z") });
    expect(log.filter((e) => e.beforeAfter).map((e) => `${e.kind}:${e.version}`)).toEqual(["thirty_days:2", "approved:2"]);
  });
  it("'30 days on' needs 30 days live, and a newer approval cuts it short", () => {
    expect(thirtyDaysOn(versions, new Date("2026-11-05T00:00:00Z"))).toEqual([]); // v2 live 26 days
    expect(thirtyDaysOn(versions, new Date("2026-11-09T12:00:00Z")).map((t) => t.id)).toEqual(["v2"]);
    const replaced = versions.concat(v({ id: "v4", version: 4, status: "live", approved_at: "2026-10-20T00:00:00Z" }));
    expect(thirtyDaysOn(replaced, new Date("2026-12-20T00:00:00Z")).map((t) => t.id)).toEqual(["v4"]); // v2 only ran 10 days
  });
  it("an agent-authored suggestion is attributed to Orca", () => {
    const log = buildImprovementLog({ versions, changes: [{ ...changes[0], author_kind: "agent", author_user_id: null }], names, measuresByVersion: new Map(), now: new Date("2026-10-20T00:00:00Z") });
    expect(log.find((e) => e.kind === "suggested")!.actor).toBe("Orca");
  });
});

describe("improvements log: office hours changed", () => {
  const live = (o: Partial<LogVersion> & { id: string; processKey: LogVersion["processKey"]; version: number }): LogVersion => ({
    status: "live", source: "person", created_at: "2026-10-01T00:00:00Z", approved_at: "2026-10-10T00:00:00Z", approved_by: "u1", rejected_at: null, rejected_by: null, rejected_reason: null, ...o,
  });
  const base = { changes: [], names: new Map([["u1", "Manish"]]), measuresByVersion: new Map(), now: new Date("2026-11-20T00:00:00Z"), skipThirtyDays: true };
  const change = { at: "2026-11-08T06:00:00Z", actor: "Sadin", from: "every day, 9–6", to: "Sun–Fri, 9–6" };

  it("appears once under each process whose live version uses a working clock, with who and old → new", () => {
    const v = live({ id: "v2", processKey: "new_lead_first_call", version: 2 });
    const log = buildImprovementLog({ ...base, versions: [v], workingClockVersions: [v], officeHoursChanges: [change] });
    const e = log.filter((x) => x.kind === "office_hours");
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ processKey: "new_lead_first_call", version: 2, at: change.at, actor: "Sadin", text: "New lead → first call: office hours changed", meta: "Sadin · every day, 9–6 → Sun–Fri, 9–6" });
  });
  it("is absent for a process on the plain clock, and for a change made before the version went live", () => {
    const v = live({ id: "v1", processKey: "new_lead_first_call", version: 1 });
    expect(buildImprovementLog({ ...base, versions: [v], officeHoursChanges: [change] }).some((x) => x.kind === "office_hours")).toBe(false);
    const late = live({ id: "v2", processKey: "new_lead_first_call", version: 2, approved_at: "2026-11-09T00:00:00Z" });
    expect(buildImprovementLog({ ...base, versions: [late], workingClockVersions: [late], officeHoursChanges: [change] }).some((x) => x.kind === "office_hours")).toBe(false);
  });
  it("a first save (no old value) reads 'now …'", () => {
    const v = live({ id: "v2", processKey: "new_lead_first_call", version: 2 });
    const log = buildImprovementLog({ ...base, versions: [v], workingClockVersions: [v], officeHoursChanges: [{ ...change, from: null }] });
    expect(log.find((x) => x.kind === "office_hours")!.meta).toBe("Sadin · now Sun–Fri, 9–6");
  });
});
