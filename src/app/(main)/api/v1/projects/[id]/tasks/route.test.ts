import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// POST /api/v1/projects/:id/tasks — open to all tenant members (brief Phase 2b).
// assigned_by_id is stamped from the session, never the body.

const auth = vi.hoisted(() => ({
  current: { userId: "u-me", email: "a@b.c", tenantId: "tenant-A", role: "member", industryId: "it_agency" } as Record<string, string>,
}));

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: vi.fn(async () => auth.current),
  requireAdmin: (a: { role: string }) => a.role === "owner" || a.role === "admin",
}));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => true }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: vi.fn(), emitEvent: vi.fn() }));
vi.mock("@/lib/logger", () => ({ createRequestLogger: () => ({ info: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/notifications", () => ({
  NotificationTypes: { TASK_ASSIGNED: "task_assigned" },
  createNotificationsExcept: vi.fn(),
}));

const state = vi.hoisted(() => ({ insertArgs: null as unknown }));

const tasksTable = () => ({
  select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "p-1" } }) }) }),
  insert: (args: unknown) => {
    state.insertArgs = args;
    return { select: () => ({ single: async () => ({ data: { id: "task-1", ...(args as object) }, error: null }) }) };
  },
});

vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: vi.fn(async () => ({
    from: (table: string) => {
      if (table === "projects") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "p-1" } }) }) }) };
      if (table === "tenant_users") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { user_id: "u-other" } }) }) }) };
      return tasksTable();
    },
    raw: () => ({
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) }),
      }),
    }),
  })),
}));

import { POST } from "./route";

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}
const params = Promise.resolve({ id: "p-1" });

beforeEach(() => {
  auth.current = { userId: "u-me", email: "a@b.c", tenantId: "tenant-A", role: "member", industryId: "it_agency" };
  state.insertArgs = null;
});

describe("POST /api/v1/projects/:id/tasks", () => {
  it("a non-admin member can create a task; creator is stamped so they can edit it", async () => {
    const res = await POST(req({ title: "Do the thing" }), { params });
    expect(res.status).toBe(201);
    expect((state.insertArgs as { assigned_by_id: unknown }).assigned_by_id).toBe("u-me");
  });

  it("assigned_by_id comes from the session, not the body", async () => {
    const res = await POST(
      req({ title: "Assign out", assignee_id: "33333333-3333-3333-3333-333333333333", assigned_by_id: "spoofed" }),
      { params },
    );
    expect(res.status).toBe(201);
    expect((state.insertArgs as { assigned_by_id: unknown }).assigned_by_id).toBe("u-me");
  });

  it("a non-admin's is_billable in the body is ignored (defaults billable)", async () => {
    const res = await POST(req({ title: "Free work", is_billable: false }), { params });
    expect(res.status).toBe(201);
    expect((state.insertArgs as { is_billable: unknown }).is_billable).toBe(true);
  });
});
