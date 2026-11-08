import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: vi.fn(async () => undefined) }));
const { loadCompareMock } = vi.hoisted(() => ({ loadCompareMock: vi.fn() }));
vi.mock("../compare", () => ({ loadCompare: loadCompareMock }));
const { assignmentMock } = vi.hoisted(() => ({ assignmentMock: vi.fn() }));
vi.mock("./assignment-state", () => ({ loadAssignmentState: assignmentMock }));

import { buildBaselineSpec } from "../../lib/baseline";
import { ADMIZZ_NEW_LEAD_RAW, ADMIZZ_SETUP } from "../../lib/fixtures";
import { AGED_EVENT, buildImproverTools, IMPROVER_EVENT, type ImproverToolsContext } from "./tools";
import { fakeWorld } from "./fake-db";
import { dismissProcessRead, isOldEnoughForRead, loadProcessRead } from "./read-store";

const KEY = "new_lead_first_call" as const;
const A = "tenant-a";
const B = "tenant-b";
const NOW = new Date("2026-11-08T14:15:00Z");
const spec = buildBaselineSpec(KEY, ADMIZZ_SETUP);
const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };

const WEEKDAY = {
  cut: "by_weekday",
  groups: [
    { key: "0", n: 71, called_1h: 21, called_1wh: 40, never: 3, contact_p50: 186, contact_p75: null, contact_p90: null, wait_p50: 100, wait_p75: null, wait_p90: null },
    { key: "6", n: 17, called_1h: 0, called_1wh: 0, never: 17, contact_p50: null, contact_p75: null, contact_p90: null, wait_p50: null, wait_p75: null, wait_p90: null },
  ],
};

const rows = (): Record<string, Array<Record<string, unknown>>> => ({
  processes: [
    { id: "pA", tenant_id: A, key: KEY, name: "New lead → first call", live_version_id: "vA2" },
    { id: "pB", tenant_id: B, key: KEY, name: "New lead → first call", live_version_id: "vB" },
    { id: "pAv", tenant_id: A, key: "visa_to_enrolled", name: "Visa → Enrolled", live_version_id: null },
  ],
  process_versions: [
    { id: "vA2", tenant_id: A, process_id: "pA", version: 2, status: "live", source: "person", spec, approved_at: "2026-10-20T00:00:00Z", change_summary: null },
    { id: "vB", tenant_id: B, process_id: "pB", version: 2, status: "live", source: "person", spec, approved_at: "2026-10-20T00:00:00Z", change_summary: null },
  ],
  lead_lists: [
    { id: "L-new", tenant_id: A, is_intake: true, is_archive: false },
    { id: "L-pre", tenant_id: A, is_intake: false, is_archive: false },
    { id: "L-b", tenant_id: B, is_intake: true, is_archive: false },
  ],
  positions: [
    { slug: "counselor", name: "Counselor", tenant_id: A },
    { slug: "lead-executive", name: "Lead Executive", tenant_id: A },
    { slug: "secret-b", name: "Tenant B only", tenant_id: B },
  ],
  tenants: [{ id: A, timezone: "Asia/Kathmandu" }, { id: B, timezone: "Asia/Kathmandu" }],
  process_changes: [],
  agent_outputs: [],
  process_metric_snapshots: [],
});

const rpcs = { education_process_metrics: ADMIZZ_NEW_LEAD_RAW, education_process_breakdown: WEEKDAY };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = async (tools: Record<string, any>, name: string, input: unknown = {}) => tools[name].execute(input, { toolCallId: "t", messages: [] });

function setup(subjectId: string | null, event = IMPROVER_EVENT, tenantId = A, extra: ReturnType<typeof rows> = {}) {
  const w = fakeWorld(tenantId, { ...rows(), ...extra }, rpcs);
  const ctx: ImproverToolsContext = { db: w.db, tenantId, runId: "run-1", agentId: "agent-1", subjectId, event, now: NOW, logger: logger as never };
  return { w, tools: buildImproverTools(ctx) as Record<string, unknown> };
}

const STATE = { mode: "off", shadowDecisions30d: 0, agreement: { matched: 0, total: 0, pct: null }, shadowDays: null, shadowRanLongEnough: false, capacity: { found: true, eligible: 2, poolSize: 3 } };
beforeEach(() => {
  vi.clearAllMocks();
  assignmentMock.mockResolvedValue(STATE);
});

describe("tenant isolation", () => {
  it("another tenant's process id finds nothing: no numbers, no rpc, no write", async () => {
    const { w, tools } = setup("pB"); // the run is tenant A's; pB belongs to tenant B
    for (const name of ["process_read", "process_breakdown"]) {
      const out = await call(tools, name, name === "process_breakdown" ? { cut: "by_weekday" } : {});
      expect(out).toEqual({ error: "This run has no process to look at." });
    }
    const draft = await call(tools, "propose_process_draft", { summary: "x", changes: [{ part: "step:first_contact", field: "target", after: { value: 50 }, why: "x", evidenceRefs: ["a"] }] });
    expect(draft).toEqual({ error: "This run has no process to look at." });
    expect(w.rpcs).toEqual([]);
    expect(w.inserts).toEqual([]);
  });
  it("a run with no subject reads nothing", async () => {
    const { w, tools } = setup(null);
    expect(await call(tools, "process_read")).toEqual({ error: "This run has no process to look at." });
    expect(w.rpcs).toEqual([]);
  });
  it("the RPC is called for the agent's own tenant only; the model has no way to name another (the schema takes a cut name and nothing else)", async () => {
    const { w, tools } = setup("pA");
    await call(tools, "process_read");
    await call(tools, "process_breakdown", { cut: "by_weekday" });
    expect(w.rpcs.map((r) => [r.name, r.args.p_tenant])).toEqual([
      ["education_process_metrics", A],
      ["education_process_breakdown", A], // process_read: the office split, read for Orca
      ["education_process_breakdown", A], // process_read: the weekday cut
      ["education_process_breakdown", A], // process_breakdown
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const schema = (tools.process_breakdown as any).inputSchema;
    expect(schema.safeParse({ cut: "by_weekday", p_tenant: B }).success).toBe(true); // extra keys are stripped, never read
    expect(schema.safeParse({ cut: "DROP TABLE leads" }).success).toBe(false);
  });
  it("only this tenant's positions are offered for a 'who' change", async () => {
    const { tools } = setup("pA");
    const out = await call(tools, "process_read");
    expect(out.positions.map((p: { slug: string }) => p.slug)).toEqual(["counselor", "lead-executive"]);
  });
});

describe("the tools hand the model counts and ids, never a link, a name or a message", () => {
  it("process_read: steps with display strings and fact ids; no hrefs anywhere", async () => {
    const { tools } = setup("pA");
    const out = await call(tools, "process_read");
    const first = out.steps.find((s: { part: string }) => s.part === "step:first_contact");
    expect(first.now.display).toBe("17% (22 of 131)");
    expect(first.now.linkable).toBe(true);
    expect(first.status).toBe("red");
    expect(out.onTarget).toBe(false);
    expect(out.openDraftExists).toBe(false);
    expect(JSON.stringify(out)).not.toMatch(/\/leads|href|phone|email/i);
  });
  it("process_breakdown: refuses a cut the process doesn't have, before the database", async () => {
    const { w, tools } = setup("pA");
    // visa process has no live version: refused with its own message; and a cut outside the process's menu is refused too
    expect((await call(setup("pAv").tools, "process_breakdown", { cut: "by_weekday" })).error).toMatch(/no live version/);
    const out = await call(tools, "process_breakdown", { cut: "intake_leftovers" });
    expect(out.cut).toBe("intake_leftovers"); // it IS on the new-lead menu
    expect(w.rpcs.filter((r) => r.name === "education_process_breakdown")).toHaveLength(1);
  });
  it("process_breakdown: a weekday result in the app's formats, with linkable facts and no links in the output", async () => {
    const { tools } = setup("pA");
    await call(tools, "process_read");
    const out = await call(tools, "process_breakdown", { cut: "by_weekday" });
    const sat = out.groups.find((g: { key: string }) => g.key === "6");
    expect(sat.label).toBe("Saturday");
    expect(sat.facts.size).toEqual({ id: "by_weekday.6.size", display: "17 of 131", linkable: true });
    expect(JSON.stringify(out)).not.toContain("/leads");
  });
});

describe("propose_process_draft, end to end through the tools", () => {
  const change = (over: Record<string, unknown> = {}) => ({
    summary: "Orca suggests a gentler first-call target.",
    changes: [
      {
        part: "step:first_contact",
        field: "target",
        after: { value: 50 },
        why: "Only 17% (22 of 131) were called within the hour, and 17 of 131 arrived on a Saturday.",
        evidenceRefs: ["step.first_contact.value", "by_weekday.6.size", "assign.state"],
        needs: null,
        turnsOn: "smart_assignment_shadow",
        ...over,
      },
    ],
  });
  it("writes one draft (source agent) and its change (author agent, evidence with links, badge) after read + breakdown", async () => {
    const { w, tools } = setup("pA");
    await call(tools, "process_read");
    await call(tools, "process_breakdown", { cut: "by_weekday" });
    const out = await call(tools, "propose_process_draft", change());
    expect(out.ok).toBe(true);
    const draft = w.rows.process_versions.find((v) => v.status === "draft")!;
    expect(draft).toMatchObject({ tenant_id: A, process_id: "pA", version: 3, source: "agent", proposed_by: null, change_summary: "Orca suggests a gentler first-call target." });
    const ch = w.rows.process_changes[0];
    expect(ch).toMatchObject({ tenant_id: A, version_id: draft.id, author_kind: "agent", author_user_id: null, turns_on: "smart_assignment_shadow", needs: null });
    expect((ch.evidence as Array<{ href: string | null }>).some((e) => typeof e.href === "string")).toBe(true);
  });
  it("drops a reason with a number no tool produced: no draft", async () => {
    const { w, tools } = setup("pA");
    await call(tools, "process_read");
    await call(tools, "process_breakdown", { cut: "by_weekday" });
    const out = await call(tools, "propose_process_draft", change({ why: "Only 41% were called within the hour." }));
    expect(out.ok).toBe(false);
    expect(out.dropped[0].reason).toMatch(/41%/);
    expect(w.rows.process_versions.some((v) => v.status === "draft")).toBe(false);
  });
  it("waits while a person's draft is open", async () => {
    const draft = { id: "vA3", tenant_id: A, process_id: "pA", version: 3, status: "draft", source: "person", spec, approved_at: null, change_summary: "x" };
    const base = rows();
    const { w, tools } = setup("pA", IMPROVER_EVENT, A, { process_versions: [...base.process_versions, draft] });
    await call(tools, "process_read");
    await call(tools, "process_breakdown", { cut: "by_weekday" });
    const out = await call(tools, "propose_process_draft", change());
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/already open/);
    expect(w.rows.process_versions.filter((v) => v.status === "draft")).toHaveLength(1);
    expect(w.rows.process_changes).toHaveLength(0);
  });
  it("a failure while writing is quiet: the model is told, nothing throws, nothing is half-written", async () => {
    const { w, tools } = setup("pA");
    await call(tools, "process_read");
    await call(tools, "process_breakdown", { cut: "by_weekday" });
    w.db.from = ((t: string) => {
      if (t === "process_changes") throw new Error("db down");
      return fakeWorld(A, w.rows).db.from(t);
    }) as never;
    const out = await call(tools, "propose_process_draft", change());
    expect(out).toMatchObject({ ok: false, message: "The draft could not be saved. Nothing was changed." });
  });
});

describe("Orca's read", () => {
  const compareResult = {
    kind: "ok",
    result: {
      process: { key: KEY, name: "x" },
      previous: { versionId: "vA1", version: 1, period: { from: "a", to: "b" } },
      current: { versionId: "vA2", version: 2, status: "live", approvedAt: "2026-10-20T00:00:00Z", approvedByName: "Manish", period: { from: "a", to: "b" }, daysLive: 19 },
      measures: [{ metric: "first_contact_1h_pct", label: "Called within 1 hour", unit: "percent", better: "up", before: 17, after: 30, change: 13, ready: true, minDays: 7, waitText: "" }],
      changes: [],
    },
  };
  beforeEach(() => loadCompareMock.mockResolvedValue(compareResult));

  it("only the read tools are offered on the aged trigger; the draft tools on the weekly one", () => {
    expect(Object.keys(setup("pA", AGED_EVENT).tools).sort()).toEqual(["process_compare", "record_process_read"]);
    expect(Object.keys(setup("pA", IMPROVER_EVENT).tools).sort()).toEqual(["process_breakdown", "process_read", "propose_process_draft"]);
  });
  it("a true summary is stored as written, keyed by the VERSION id; a made-up number falls back to a line built from the compare numbers", async () => {
    const ok = setup("pA", AGED_EVENT);
    await call(ok.tools, "process_compare");
    await call(ok.tools, "record_process_read", { summary: "Called within 1 hour went from 17% to 30%, a 13 point gain." });
    expect(ok.w.rows.agent_outputs[0]).toMatchObject({ kind: "process_read", subject_type: "process_version", subject_id: "vA2", status: "proposed" });
    expect((ok.w.rows.agent_outputs[0].payload as { usedFallback: boolean; summary: string }).usedFallback).toBe(false);

    const bad = setup("pA", AGED_EVENT);
    await call(bad.tools, "process_compare");
    await call(bad.tools, "record_process_read", { summary: "Called within 1 hour went from 17% to 35%." });
    const p = bad.w.rows.agent_outputs[0].payload as { usedFallback: boolean; summary: string };
    expect(p.usedFallback).toBe(true);
    expect(p.summary).toBe("Version 2, 19 days in: Called within 1 hour +13 points.");
  });
  it("refuses to write a read for a version live under 7 days, even if asked", async () => {
    const young = rows();
    young.process_versions[0].approved_at = "2026-11-03T00:00:00Z"; // 5 days before NOW
    const { w, tools } = setup("pA", AGED_EVENT, A, { process_versions: young.process_versions });
    await call(tools, "process_compare");
    const out = await call(tools, "record_process_read", { summary: "It is going well." });
    expect(out.ok).toBe(false);
    expect(w.rows.agent_outputs).toHaveLength(0);
  });
  it("the compare facts are formatted like the page: percent as points, time as a share", async () => {
    const { tools } = setup("pA", AGED_EVENT);
    const out = await call(tools, "process_compare");
    expect(out.measures[0]).toMatchObject({ before: { display: "17%" }, after: { display: "30%" }, change: { display: "+13 points" } });
    expect(out.daysLive.display).toBe("19 days");
  });
});

describe("storing, loading and dismissing a read", () => {
  it("a read is only for a version live 7+ days", () => {
    expect(isOldEnoughForRead("2026-11-01T00:00:00Z", NOW)).toBe(true);
    expect(isOldEnoughForRead("2026-11-02T00:00:00Z", NOW)).toBe(false); // 6 days
    expect(isOldEnoughForRead(null, NOW)).toBe(false);
  });
  it("dismiss hides it (once), and another tenant's read can't be dismissed", async () => {
    const base = rows();
    const out = [
      { id: "o1", tenant_id: A, kind: "process_read", subject_type: "process_version", subject_id: "vA2", status: "proposed", payload: { summary: "s", version: 2, processId: "pA", usedFallback: false, generatedAt: "t" }, created_at: "1" },
      { id: "o2", tenant_id: B, kind: "process_read", subject_type: "process_version", subject_id: "vB", status: "proposed", payload: { summary: "s", version: 2, processId: "pB", usedFallback: false, generatedAt: "t" }, created_at: "1" },
    ];
    const w = fakeWorld(A, { ...base, agent_outputs: out });
    expect((await loadProcessRead(w.db, "vA2"))?.status).toBe("proposed");
    expect(await loadProcessRead(w.db, "vB")).toBeNull();
    expect(await dismissProcessRead(w.db, "vB", "u1", NOW)).toBe(false);
    expect(out[1].status).toBe("proposed");
    expect(await dismissProcessRead(w.db, "vA2", "u1", NOW)).toBe(true);
    expect(out[0].status).toBe("dismissed");
    expect(await dismissProcessRead(w.db, "vA2", "u1", NOW)).toBe(false);
  });
});

describe("round 2: smart assignment's real state, every red step decided", () => {
  const prop = (over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
    summary: "Orca suggests a gentler first-call target.",
    changes: [{ part: "step:first_contact", field: "target", after: { value: 50 }, why: "Only 17% (22 of 131) were called within the hour.", evidenceRefs: ["step.first_contact.value", "assign.state"], turnsOn: null, ...over }],
    ...extra,
  });
  const ready = async (tools: Record<string, unknown>) => {
    await call(tools, "process_read");
  };

  it("process_read carries the office split, the weekday cut and smart assignment's real state, so they can't be skipped", async () => {
    const { tools } = setup("pA");
    const out = await call(tools, "process_read");
    expect(Object.keys(out.alreadyRead).sort()).toEqual(["by_weekday", "office_split"]);
    expect(out.smartAssignment.state).toEqual({ id: "assign.state", display: "Smart assignment is off", linkable: false });
    expect(out.smartAssignment.shadow_decisions.display).toBe("0");
    expect(out.smartAssignment.shadow_days.display).toBe("never ran in shadow");
    expect(out.smartAssignment.autoAllowed).toBe(false);
  });
  it("with no capacity today the read says so, and any turn-on change is refused", async () => {
    assignmentMock.mockResolvedValue({ ...STATE, capacity: { found: false, eligible: 0, poolSize: 3 } });
    const { w, tools } = setup("pA");
    const out = await call(tools, "process_read");
    expect(out.smartAssignment.note).toMatch(/assign no one/);
    const res = await call(tools, "propose_process_draft", prop({ turnsOn: "smart_assignment_shadow" }));
    expect(res.ok).toBe(false);
    expect(res.dropped[0].reason).toMatch(/no room|Nobody has room/i);
    expect(w.rows.process_versions.some((v) => v.status === "draft")).toBe(false);
  });
  it("auto is refused until shadow has run 14+ days; shadow first is allowed; a turn-on must cite the state fact", async () => {
    const a = setup("pA");
    await ready(a.tools);
    expect((await call(a.tools, "propose_process_draft", prop({ turnsOn: "smart_assignment_auto" }))).dropped[0].reason).toMatch(/shadow mode to have run for at least 14 days/);
    const b = setup("pA");
    await ready(b.tools);
    expect((await call(b.tools, "propose_process_draft", prop({ turnsOn: "smart_assignment_shadow", evidenceRefs: ["step.first_contact.value"] }))).dropped[0].reason).toMatch(/must cite the smart assignment state/);
    const c = setup("pA");
    await ready(c.tools);
    expect((await call(c.tools, "propose_process_draft", prop({ turnsOn: "smart_assignment_shadow" }))).ok).toBe(true);
    assignmentMock.mockResolvedValue({ ...STATE, mode: "shadow", shadowDecisions30d: 40, shadowDays: 20, shadowRanLongEnough: true, agreement: { matched: 34, total: 40, pct: 85 } });
    const d = setup("pA");
    await ready(d.tools);
    expect((await call(d.tools, "propose_process_draft", prop({ turnsOn: "smart_assignment_auto" }))).ok).toBe(true);
  });
  it("skipped red steps are stored on the draft's evidence, with unknown steps and made-up numbers left out", async () => {
    const { w, tools } = setup("pA");
    await ready(tools);
    const res = await call(
      tools,
      "propose_process_draft",
      prop({}, { skipped: [{ step: "call_back", reason: "Call-backs depend on the counsellors' own rota." }, { step: "ghost", reason: "n/a" }, { step: "decide", reason: "Only 99% were decided." }] }),
    );
    expect(res.ok).toBe(true);
    const draft = w.rows.process_versions.find((v) => v.status === "draft")!;
    expect((draft.evidence as { skipped: unknown }).skipped).toEqual([{ step: "call_back", reason: "Call-backs depend on the counsellors' own rota." }]);
  });
});
