import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UserRole } from "@/types/database";
import type { NextRequest } from "next/server";

// POST /api/v1/projects/:id/tasks — open to all tenant members (brief Phase 2b).
// assigned_by_id is stamped from the session, never the body.

const auth = vi.hoisted(() => ({
  current: { userId: "u-me", email: "a@b.c", tenantId: "tenant-A", role: "member", industryId: "it_agency" } as Record<string, unknown>,
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
}));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => true }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: vi.fn(), emitEvent: vi.fn() }));
vi.mock("@/lib/logger", () => ({ createRequestLogger: () => ({ info: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/notifications", () => ({
  NotificationTypes: { TASK_ASSIGNED: "task_assigned" },
  createNotificationsExcept: vi.fn(),
}));
const dispatchSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tasks/dispatch-notify", () => ({
  notifyTaskAssigned: (...a: unknown[]) => dispatchSpy(...a),
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
  dispatchSpy.mockClear();
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

  it("a member without billing capability: is_billable in the body is ignored (defaults billable)", async () => {
    const res = await POST(req({ title: "Free work", is_billable: false }), { params });
    expect(res.status).toBe(201);
    expect((state.insertArgs as { is_billable: unknown }).is_billable).toBe(true);
  });

  it("a member on a position granting canManageBilling can set is_billable:false", async () => {
    const { resolvePermissions } = await import("@/lib/api/permissions");
    auth.current.role = "viewer";
    auth.current.permissions = resolvePermissions("viewer", {
      nav: { mode: "all" },
      pipelines: { mode: "all" },
      leadScope: "all",
      dashboard: { widgets: { mode: "all" } },
      canManageBilling: true,
    });
    const res = await POST(req({ title: "Non-billable spike", is_billable: false }), { params });
    expect(res.status).toBe(201);
    expect((state.insertArgs as { is_billable: unknown }).is_billable).toBe(false);
  });

  // Bug A (Round 2 slice B): the New Task dialog sends priority + due_date and
  // the route silently discarded both. Regression guard.
  it("persists priority and due_date sent by the client", async () => {
    const res = await POST(req({ title: "Ship it", priority: "urgent", due_date: "2026-09-20" }), { params });
    expect(res.status).toBe(201);
    expect((state.insertArgs as { priority: unknown }).priority).toBe("urgent");
    expect((state.insertArgs as { due_date: unknown }).due_date).toBe("2026-09-20");
  });

  it("defaults priority to normal and due_date to null when absent", async () => {
    const res = await POST(req({ title: "No dates here" }), { params });
    expect(res.status).toBe(201);
    expect((state.insertArgs as { priority: unknown }).priority).toBe("normal");
    expect((state.insertArgs as { due_date: unknown }).due_date).toBeNull();
  });

  it("rejects an invalid priority", async () => {
    const res = await POST(req({ title: "Bad priority", priority: "asap" }), { params });
    expect(res.status).toBe(422);
  });

  it("rejects a malformed due_date", async () => {
    const res = await POST(req({ title: "Bad date", due_date: "next friday" }), { params });
    expect(res.status).toBe(422);
  });

  // Bug B (Round 2 slice B): assigning a project task to a teammate never
  // called notifyTaskAssigned, so nobody was emailed. Regression guard.
  it("assigning to a teammate calls notifyTaskAssigned with a /tasks/<id> path", async () => {
    const res = await POST(
      req({ title: "Assign out", assignee_id: "33333333-3333-3333-3333-333333333333" }),
      { params },
    );
    expect(res.status).toBe(201);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const [, opts] = dispatchSpy.mock.calls[0] as [unknown, { taskId: string; assigneeUserId: string; taskPath: string }];
    expect(opts.assigneeUserId).toBe("33333333-3333-3333-3333-333333333333");
    expect(opts.taskPath).toBe("/tasks/task-1");
  });

  it("self-assigned (no assignee_id) does not call notifyTaskAssigned", async () => {
    const res = await POST(req({ title: "Solo task" }), { params });
    expect(res.status).toBe(201);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});
