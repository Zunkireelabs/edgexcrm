import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UserRole } from "@/types/database";

// Regression guard for the delivery RBAC round: the new canManage* position
// capabilities must NOT leak into team administration. POST /api/v1/invites
// stays admin-only (requireAdmin), even for a member holding canManageProjects.

const auth = vi.hoisted(() => ({
  current: { userId: "u-1", email: "a@b.c", tenantId: "tenant-A", role: "member", industryId: "it_agency" } as Record<string, unknown>,
}));

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: vi.fn(async () => {
    const { resolvePermissions } = await import("@/lib/api/permissions");
    return {
      ...auth.current,
      permissions: auth.current.permissions ?? resolvePermissions(auth.current.role as UserRole, null),
    };
  }),
  requireAdmin: (a: { role: string }) => a.role === "owner" || a.role === "admin",
  getClientIp: () => "127.0.0.1",
}));
vi.mock("@/lib/logger", () => ({ createRequestLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) }));

import { POST } from "./route";

function req(body: unknown): Parameters<typeof POST>[0] {
  return new Request("https://x.test/api/v1/invites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  auth.current = { userId: "u-1", email: "a@b.c", tenantId: "tenant-A", role: "member", industryId: "it_agency" };
});

describe("POST /api/v1/invites — stays admin-only", () => {
  it("a member with canManageProjects is still forbidden", async () => {
    const { resolvePermissions } = await import("@/lib/api/permissions");
    auth.current.role = "viewer";
    auth.current.permissions = resolvePermissions("viewer", {
      nav: { mode: "all" },
      pipelines: { mode: "all" },
      leadScope: "all",
      dashboard: { widgets: { mode: "all" } },
      canManageProjects: true,
      canApproveTime: true,
      canManageBilling: true,
    });
    const res = await POST(req({ email: "x@y.co", position_id: "11111111-1111-1111-1111-111111111111" }));
    expect(res.status).toBe(403);
  });
});
