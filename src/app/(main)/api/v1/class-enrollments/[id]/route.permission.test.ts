import { describe, it, expect, vi, beforeEach } from "vitest";
import { PERMISSION_DENIED_MESSAGE } from "@/lib/permission-denied";

// PATCH/DELETE /api/v1/class-enrollments/[id] — a restricted user acting on a student outside their
// scope gets 403 with the standard "no permission" message (not a misleading 404 that the screen
// shows as "Failed"). A record that truly doesn't exist is still 404. Everything is faked — no DB.

const state = vi.hoisted(() => ({
  auth: null as Record<string, unknown> | null,
  enrollment: null as Record<string, unknown> | null,
  parentLead: null as Record<string, unknown> | null,
  restrict: false,
  branchOk: true,
}));

// Chainable query fake: every builder method returns itself; terminal calls resolve a result.
function chain(result: () => unknown) {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === "maybeSingle" || prop === "single") return async () => result();
      if (prop === "then") return undefined;
      return () => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
}

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: vi.fn(async () => state.auth),
  requireLeadBranchAccess: vi.fn(() => state.branchOk),
}));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => true }));
vi.mock("@/lib/api/class-attendance", () => ({ canEnrollStudents: vi.fn(async () => true) }));
vi.mock("@/lib/api/permissions", () => ({ shouldRestrictToSelf: vi.fn(() => state.restrict) }));
vi.mock("@/lib/leads/branch-membership", () => ({ getLeadMembership: vi.fn(async () => []) }));
vi.mock("@/lib/api/audit", () => ({
  createAuditLog: vi.fn(async () => undefined),
  emitEvent: vi.fn(async () => undefined),
}));
vi.mock("@/lib/logger", () => ({
  createRequestLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));
vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: vi.fn(async () => ({
    from: () => chain(() => ({ data: state.enrollment, error: null })),
  })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: vi.fn(async () => ({
    from: () => chain(() => ({ data: state.parentLead, error: null })),
  })),
}));

import { PATCH, DELETE } from "./route";

const params = { params: Promise.resolve({ id: "enr-1" }) };

function patchReq(body: unknown) {
  return new Request("http://localhost/api/v1/class-enrollments/enr-1", {
    method: "PATCH",
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof PATCH>[0];
}
function deleteReq() {
  return new Request("http://localhost/api/v1/class-enrollments/enr-1", {
    method: "DELETE",
  }) as unknown as Parameters<typeof DELETE>[0];
}

beforeEach(() => {
  state.auth = {
    userId: "u-mgr",
    email: "mgr@admizz.org",
    tenantId: "tenant-A",
    role: "member",
    industryId: "education_consultancy",
    permissions: {},
  };
  state.enrollment = { id: "enr-1", lead_id: "lead-1", fee_paid: false };
  state.parentLead = { id: "lead-1", assigned_to: "someone-else", branch_id: "b-1" };
  state.restrict = true;
  state.branchOk = true;
});

async function errorOf(res: Response) {
  const json = await res.json();
  return json.error as { code: string; message: string };
}

describe("PATCH /class-enrollments/[id]", () => {
  it("403s with the standard message when the student's lead is outside the user's scope", async () => {
    const res = await PATCH(patchReq({ fee_amount: 4000 }), params);
    expect(res.status).toBe(403);
    const err = await errorOf(res);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toBe(PERMISSION_DENIED_MESSAGE);
  });

  it("403s when branch access is denied", async () => {
    state.restrict = false;
    state.branchOk = false;
    const res = await PATCH(patchReq({ fee_amount: 4000 }), params);
    expect(res.status).toBe(403);
    expect((await errorOf(res)).message).toBe(PERMISSION_DENIED_MESSAGE);
  });

  it("still 404s when the enrollment truly does not exist", async () => {
    state.enrollment = null;
    const res = await PATCH(patchReq({ fee_amount: 4000 }), params);
    expect(res.status).toBe(404);
  });

  it("still 404s when the parent lead is gone", async () => {
    state.parentLead = null;
    const res = await PATCH(patchReq({ fee_amount: 4000 }), params);
    expect(res.status).toBe(404);
  });

  it("is not blocked for an unrestricted user (owner/admin)", async () => {
    state.restrict = false;
    const res = await PATCH(patchReq({ fee_amount: 4000 }), params);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(404);
  });

  it("is not blocked for a restricted user whose lead is assigned to them", async () => {
    state.parentLead = { id: "lead-1", assigned_to: "u-mgr", branch_id: "b-1" };
    const res = await PATCH(patchReq({ fee_amount: 4000 }), params);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(404);
  });
});

describe("DELETE /class-enrollments/[id]", () => {
  it("403s with the standard message when the lead is outside the user's scope", async () => {
    const res = await DELETE(deleteReq(), params);
    expect(res.status).toBe(403);
    expect((await errorOf(res)).message).toBe(PERMISSION_DENIED_MESSAGE);
  });

  it("still 404s when the enrollment does not exist", async () => {
    state.enrollment = null;
    const res = await DELETE(deleteReq(), params);
    expect(res.status).toBe(404);
  });
});
