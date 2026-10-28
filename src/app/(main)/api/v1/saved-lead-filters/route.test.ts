import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// /api/v1/saved-lead-filters + /[id] — a user's private named Leads filters. Everything is faked (no DB); the fake
// records every chained call so we can assert each query is scoped to the signed-in USER, not just the tenant.

type Op = [string, unknown[]];
const state = vi.hoisted(() => ({
  auth: null as Record<string, unknown> | null,
  rows: [] as Array<Record<string, unknown>>,
  count: 0,
  insertResult: { data: { id: "11111111-2222-4333-8444-555555555555", name: "x", filter_tree: {}, created_at: "t" }, error: null } as {
    data: unknown;
    error: { code?: string } | null;
  },
  writeResult: { data: { id: "11111111-2222-4333-8444-555555555555", name: "x", filter_tree: {}, created_at: "t" }, error: null } as {
    data: unknown;
    error: { code?: string } | null;
  },
  calls: [] as Array<{ table: string; ops: Op[] }>,
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
          if (has("insert")) result = state.insertResult;
          else if (has("update") || has("delete")) result = state.writeResult;
          else if (has("select") && rec.ops.some(([o, a]) => o === "select" && (a[1] as { head?: boolean })?.head)) result = { count: state.count, error: null };
          else result = { data: state.rows, error: null };
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

import { GET, POST } from "./route";
import { PATCH, DELETE } from "./[id]/route";

const ID = "11111111-2222-4333-8444-555555555555";
const TREE = { conjunction: "and", conditions: [{ id: "c1", field: "status", op: "is_any_of", value: ["connected", "in_progress"] }] };
const education = { userId: "user-1", tenantId: "t-1", industryId: "education_consultancy" };

const json = (body: unknown) => new NextRequest("http://x/api/v1/saved-lead-filters", { method: "POST", body: JSON.stringify(body) });
const eqCalls = () => state.calls.flatMap((c) => c.ops).filter(([o]) => o === "eq").map(([, a]) => a as [string, unknown]);

beforeEach(() => {
  state.auth = education;
  state.rows = [];
  state.count = 0;
  state.insertResult = { data: { id: ID, name: "Amit", filter_tree: TREE, created_at: "t" }, error: null };
  state.writeResult = { data: { id: ID, name: "Amit", filter_tree: TREE, created_at: "t" }, error: null };
  state.calls = [];
});

describe("access", () => {
  it("401 when signed out", async () => {
    state.auth = null;
    expect((await GET()).status).toBe(401);
    expect((await POST(json({ name: "a", filter_tree: TREE }))).status).toBe(401);
  });

  it("403 for a tenant outside education_consultancy, on every method", async () => {
    state.auth = { ...education, industryId: "it_agency" };
    expect((await GET()).status).toBe(403);
    expect((await POST(json({ name: "a", filter_tree: TREE }))).status).toBe(403);
    const ctx = { params: Promise.resolve({ id: ID }) };
    expect((await PATCH(json({ name: "b" }), ctx)).status).toBe(403);
    expect((await DELETE(json({}), ctx)).status).toBe(403);
    expect(state.calls).toHaveLength(0);
  });
});

describe("GET", () => {
  it("lists only the signed-in user's filters", async () => {
    state.rows = [{ id: ID, name: "Amit", filter_tree: TREE, created_at: "t" }];
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveLength(1);
    expect(eqCalls()).toContainEqual(["user_id", "user-1"]);
  });
});

describe("POST", () => {
  it("saves a named filter for the signed-in user (user_id comes from the session, never the body)", async () => {
    const res = await POST(json({ name: "  Amit  ", filter_tree: TREE, user_id: "someone-else" }));
    expect(res.status).toBe(201);
    const insert = state.calls.flatMap((c) => c.ops).find(([o]) => o === "insert")!;
    expect(insert[1][0]).toEqual({ user_id: "user-1", name: "Amit", filter_tree: TREE });
  });

  it("422 for a blank name or an empty filter, and writes nothing", async () => {
    expect((await POST(json({ name: "  ", filter_tree: TREE }))).status).toBe(422);
    expect((await POST(json({ name: "ok", filter_tree: { conjunction: "and", conditions: [] } }))).status).toBe(422);
    expect(state.calls.flatMap((c) => c.ops).some(([o]) => o === "insert")).toBe(false);
  });

  it("400 for a body that is not JSON", async () => {
    const bad = new NextRequest("http://x/api/v1/saved-lead-filters", { method: "POST", body: "{nope" });
    expect((await POST(bad)).status).toBe(400);
  });

  it("409 when the user already has a filter with that name", async () => {
    state.insertResult = { data: null, error: { code: "23505" } };
    expect((await POST(json({ name: "Amit", filter_tree: TREE }))).status).toBe(409);
  });

  it("409 once the user is at the 50-filter limit, and inserts nothing", async () => {
    state.count = 50;
    expect((await POST(json({ name: "One more", filter_tree: TREE }))).status).toBe(409);
    expect(state.calls.flatMap((c) => c.ops).some(([o]) => o === "insert")).toBe(false);
  });
});

describe("PATCH / DELETE", () => {
  const ctx = { params: Promise.resolve({ id: ID }) };

  it("rename is limited to the caller's own row (id AND user_id)", async () => {
    const res = await PATCH(json({ name: "Renamed" }), ctx);
    expect(res.status).toBe(200);
    expect(eqCalls()).toEqual(expect.arrayContaining([["id", ID], ["user_id", "user-1"]]));
  });

  it("delete is limited to the caller's own row (id AND user_id)", async () => {
    const res = await DELETE(json({}), ctx);
    expect(res.status).toBe(200);
    expect(eqCalls()).toEqual(expect.arrayContaining([["id", ID], ["user_id", "user-1"]]));
  });

  it("404 when the row isn't the caller's (or doesn't exist) — nothing is revealed about other people's filters", async () => {
    state.writeResult = { data: null, error: null };
    expect((await PATCH(json({ name: "x" }), ctx)).status).toBe(404);
    expect((await DELETE(json({}), ctx)).status).toBe(404);
  });

  it("409 when renaming to a name the user already uses; 422 on a bad id or blank name", async () => {
    state.writeResult = { data: null, error: { code: "23505" } };
    expect((await PATCH(json({ name: "Dup" }), ctx)).status).toBe(409);
    expect((await PATCH(json({ name: "ok" }), { params: Promise.resolve({ id: "not-a-uuid" }) })).status).toBe(422);
    expect((await PATCH(json({ name: " " }), ctx)).status).toBe(422);
  });
});
