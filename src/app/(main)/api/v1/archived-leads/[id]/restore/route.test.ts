import { describe, it, expect, vi, beforeEach } from "vitest";
import { PERMISSION_DENIED_MESSAGE } from "@/lib/permission-denied";

// POST /api/v1/archived-leads/[id]/restore — sends an archived lead back to the pipeline. Everything is faked (no DB); the
// fake records the exact UPDATE so the data written can be asserted.

type Op = [string, unknown[]];
const state = vi.hoisted(() => ({
  auth: null as Record<string, unknown> | null,
  lead: null as Record<string, unknown> | null,
  lists: [] as Array<Record<string, unknown>>,
  stages: [] as Array<Record<string, unknown>>,
  updateRows: [{ id: "x" }] as Array<{ id: string }> | null,
  updateError: null as unknown,
  calls: [] as Array<{ table: string; ops: Op[] }>,
  audit: vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => undefined),
  emit: vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => undefined),
}));

function chain(table: string) {
  const rec = { table, ops: [] as Op[] };
  state.calls.push(rec);
  const has = (n: string) => rec.ops.some(([o]) => o === n);
  const proxy: object = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === "then") {
        return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
          let result: unknown;
          if (table === "leads" && has("update")) result = { data: state.updateRows, error: state.updateError };
          else if (table === "leads") result = { data: state.lead, error: null };
          else if (table === "lead_lists") result = { data: state.lists, error: null };
          else result = { data: state.stages, error: null };
          return Promise.resolve(result).then(resolve, reject);
        };
      }
      return (...args: unknown[]) => { rec.ops.push([prop, args]); return proxy; };
    },
  });
  return proxy;
}

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: vi.fn(async () => state.auth),
  getClientIp: () => "127.0.0.1",
}));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: (industry: string | null) => industry === "education_consultancy" }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: vi.fn(async () => ({ from: (t: string) => chain(t) })) }));
vi.mock("@/lib/api/audit", () => ({
  createAuditLog: (input: Record<string, unknown>) => state.audit(input),
  emitEvent: (input: Record<string, unknown>) => state.emit(input),
}));
vi.mock("@/lib/logger", () => ({ createRequestLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) }));

import { POST } from "./route";

const ID = "7d318d22-1621-41ca-9ba7-c9520d2d4154";
const call = (id = ID) =>
  POST(new Request(`http://localhost/api/v1/archived-leads/${id}/restore`, { method: "POST" }) as unknown as Parameters<typeof POST>[0], {
    params: Promise.resolve({ id }),
  });
const error = async (res: Response) => (await res.json()).error as { code: string; message: string };
const leadUpdate = () => state.calls.find((c) => c.table === "leads" && c.ops.some(([o]) => o === "update"))!;
const payload = () => leadUpdate().ops.find(([o]) => o === "update")![1][0] as Record<string, unknown>;

const LISTS = [
  { id: "pre", name: "Pre-qualified", slug: "pre-qualified", is_archive: false, is_intake: true, is_staging: false, pipeline_id: "p-pre", sort_order: 1 },
  { id: "qual", name: "Qualified", slug: "qualified", is_archive: false, is_intake: false, is_staging: false, pipeline_id: "p-qual", sort_order: 2 },
  { id: "arch", name: "Archived", slug: "archived", is_archive: true, is_intake: false, is_staging: false, pipeline_id: null, sort_order: 4 },
];
const STAGES = [
  { id: "s-new", slug: "new", pipeline_id: "p-qual", position: 1, is_default: true },
  { id: "s-contacted", slug: "contacted", pipeline_id: "p-qual", position: 2, is_default: false },
  { id: "s-pre-new", slug: "new", pipeline_id: "p-pre", position: 1, is_default: true },
];

beforeEach(() => {
  state.auth = {
    userId: "u-me", email: "c@x.com", tenantId: "t-1", role: "staff", industryId: "education_consultancy",
    branchId: null, branchMemberIds: [], permissions: { baseTier: "member", leadScope: "own", canEditLeads: true },
  };
  state.lead = { id: ID, list_id: "arch", archived_from_list_id: "qual", archived_from_status: "contacted" };
  state.lists = LISTS;
  state.stages = STAGES;
  state.updateRows = [{ id: ID }];
  state.updateError = null;
  state.calls = [];
  state.audit.mockClear();
  state.emit.mockClear();
});

describe("POST /archived-leads/[id]/restore — who may", () => {
  it("401s when unauthenticated", async () => {
    state.auth = null;
    expect((await call()).status).toBe(401);
  });
  it("403s outside the education industry", async () => {
    (state.auth as Record<string, unknown>).industryId = "it_agency";
    expect((await call()).status).toBe(403);
  });
  it("403s a view-only user with the standard no-permission message", async () => {
    (state.auth as Record<string, unknown>).permissions = { baseTier: "member", leadScope: "own", canEditLeads: false };
    const res = await call();
    expect(res.status).toBe(403);
    expect((await error(res)).message).toBe(PERMISSION_DENIED_MESSAGE);
    expect(state.calls.some((c) => c.ops.some(([o]) => o === "update"))).toBe(false);
  });
  it("lets an own-scope counselor restore a lead that is NOT theirs (the client's request)", async () => {
    state.lead = { ...state.lead, assigned_to: "someone-else" };
    expect((await call()).status).toBe(200);
  });
  it("rejects a malformed id", async () => {
    expect((await call("not-a-uuid")).status).toBe(422);
  });
});

describe("POST /archived-leads/[id]/restore — guards", () => {
  it("404s when the lead does not exist (or is deleted / converted)", async () => {
    state.lead = null;
    expect((await call()).status).toBe(404);
  });
  it("409s when the lead is not in Archive", async () => {
    state.lead = { ...state.lead, list_id: "qual" };
    const res = await call();
    expect(res.status).toBe(409);
    expect((await error(res)).message).toMatch(/not in Archive/);
    expect(state.calls.some((c) => c.ops.some(([o]) => o === "update"))).toBe(false);
  });
  it("422s when the tenant has no stage to restore to", async () => {
    state.lists = LISTS.filter((l) => l.is_archive);
    const res = await call();
    expect(res.status).toBe(422);
    expect((await error(res)).code).toBe("NO_RESTORE_TARGET");
  });
  it("409s (and logs nothing) when someone else restored it a moment earlier — the update matched no row", async () => {
    state.updateRows = [];
    const res = await call();
    expect(res.status).toBe(409);
    expect(state.audit).not.toHaveBeenCalled();
    expect(state.emit).not.toHaveBeenCalled();
  });
  it("503s when the update fails", async () => {
    state.updateError = { message: "boom" };
    state.updateRows = null;
    expect((await call()).status).toBe(503);
  });
});

describe("POST /archived-leads/[id]/restore — what it writes", () => {
  it("moves the lead back to the stage and status it was archived from, and clears every archive mark", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(payload()).toMatchObject({
      list_id: "qual", pipeline_id: "p-qual", stage_id: "s-contacted", status: "contacted", lead_type: "lead",
      archived_by: null, archived_at: null, archived_from_list_id: null, archived_from_status: null,
    });
    expect(payload().stage_changed_at).toBeTruthy();
    expect(payload().last_activity_at).toBeTruthy();
  });

  it("does NOT change the assigned counselor (or branch)", async () => {
    await call();
    expect(Object.keys(payload())).not.toContain("assigned_to");
    expect(Object.keys(payload())).not.toContain("branch_id");
  });

  it("only updates the row while it is STILL in the archive stage that was read (the race guard), for this one lead", async () => {
    await call();
    const eqs = leadUpdate().ops.filter(([o]) => o === "eq").map(([, a]) => a);
    expect(eqs).toContainEqual(["id", ID]);
    expect(eqs).toContainEqual(["list_id", "arch"]);
  });

  it("falls back to the first intake stage when the original stage is gone, and says so", async () => {
    state.lead = { ...state.lead, archived_from_list_id: "deleted-list" };
    const res = await call();
    expect(payload()).toMatchObject({ list_id: "pre", stage_id: "s-pre-new" });
    expect((await res.json()).data).toMatchObject({ list_name: "Pre-qualified", used_fallback: true });
  });

  it("returns what the screen needs for its message", async () => {
    const body = (await (await call()).json()).data;
    expect(body).toMatchObject({ id: ID, list_name: "Qualified", status: "contacted", used_fallback: false });
  });

  it("records the move in the audit log (it shows in the lead's System Activity) and emits the list-changed event", async () => {
    await call();
    expect(state.audit).toHaveBeenCalledTimes(1);
    expect(state.audit.mock.calls[0][0]).toMatchObject({
      tenantId: "t-1", userId: "u-me", action: "lead.updated", entityType: "lead", entityId: ID,
      changes: { list: { old: "Archived", new: "Qualified" }, restored_from_archive: { old: false, new: true } },
    });
    expect(state.emit).toHaveBeenCalledTimes(1);
    expect(state.emit.mock.calls[0][0]).toMatchObject({
      tenantId: "t-1", type: "lead.list_changed", entityId: ID,
      payload: { old_list_id: "arch", new_list_id: "qual", restored_from_archive: true },
    });
  });
});
