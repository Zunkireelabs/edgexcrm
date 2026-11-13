import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// EDGEX-141 Phase 4: PATCH accepts the application's own counsellor (`assigned_to`) for the list
// view's bulk "Assign counsellor". The membership check runs through the REAL scopedClient over a
// fake service client, so the tenant filter it injects is what rejects a user of another tenant.

const TENANT = "tenant-1";
const MEMBER = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT_USER = "22222222-2222-4222-8222-222222222222";
const STRANGER = "33333333-3333-4333-8333-333333333333";

const createAuditLogMock = vi.fn();
const emitEventMock = vi.fn();
let canManage = true;
let written: Record<string, unknown> | null = null;

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: vi.fn(async () => ({
    userId: "user-1",
    tenantId: TENANT,
    role: "admin",
    industryId: "education_consultancy",
    permissions: { baseTier: "admin" },
  })),
}));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => true }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: createAuditLogMock, emitEvent: emitEventMock }));

const existingRow = { id: "app-1", lead_id: "lead-1", stage_id: "stage-new", pipeline_id: "pipe-a", status: "new", notes: null, assigned_to: null };

vi.mock("@/lib/api/applications", () => ({
  getApplicationWithAccess: vi.fn(async () => ({
    allowed: true,
    application: { ...existingRow },
    parentLead: { id: "lead-1", branch_id: null, assigned_to: null },
    membership: [],
    viaCollaborator: false,
  })),
  canManageApplicationForLead: () => canManage,
}));

// tenant_users rows across TWO tenants; the fake evaluates every .eq() it receives.
const TENANT_USERS = [
  { tenant_id: TENANT, user_id: MEMBER },
  { tenant_id: "tenant-2", user_id: OTHER_TENANT_USER },
];
const tenantUserQueries: Record<string, unknown>[] = [];

function fakeServiceClient() {
  return {
    from(table: string) {
      if (table === "tenant_users") {
        return {
          select: () => {
            const filters: Record<string, unknown> = {};
            const q = {
              eq(col: string, val: unknown) {
                filters[col] = val;
                return q;
              },
              async maybeSingle() {
                tenantUserQueries.push({ ...filters });
                const row = TENANT_USERS.find((r) => Object.entries(filters).every(([k, v]) => (r as Record<string, unknown>)[k] === v));
                return { data: row ? { user_id: row.user_id } : null, error: null };
              },
            };
            return q;
          },
        };
      }
      if (table === "applications") {
        return {
          update(patch: Record<string, unknown>) {
            written = patch;
            const q = {
              eq: () => q,
              select: () => ({ single: async () => ({ data: { ...existingRow, ...patch }, error: null }) }),
            };
            return q;
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn(async () => fakeServiceClient()), createClient: vi.fn() }));

function fakeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}
const params = Promise.resolve({ id: "app-1" });

async function patch(body: Record<string, unknown>) {
  const { PATCH } = await import("./route");
  const res = await PATCH(fakeReq(body), { params });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("PATCH /api/v1/applications/[id] — assigned_to (EDGEX-141 Phase 4)", () => {
  beforeEach(() => {
    canManage = true;
    written = null;
    tenantUserQueries.length = 0;
    createAuditLogMock.mockReset();
    emitEventMock.mockReset();
  });

  it("a member of this workspace is written, checked through the tenant-scoped client", async () => {
    const res = await patch({ assigned_to: MEMBER });
    expect(res.status).toBe(200);
    expect(written).toEqual({ assigned_to: MEMBER });
    // the scoped client injected the caller's tenant on the membership read
    expect(tenantUserQueries).toEqual([{ tenant_id: TENANT, user_id: MEMBER }]);
  });

  it("null clears it (the board falls back to the lead's counsellor), with no membership read", async () => {
    const res = await patch({ assigned_to: null });
    expect(res.status).toBe(200);
    expect(written).toEqual({ assigned_to: null });
    expect(tenantUserQueries).toEqual([]);
  });

  it("a real user of ANOTHER tenant is rejected 422 'Not a member of this workspace'", async () => {
    const res = await patch({ assigned_to: OTHER_TENANT_USER });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.json)).toContain("Not a member of this workspace");
    expect(written).toBeNull();
  });

  it("an unknown uuid is rejected 422 the same way", async () => {
    const res = await patch({ assigned_to: STRANGER });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.json)).toContain("Not a member of this workspace");
    expect(written).toBeNull();
  });

  it.each([["not-a-uuid"], [42], [""], [{ id: MEMBER }]])("a non-uuid value (%j) is rejected 422 with a field error", async (value) => {
    const res = await patch({ assigned_to: value });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.json)).toContain("assigned_to");
    expect(written).toBeNull();
    expect(tenantUserQueries).toEqual([]);
  });

  it("a user who can't manage the application gets 403 and nothing is written", async () => {
    canManage = false;
    const res = await patch({ assigned_to: MEMBER });
    expect(res.status).toBe(403);
    expect(written).toBeNull();
  });

  it("recorded like any other field edit: one generic application.updated audit row, no notifications module touched", async () => {
    await patch({ assigned_to: MEMBER });
    const actions = createAuditLogMock.mock.calls.map((c) => (c[0] as { action: string }).action);
    expect(actions).toEqual(["application.updated"]);
  });
});
