import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

// TENANT-ISOLATION-TESTS-BRIEF.md §2d — PATCH /api/v1/settings/organization was moved
// server-side by Phase A (#354) because the browser client loses table access under the
// role-scoping revoke. It writes to `tenants` (no tenant_id column — keyed by id, so it
// uses db.raw() + an explicit .eq("id", auth.tenantId), never a caller-supplied id) and to
// `form_configs` (via scopedClient's auto-injected tenant_id filter + .eq("id", …)).

const authenticateRequestMock = vi.fn();
const scopedClientMock = vi.fn();

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, authenticateRequest: authenticateRequestMock };
});
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));

const OWNER_AUTH = { userId: "user-1", tenantId: "tenant-1", role: "owner" } as unknown as AuthContext;
const VIEWER_AUTH = { userId: "user-2", tenantId: "tenant-1", role: "viewer" } as unknown as AuthContext;

function fakeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

type Call = [table: string, method: string, args: unknown[]];

function makeUpdatable(table: string, calls: Call[], error: { code: string } | null = null) {
  return {
    update: (values: unknown) => {
      calls.push([table, "update", [values]]);
      return {
        eq: (col: string, val: unknown) => {
          calls.push([table, "eq", [col, val]]);
          return Promise.resolve({ error });
        },
      };
    },
  };
}

function fakeDb(calls: Call[], opts: { tenantsError?: { code: string } | null } = {}) {
  const rawClient = {
    from: (table: string) => makeUpdatable(table, calls, opts.tenantsError ?? null),
  };
  return {
    raw: () => rawClient,
    from: (table: string) => makeUpdatable(table, calls),
  };
}

describe("PATCH /api/v1/settings/organization — tenant isolation (TENANT-ISOLATION-TESTS-BRIEF §2d)", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset();
    scopedClientMock.mockReset();
    authenticateRequestMock.mockResolvedValue(OWNER_AUTH);
  });

  it("401 when unauthenticated — never touches the db", async () => {
    authenticateRequestMock.mockResolvedValue(null);
    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ name: "New Name" }));
    expect(res.status).toBe(401);
    expect(scopedClientMock).not.toHaveBeenCalled();
  });

  it("403 for a non-admin (viewer) — never touches the db", async () => {
    authenticateRequestMock.mockResolvedValue(VIEWER_AUTH);
    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ name: "New Name" }));
    expect(res.status).toBe(403);
    expect(scopedClientMock).not.toHaveBeenCalled();
  });

  it("tenants update is filtered by .eq('id', auth.tenantId) — the route accepts no caller-supplied tenant id at all", async () => {
    const calls: Call[] = [];
    scopedClientMock.mockResolvedValue(fakeDb(calls));

    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ name: "New Name", primaryColor: "#123456", slug: "new-slug" }));

    expect(res.status).toBe(200);
    expect(calls).toContainEqual(["tenants", "eq", ["id", "tenant-1"]]);
    const updateCall = calls.find(([table, method]) => table === "tenants" && method === "update");
    expect(updateCall?.[2][0]).toEqual({ name: "New Name", primary_color: "#123456", slug: "new-slug" });
  });

  it("form_configs update carries the scoped-client tenant filter (via db.from, not db.raw) plus .eq('id', …)", async () => {
    const calls: Call[] = [];
    scopedClientMock.mockResolvedValue(fakeDb(calls));

    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ formConfigId: "form-1", redirectUrl: "https://example.com/thanks" }));

    expect(res.status).toBe(200);
    expect(calls).toContainEqual(["form_configs", "eq", ["id", "form-1"]]);
    const updateCall = calls.find(([table, method]) => table === "form_configs" && method === "update");
    expect(updateCall?.[2][0]).toEqual({ redirect_url: "https://example.com/thanks" });
    // tenants must NOT be touched when only formConfigId/redirectUrl are supplied.
    expect(calls.some(([table]) => table === "tenants")).toBe(false);
  });

  it("a caller-supplied slug collision (23505) surfaces as a validation error, not a 500", async () => {
    const calls: Call[] = [];
    scopedClientMock.mockResolvedValue(fakeDb(calls, { tenantsError: { code: "23505" } }));

    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ slug: "taken-slug" }));
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.details.slug).toEqual(["This slug is already taken"]);
  });
});
