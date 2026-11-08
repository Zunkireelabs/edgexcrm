import { describe, it, expect, vi, beforeEach } from "vitest";

const warn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/logger", () => ({ logger: { warn, error: vi.fn(), info: vi.fn() } }));

import { buildBaselineSpec, HOME_RULES } from "../lib/baseline";
import { ADMIZZ_SETUP } from "../lib/fixtures";
import { DEFAULT_OFFICE_HOURS } from "../lib/working-hours";
import { loadProcessPolicy } from "./policy";

type Result = { data: unknown; error: unknown };
const SPEC = () => buildBaselineSpec("new_lead_first_call", ADMIZZ_SETUP);
const OH_JSON = { days: [0, 1, 2, 3, 4, 5], start_min: 540, end_min: 1080, source: "saved" };

function fakeDb(o: { processes?: Result; versions?: Result; rpc?: Result | (() => never); throwOn?: "processes" }) {
  const chain = (r: Result) => {
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.eq = () => c;
    c.maybeSingle = async () => r;
    return c;
  };
  return {
    from: (t: string) => {
      if (t === "processes" && o.throwOn === "processes") throw new Error("boom");
      return t === "processes" ? chain(o.processes ?? { data: null, error: null }) : chain(o.versions ?? { data: null, error: null });
    },
    raw: () => ({
      rpc: async () => (typeof o.rpc === "function" ? o.rpc() : (o.rpc ?? { data: OH_JSON, error: null })),
      auth: { admin: { getUserById: async () => ({ data: { user: { user_metadata: { name: "Manish Sah" }, email: "m@x.org" } } }) } },
    }),
  } as unknown as Parameters<typeof loadProcessPolicy>[0];
}
const LIVE = { processes: { data: { owner_user_id: "u1", live_version_id: "v1" }, error: null } };

beforeEach(() => warn.mockClear());

describe("loadProcessPolicy", () => {
  it("v1 live -> 60/clock, with the source filled in", async () => {
    const db = fakeDb({ ...LIVE, versions: { data: { version: 1, spec: SPEC(), approved_at: "2026-11-01T00:00:00Z", approved_by: "u1" }, error: null } });
    const p = await loadProcessPolicy(db, "t-v1");
    expect(p.firstContact).toEqual({ minutes: 60, clock: "clock" });
    expect(p.source).toEqual({ processKey: "new_lead_first_call", version: 1, approvedAt: "2026-11-01T00:00:00Z", ownerName: "Manish Sah", approvedByName: "Manish Sah" });
    expect(p.officeHours.days).toEqual([0, 1, 2, 3, 4, 5]);
    expect(warn).not.toHaveBeenCalled();
  });
  it("v2 live -> 60/working, and the rules block wins", async () => {
    const spec = SPEC();
    spec.steps.find((s) => s.key === "first_contact")!.target = { metric: "first_contact_1wh_pct", op: ">=", value: 75, unit: "percent" };
    const db = fakeDb({ ...LIVE, versions: { data: { version: 2, spec: { ...spec, rules: { unreachableAfterCalls: 4, decideWithinDays: 10 } }, approved_at: "x" }, error: null } });
    const p = await loadProcessPolicy(db, "t-v2");
    expect(p.firstContact).toEqual({ minutes: 60, clock: "working" });
    expect([p.unreachableAfterCalls, p.decideWithinDays]).toEqual([4, 10]);
  });
  it("no live version -> today's values, source null, one warning, no throw", async () => {
    const p = await loadProcessPolicy(fakeDb({ processes: { data: { owner_user_id: null, live_version_id: null }, error: null } }), "t-none");
    expect(p.source).toBeNull();
    expect(p.firstTouchPositions).toBeNull();
    expect([p.unreachableAfterCalls, p.decideWithinDays, p.assignWithinMin]).toEqual([HOME_RULES.unreachableAfterCalls, HOME_RULES.decideWithinDays, HOME_RULES.assignWithinMinutes]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it("a process row that does not exist at all -> defaults", async () => {
    expect((await loadProcessPolicy(fakeDb({}), "t-missing")).source).toBeNull();
  });
  it("an unreadable spec -> defaults + warning", async () => {
    const p = await loadProcessPolicy(fakeDb({ ...LIVE, versions: { data: { version: 3, spec: { nope: true }, approved_at: null }, error: null } }), "t-bad-spec");
    expect(p.source).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it("a DB error on the version read -> defaults, no throw", async () => {
    const p = await loadProcessPolicy(fakeDb({ ...LIVE, versions: { data: null, error: { message: "PGRST301" } } }), "t-dberr");
    expect(p.source).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it("a thrown error from the client -> defaults, no throw", async () => {
    const p = await loadProcessPolicy(fakeDb({ throwOn: "processes" }), "t-throw");
    expect(p.source).toBeNull();
  });
  it("an office-hours RPC error -> every day 9-18, still no throw (the process itself can still be live)", async () => {
    const db = fakeDb({ ...LIVE, versions: { data: { version: 1, spec: SPEC(), approved_at: "x" }, error: null }, rpc: { data: null, error: { message: "function does not exist" } } });
    const p = await loadProcessPolicy(db, "t-rpc");
    expect(p.officeHours).toBe(DEFAULT_OFFICE_HOURS);
    expect(p.source?.version).toBe(1);
  });
  it("an office-hours RPC that throws is also contained", async () => {
    const db = fakeDb({ rpc: () => { throw new Error("network"); } });
    expect((await loadProcessPolicy(db, "t-rpc-throw")).officeHours).toBe(DEFAULT_OFFICE_HOURS);
  });
});
