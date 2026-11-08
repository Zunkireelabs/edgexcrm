import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: vi.fn(async () => undefined) }));
vi.mock("../compare", () => ({ loadCompare: vi.fn() }));
vi.mock("@/lib/ai/agents/packs", () => ({}));
const { buildAgentAuthContextMock, runAgentMock, getAgentDefinitionMock, scopedMock, serviceMock } = vi.hoisted(() => ({
  buildAgentAuthContextMock: vi.fn(),
  runAgentMock: vi.fn(),
  getAgentDefinitionMock: vi.fn(),
  scopedMock: vi.fn(),
  serviceMock: vi.fn(),
}));
vi.mock("@/lib/ai/agent-auth", () => ({ buildAgentAuthContext: buildAgentAuthContextMock }));
vi.mock("@/lib/ai/agents/runtime", () => ({ runAgent: runAgentMock }));
vi.mock("@/lib/ai/agents/registry", () => ({ getAgentDefinition: getAgentDefinitionMock }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClientForTenant: scopedMock }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: serviceMock }));

import { buildBaselineSpec } from "../../lib/baseline";
import { ADMIZZ_NEW_LEAD_RAW, ADMIZZ_SETUP } from "../../lib/fixtures";
import { fakeWorld } from "./fake-db";
import { ensureImproverIdentity, IMPROVER_KEY, isWeeklyHour, listImproverTenants, planReadRuns, planWeeklyRuns, runImprover } from "./run";
import { AGED_EVENT, IMPROVER_EVENT } from "./tools";

const KEY = "new_lead_first_call" as const;
const A = "tenant-a";
const NOW = new Date("2026-11-07T14:15:00Z"); // Sat 7 Nov, 20:00 in Kathmandu (UTC+5:45)
const SPEC = buildBaselineSpec(KEY, ADMIZZ_SETUP);
// A spec with ONE step whose target the Admizz numbers already meet (17% >= 10%): the process is on target.
const ONTARGET_SPEC = { ...SPEC, steps: SPEC.steps.filter((s) => s.key === "first_contact").map((s) => ({ ...s, target: { ...s.target, value: 10 } })) };

const proc = (id: string, live: string | null, key = KEY) => ({ id, tenant_id: A, key, name: id, live_version_id: live });
const ver = (id: string, processId: string, version: number, status: string, approved_at: string | null, spec: unknown = SPEC) => ({ id, tenant_id: A, process_id: processId, version, status, source: "person", spec, approved_at, change_summary: null });
const base = (extra: Record<string, unknown[]> = {}) => ({
  processes: [],
  process_versions: [],
  lead_lists: [{ id: "L-new", tenant_id: A, is_intake: true, is_archive: false }],
  positions: [],
  tenants: [{ id: A, timezone: "Asia/Kathmandu" }],
  agent_runs: [],
  agent_outputs: [],
  agent_identities: [],
  process_metric_snapshots: [],
  ...extra,
});
const rpcs = { education_process_metrics: ADMIZZ_NEW_LEAD_RAW };

beforeEach(() => vi.clearAllMocks());

describe("Saturday 20:00, tenant time", () => {
  it("true only inside that hour, in the tenant's own timezone", () => {
    expect(isWeeklyHour(new Date("2026-11-07T14:15:00Z"), "Asia/Kathmandu")).toBe(true); // 20:00
    expect(isWeeklyHour(new Date("2026-11-07T15:00:00Z"), "Asia/Kathmandu")).toBe(true); // 20:45
    expect(isWeeklyHour(new Date("2026-11-07T15:15:00Z"), "Asia/Kathmandu")).toBe(false); // 21:00
    expect(isWeeklyHour(new Date("2026-11-07T13:59:00Z"), "Asia/Kathmandu")).toBe(false); // 19:44
    expect(isWeeklyHour(new Date("2026-11-08T14:15:00Z"), "Asia/Kathmandu")).toBe(false); // Sunday 20:00
  });
  it("a foreign timezone gets its own Saturday 20:00 (New York is on UTC-5 in November: Sat 20:00 = Sun 01:00Z)", () => {
    expect(isWeeklyHour(new Date("2026-11-08T01:30:00Z"), "America/New_York")).toBe(true);
    expect(isWeeklyHour(new Date("2026-11-07T14:15:00Z"), "America/New_York")).toBe(false); // Sat 09:15 there
  });
});

describe("tenants", () => {
  it("education tenants with the AI grant, by the service client; an error fails closed (the step retries)", async () => {
    const calls: Array<[string, unknown]> = [];
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => (calls.push([c, v]), q),
      then: (res: (v: unknown) => unknown) => res({ data: [{ id: A, timezone: null }], error: null }),
    };
    serviceMock.mockResolvedValue({ from: () => q });
    expect(await listImproverTenants()).toEqual([{ tenantId: A, tz: "Asia/Kathmandu" }]);
    expect(calls).toEqual([["industry_id", "education_consultancy"], ["ai_enabled", true]]);
    serviceMock.mockResolvedValue({ from: () => ({ select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: null, error: new Error("down") }) }) }) }) });
    await expect(listImproverTenants()).rejects.toThrow("down");
  });
});

describe("Orca's identity: on by default, and the Fleet off-switch still works", () => {
  it("created on the first run (active, no position: the most restrictive profile); reused afterwards", async () => {
    const w = fakeWorld(A, base());
    scopedMock.mockResolvedValue(w.db);
    const id = await ensureImproverIdentity(A);
    expect(id).toBeTruthy();
    expect(w.rows.agent_identities).toHaveLength(1);
    expect(w.rows.agent_identities[0]).toMatchObject({ tenant_id: A, agent_key: IMPROVER_KEY, display_name: "Orca", status: "active" });
    expect(w.rows.agent_identities[0].position_id).toBeUndefined();
    expect(await ensureImproverIdentity(A)).toBe(id);
    expect(w.rows.agent_identities).toHaveLength(1);
  });
  it("a paused identity means no run at all", async () => {
    const w = fakeWorld(A, base({ agent_identities: [{ id: "ai-1", tenant_id: A, agent_key: IMPROVER_KEY, status: "paused" }] }));
    scopedMock.mockResolvedValue(w.db);
    expect(await ensureImproverIdentity(A)).toBeNull();
  });
});

describe("the weekly plan", () => {
  const plan = (rows: ReturnType<typeof base>) => planWeeklyRuns(fakeWorld(A, rows, rpcs).db, A, "ai-1", NOW);

  it("plans a live process that is off target and has no open draft", async () => {
    const out = await plan(base({ processes: [proc("p1", "v2")], process_versions: [ver("v2", "p1", 2, "live", "2026-10-20T00:00:00Z")] }));
    expect(out).toEqual([{ processId: "p1", key: KEY }]);
  });
  it("waits while ANY draft is open (a person's or Orca's)", async () => {
    const out = await plan(base({ processes: [proc("p1", "v2")], process_versions: [ver("v2", "p1", 2, "live", "2026-10-20T00:00:00Z"), ver("v3", "p1", 3, "draft", null)] }));
    expect(out).toEqual([]);
  });
  it("an on-target process gets no run (nothing to improve, no model cost)", async () => {
    const out = await plan(base({ processes: [proc("p1", "v2")], process_versions: [ver("v2", "p1", 2, "live", "2026-10-20T00:00:00Z", ONTARGET_SPEC)] }));
    expect(out).toEqual([]);
  });
  it("no live version, or already run this week: no run", async () => {
    expect(await plan(base({ processes: [proc("p1", null)] }))).toEqual([]);
    const recent = { id: "r1", tenant_id: A, agent_id: "ai-1", trigger_event: IMPROVER_EVENT, subject_id: "p1", started_at: new Date(NOW.getTime() - 2 * 86_400_000).toISOString() };
    const out = await plan(base({ processes: [proc("p1", "v2")], process_versions: [ver("v2", "p1", 2, "live", "2026-10-20T00:00:00Z")], agent_runs: [recent] }));
    expect(out).toEqual([]);
  });
  it("another tenant's processes are never planned", async () => {
    const other = { ...proc("pX", "vX"), tenant_id: "tenant-x" };
    expect(await plan(base({ processes: [other] }))).toEqual([]);
  });
});

describe("the read plan: only versions live 7+ days, once", () => {
  const plan = (rows: ReturnType<typeof base>) => planReadRuns(fakeWorld(A, rows).db, "ai-1", NOW);
  const withVersion = (version: number, approvedAt: string | null, extra: Record<string, unknown[]> = {}) =>
    base({ processes: [proc("p1", "v")], process_versions: [ver("v", "p1", version, "live", approvedAt)], ...extra });

  it("v2 live for 8 days: planned", async () => {
    expect(await plan(withVersion(2, "2026-10-30T00:00:00Z"))).toEqual([{ processId: "p1", versionId: "v" }]);
  });
  it("under 7 days: no read, so nothing is claimed early", async () => {
    expect(await plan(withVersion(2, "2026-11-02T00:00:00Z"))).toEqual([]); // 5 days
    expect(await plan(withVersion(2, "2026-10-31T14:16:00Z"))).toEqual([]); // 1 minute short of 7 days
    expect(await plan(withVersion(2, "2026-10-31T14:15:00Z"))).toEqual([{ processId: "p1", versionId: "v" }]); // exactly 7 days
  });
  it("the baseline (v1) has no before to read; a version already read is not read again; one tried today waits for tomorrow", async () => {
    expect(await plan(withVersion(1, "2026-10-01T00:00:00Z"))).toEqual([]);
    expect(await plan(withVersion(2, "2026-10-30T00:00:00Z", { agent_outputs: [{ id: "o", tenant_id: A, kind: "process_read", subject_type: "process_version", subject_id: "v" }] }))).toEqual([]);
    const today = { id: "r", tenant_id: A, agent_id: "ai-1", trigger_event: AGED_EVENT, subject_id: "p1", started_at: new Date(NOW.getTime() - 3600_000).toISOString() };
    expect(await plan(withVersion(2, "2026-10-30T00:00:00Z", { agent_runs: [today] }))).toEqual([]);
  });
});

describe("a run is quiet when anything goes wrong", () => {
  it("a thrown error is a log line and a skipped result, never an exception", async () => {
    getAgentDefinitionMock.mockReturnValue({ key: IMPROVER_KEY });
    buildAgentAuthContextMock.mockRejectedValue(new Error("db down"));
    expect(await runImprover(A, "ai-1", IMPROVER_EVENT, "p1")).toEqual({ status: "skipped", reason: "run failed" });
    expect(runAgentMock).not.toHaveBeenCalled();
  });
  it("runs the definition as the agent, on the process, with the right event", async () => {
    getAgentDefinitionMock.mockReturnValue({ key: IMPROVER_KEY });
    buildAgentAuthContextMock.mockResolvedValue({ tenantId: A });
    runAgentMock.mockResolvedValue({ status: "completed", runId: "r1" });
    expect(await runImprover(A, "ai-1", IMPROVER_EVENT, "p1")).toEqual({ status: "completed", runId: "r1" });
    expect(runAgentMock).toHaveBeenCalledWith({ key: IMPROVER_KEY }, { tenantId: A }, { event: IMPROVER_EVENT, subjectType: "process", subjectId: "p1" });
  });
  it("a missing definition or a vanished identity is a skip", async () => {
    getAgentDefinitionMock.mockReturnValue(undefined);
    expect((await runImprover(A, "ai-1", IMPROVER_EVENT, "p1")).status).toBe("skipped");
    getAgentDefinitionMock.mockReturnValue({ key: IMPROVER_KEY });
    buildAgentAuthContextMock.mockResolvedValue(null);
    expect((await runImprover(A, "ai-1", IMPROVER_EVENT, "p1")).status).toBe("skipped");
  });
});
