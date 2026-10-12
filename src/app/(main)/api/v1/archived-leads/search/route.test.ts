import { describe, it, expect, vi, beforeEach } from "vitest";

// GET /api/v1/archived-leads/search — finds leads in an Archive stage for Global Search. Everything is faked (no DB); the
// fake RECORDS every query call so the filters can be asserted.

type Op = [string, unknown[]];
const state = vi.hoisted(() => ({
  auth: null as Record<string, unknown> | null,
  rows: [] as Array<Record<string, unknown>>,
  error: null as unknown,
  origins: [] as Array<{ id: string; name: string }>,
  team: [] as Array<{ user_id: string; name: string }>,
  calls: [] as Array<{ table: string; ops: Op[] }>,
}));

function chain(table: string) {
  const rec = { table, ops: [] as Op[] };
  state.calls.push(rec);
  const proxy: object = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === "then") {
        return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
          const result = table === "lead_lists" ? { data: state.origins, error: null } : { data: state.rows, error: state.error };
          return Promise.resolve(result).then(resolve, reject);
        };
      }
      return (...args: unknown[]) => { rec.ops.push([prop, args]); return proxy; };
    },
  });
  return proxy;
}

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: vi.fn(async () => state.auth) }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: (industry: string | null) => industry === "education_consultancy" }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: vi.fn(async () => ({ from: (t: string) => chain(t) })) }));
vi.mock("@/lib/supabase/queries", () => ({ getTeamMembers: vi.fn(async () => state.team) }));
vi.mock("@/lib/logger", () => ({ createRequestLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) }));

import { GET } from "./route";

const req = (q?: string) =>
  ({ nextUrl: new URL(`http://localhost/api/v1/archived-leads/search${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`) }) as unknown as Parameters<typeof GET>[0];

const leadRow = (over: Record<string, unknown> = {}) => ({
  id: "lead-1", first_name: "Abdul", last_name: "Rahim", email: "abdul@example.com", phone: "+977-9800000000",
  created_at: "2026-10-01T00:00:00Z", assigned_to: "u-other", archive_reason: "No response", archived_at: "2026-10-05T00:00:00Z",
  archived_from_list_id: "list-qual", ...over,
});
const asCounselor = (over: Record<string, unknown> = {}) => ({
  userId: "u-me", email: "c@x.com", tenantId: "t-1", role: "staff", industryId: "education_consultancy",
  branchId: null, branchMemberIds: [],
  permissions: { baseTier: "member", leadScope: "own", canEditLeads: true },
  ...over,
});
const leadQuery = () => state.calls.find((c) => c.table === "leads")!;
const ops = (name: string) => leadQuery().ops.filter(([n]) => n === name);

beforeEach(() => {
  state.auth = asCounselor();
  state.rows = [leadRow()];
  state.error = null;
  state.origins = [{ id: "list-qual", name: "Qualified" }];
  state.team = [{ user_id: "u-other", name: "Sita Sharma" }];
  state.calls = [];
});

describe("GET /archived-leads/search — access", () => {
  it("401s when unauthenticated", async () => {
    state.auth = null;
    expect((await GET(req("abdul"))).status).toBe(401);
  });
  it("403s for a tenant outside the education industry", async () => {
    state.auth = asCounselor({ industryId: "it_agency" });
    expect((await GET(req("abdul"))).status).toBe(403);
  });
  it.each(["", "ab", "  a "])("rejects a query under 3 characters with a validation error (%j)", async (q) => {
    expect((await GET(req(q))).status).toBe(422);
  });
  it("rejects a missing query with a validation error", async () => {
    expect((await GET(req())).status).toBe(422);
  });
});

describe("GET /archived-leads/search — what it queries", () => {
  it("looks only at leads in an ARCHIVE stage, not deleted, not converted, newest-archived first, max 5", async () => {
    await GET(req("abdul"));
    expect(ops("eq")).toContainEqual(["eq", ["lead_lists.is_archive", true]]);
    expect(ops("is")).toContainEqual(["is", ["deleted_at", null]]);
    expect(ops("is")).toContainEqual(["is", ["converted_at", null]]);
    expect(ops("limit")).toContainEqual(["limit", [5]]);
    expect(ops("order")[0][1][0]).toBe("archived_at");
  });

  it("selects a SUMMARY only — never notes, documents or activity", async () => {
    await GET(req("abdul"));
    const select = String(ops("select")[0][1][0]);
    for (const needed of ["first_name", "email", "phone", "archive_reason", "archived_at", "archived_from_list_id"]) expect(select).toContain(needed);
    for (const forbidden of ["notes", "documents", "custom_fields", "activity", "gpa"]) expect(select).not.toContain(forbidden);
  });

  it("matches name, email and phone, and every typed word must match (john smith = first + last)", async () => {
    await GET(req("john smith"));
    const ors = ops("or").map(([, args]) => String(args[0]));
    expect(ors).toHaveLength(2); // one OR group per word, chained = AND between words
    for (const f of ors) for (const col of ["first_name", "last_name", "email", "phone"]) expect(f).toContain(`${col}.ilike.`);
  });

  it("is NOT limited to the caller's own leads (deliberate: finding a lead archived under someone else)", async () => {
    await GET(req("abdul"));
    expect(ops("eq").some(([, args]) => args[0] === "assigned_to")).toBe(false);
  });

  it("503s when the query fails", async () => {
    state.error = { message: "boom" };
    expect((await GET(req("abdul"))).status).toBe(503);
  });
});

describe("GET /archived-leads/search — the result", () => {
  it("returns exactly the preview fields, with readable names", async () => {
    const res = await GET(req("abdul"));
    expect(res.status).toBe(200);
    const [lead] = (await res.json()).data;
    expect(Object.keys(lead).sort()).toEqual([
      "archive_reason", "archived_at", "archived_from_list_name", "assigned_to_name", "can_open", "can_restore",
      "created_at", "email", "first_name", "id", "last_name", "phone",
    ]);
    expect(lead).toMatchObject({ archived_from_list_name: "Qualified", assigned_to_name: "Sita Sharma", archive_reason: "No response" });
  });

  it("an own-scope counselor can find someone else's archived lead but is not offered 'Open lead' for it", async () => {
    const [lead] = (await (await GET(req("abdul"))).json()).data;
    expect(lead.can_open).toBe(false);
    expect(lead.can_restore).toBe(true);
  });

  it("offers 'Open lead' for the counselor's own archived lead", async () => {
    state.rows = [leadRow({ assigned_to: "u-me" })];
    const [lead] = (await (await GET(req("abdul"))).json()).data;
    expect(lead.can_open).toBe(true);
  });

  it("a view-only user sees the preview but cannot restore", async () => {
    state.auth = asCounselor({ role: "viewer", permissions: { baseTier: "member", leadScope: "own", canEditLeads: false } });
    const [lead] = (await (await GET(req("abdul"))).json()).data;
    expect(lead.can_restore).toBe(false);
  });

  it("owners and admins can open any of them", async () => {
    state.auth = asCounselor({ role: "owner", permissions: { baseTier: "owner", leadScope: "all", canEditLeads: true } });
    const [lead] = (await (await GET(req("abdul"))).json()).data;
    expect(lead.can_open).toBe(true);
  });

  it("tolerates a lead with no assignee and no remembered origin", async () => {
    state.rows = [leadRow({ assigned_to: null, archived_from_list_id: null, archive_reason: null })];
    const [lead] = (await (await GET(req("abdul"))).json()).data;
    expect(lead).toMatchObject({ assigned_to_name: null, archived_from_list_name: null, archive_reason: null });
  });

  it("returns an empty list when nothing matches", async () => {
    state.rows = [];
    expect((await (await GET(req("nobody"))).json()).data).toEqual([]);
  });
});
