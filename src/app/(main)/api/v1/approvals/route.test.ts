import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UserRole } from "@/types/database";

// GET /api/v1/approvals — the approvals queue. Gated on canApproveTime
// (owner/admin, or a position granting it) — Phase C of the delivery RBAC round.

const auth = vi.hoisted(() => ({
  current: { userId: "u-1", email: "a@b.c", tenantId: "tenant-A", role: "admin", industryId: "it_agency" } as Record<string, unknown>,
}));

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: vi.fn(async () => {
    const { resolvePermissions } = await import("@/lib/api/permissions");
    return {
      ...auth.current,
      permissions: auth.current.permissions ?? resolvePermissions(auth.current.role as UserRole, null),
    };
  }),
}));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => true }));
vi.mock("@/lib/logger", () => ({ createRequestLogger: () => ({ info: vi.fn(), error: vi.fn() }) }));

vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: vi.fn(async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }),
    }),
    raw: () => ({ auth: { admin: { listUsers: async () => ({ data: { users: [] } }) } } }),
  })),
}));

import { GET } from "./route";

const NEUTRAL_POS = {
  nav: { mode: "all" as const },
  pipelines: { mode: "all" as const },
  leadScope: "all" as const,
  dashboard: { widgets: { mode: "all" as const } },
};

beforeEach(() => {
  auth.current = { userId: "u-1", email: "a@b.c", tenantId: "tenant-A", role: "admin", industryId: "it_agency" };
});

describe("GET /api/v1/approvals — canApproveTime gate", () => {
  it("owner/admin can read the queue regardless of position", async () => {
    for (const role of ["owner", "admin"]) {
      auth.current = { ...auth.current, role, permissions: undefined };
      const res = await GET();
      expect(res.status).toBe(200);
    }
  });

  it("a member with no position is forbidden (behaviour-neutral default)", async () => {
    auth.current.role = "member";
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("a member on a position WITHOUT canApproveTime is forbidden", async () => {
    const { resolvePermissions } = await import("@/lib/api/permissions");
    auth.current.role = "viewer";
    auth.current.permissions = resolvePermissions("viewer", NEUTRAL_POS);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("a member on a position WITH canApproveTime can read the queue", async () => {
    const { resolvePermissions } = await import("@/lib/api/permissions");
    auth.current.role = "viewer";
    auth.current.permissions = resolvePermissions("viewer", { ...NEUTRAL_POS, canApproveTime: true });
    const res = await GET();
    expect(res.status).toBe(200);
  });
});
