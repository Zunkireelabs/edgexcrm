import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UserRole } from "@/types/database";
import type { NextRequest } from "next/server";

// Own-vs-admin authorization on PATCH /api/v1/tasks/:id (brief Phase 2a).
// Mirrors the canEdit() shape from time-entries/[id]/route.ts.

const auth = vi.hoisted(() => ({
  current: {
    userId: "u-admin",
    email: "admin@x.co",
    tenantId: "tenant-A",
    role: "admin",
    industryId: "it_agency",
  } as Record<string, unknown>,
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

// Real createNotificationsExcept filtering semantics (drops the actor) over a
// spy DB writer, so "self-completion notifies nobody" is a real assertion.
const notifSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/notifications", () => ({
  NotificationTypes: { TASK_ASSIGNED: "task.assigned", TASK_COMPLETED: "task.completed" },
  createNotificationsExcept: (actor: string | null, params: { userId: string }[]) => {
    notifSpy(params.filter((p) => p.userId !== actor));
    return Promise.resolve([]);
  },
}));

const emailSpy = vi.hoisted(() => ({
  assigned: vi.fn(async (_a: unknown) => ({ success: true })),
  completed: vi.fn(async (_a: unknown) => ({ success: true })),
}));
vi.mock("@/lib/email/send-task-assigned", () => ({
  sendTaskAssignedEmail: (a: unknown) => emailSpy.assigned(a),
  sendTaskCompletedEmail: (a: unknown) => emailSpy.completed(a),
}));
vi.mock("@/lib/email/task-email-gate", () => ({
  isTaskEmailEnabled: (industryId: string) => industryId === "it_agency",
}));

const state = vi.hoisted(() => ({
  task: {} as Record<string, unknown>,
  updateArgs: null as unknown,
}));

vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: vi.fn(async () => ({
    raw: () => ({
      auth: { admin: { getUserById: async () => ({ data: { user: { email: "doer@x.co" } } }) } },
      from: () => ({
        select: () => ({
          eq: () => ({ single: async () => ({ data: { name: "Zunkiree", primary_color: null } }) }),
        }),
      }),
    }),
    from: (table: string) => {
      if (table === "tenant_users") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { user_id: "u-other" } }) }) }),
        };
      }
      // tasks
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: state.task }) }),
        }),
        update: (patch: unknown) => {
          state.updateArgs = patch;
          return {
            eq: () => ({ select: () => ({ single: async () => ({ data: { ...state.task, ...(patch as object) }, error: null }) }) }),
          };
        },
        delete: () => ({ eq: async () => ({ error: null }) }),
      };
    },
  })),
}));

import { PATCH, DELETE } from "./route";

function req(body: unknown): NextRequest {
  return { json: async () => body, url: "http://localhost/api/v1/tasks/t-1" } as unknown as NextRequest;
}
const params = Promise.resolve({ id: "t-1" });

beforeEach(() => {
  auth.current = { userId: "u-admin", email: "admin@x.co", tenantId: "tenant-A", role: "admin", industryId: "it_agency" };
  state.task = { id: "t-1", title: "T", status: "in_progress", assignee_id: "u-assignee", assigned_by_id: null, project_id: "p-1" };
  state.updateArgs = null;
  notifSpy.mockClear();
  emailSpy.assigned.mockClear();
  emailSpy.completed.mockClear();
});

describe("PATCH /api/v1/tasks/:id — own-vs-admin", () => {
  it("admin can write the full field set", async () => {
    const res = await PATCH(req({ status: "done", is_billable: false, title: "New" }), { params });
    expect(res.status).toBe(200);
  });

  it("assignee can patch status/due/estimate/tags on their own task", async () => {
    auth.current.userId = "u-assignee";
    auth.current.role = "member";
    const res = await PATCH(
      req({ status: "in_progress", due_date: "2026-09-30", estimated_minutes: 120, tags: ["x"] }),
      { params },
    );
    expect(res.status).toBe(200);
  });

  it("a non-assignee, non-admin member is forbidden", async () => {
    auth.current.userId = "u-stranger";
    auth.current.role = "member";
    const res = await PATCH(req({ status: "done" }), { params });
    expect(res.status).toBe(403);
  });

  it("a member reassigning assignee_id to someone else is forbidden", async () => {
    auth.current.userId = "u-assignee";
    auth.current.role = "member";
    const res = await PATCH(req({ assignee_id: "11111111-1111-1111-1111-111111111111" }), { params });
    expect(res.status).toBe(403);
  });

  it("a member setting is_billable is forbidden", async () => {
    auth.current.userId = "u-assignee";
    auth.current.role = "member";
    const res = await PATCH(req({ is_billable: true }), { params });
    expect(res.status).toBe(403);
  });

  it("DELETE — a member with no delivery position (even the assignee) is forbidden", async () => {
    auth.current.userId = "u-assignee";
    auth.current.role = "member";
    const res = await DELETE({} as unknown as NextRequest, { params });
    expect(res.status).toBe(403);
  });

  it("DELETE — a member on a position granting canManageProjects can delete", async () => {
    const { resolvePermissions } = await import("@/lib/api/permissions");
    auth.current.userId = "u-delivery-lead";
    auth.current.role = "viewer";
    auth.current.permissions = resolvePermissions("viewer", {
      nav: { mode: "all" },
      pipelines: { mode: "all" },
      leadScope: "all",
      dashboard: { widgets: { mode: "all" } },
      canManageProjects: true,
    });
    const res = await DELETE({} as unknown as NextRequest, { params });
    expect(res.status).toBe(200);
  });

  const CLAIMER = "44444444-4444-4444-4444-444444444444";

  it("a member can claim an unassigned task (assignee_id -> self)", async () => {
    state.task = { id: "t-1", title: "T", assignee_id: null, assigned_by_id: "u-admin", project_id: "p-1" };
    auth.current.userId = CLAIMER;
    auth.current.role = "member";
    const res = await PATCH(req({ assignee_id: CLAIMER, status: "in_progress" }), { params });
    expect(res.status).toBe(200);
  });

  it("a member cannot assign an unassigned task to someone else", async () => {
    state.task = { id: "t-1", title: "T", assignee_id: null, assigned_by_id: "u-admin", project_id: "p-1" };
    auth.current.userId = CLAIMER;
    auth.current.role = "member";
    const res = await PATCH(req({ assignee_id: "11111111-1111-1111-1111-111111111111" }), { params });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/v1/tasks/:id — Slice A: TASK_COMPLETED (dispatch loop)", () => {
  function completedNotifs() {
    return notifSpy.mock.calls
      .flatMap((c) => c[0] as { type: string; userId: string }[])
      .filter((n) => n.type === "task.completed");
  }

  it("fires once to assigned_by_id when a task moves to done", async () => {
    state.task = { id: "t-1", title: "Ship it", status: "in_progress", assignee_id: "u-assignee", assigned_by_id: "u-dispatcher", project_id: "p-1" };
    auth.current.userId = "u-assignee";
    auth.current.role = "member";
    const res = await PATCH(req({ status: "done" }), { params });
    expect(res.status).toBe(200);
    const n = completedNotifs();
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ userId: "u-dispatcher", message: "Ship it", link: "/projects/p-1" });
  });

  it("does NOT re-fire when the task was already done", async () => {
    state.task = { id: "t-1", title: "T", status: "done", assignee_id: "u-assignee", assigned_by_id: "u-dispatcher", project_id: "p-1" };
    auth.current.userId = "u-assignee";
    auth.current.role = "member";
    const res = await PATCH(req({ status: "done", tags: ["x"] }), { params });
    expect(res.status).toBe(200);
    expect(completedNotifs()).toHaveLength(0);
  });

  it("no notification when the completer is the dispatcher (self-completion)", async () => {
    state.task = { id: "t-1", title: "T", status: "in_progress", assignee_id: "u-dispatcher", assigned_by_id: "u-dispatcher", project_id: "p-1" };
    auth.current.userId = "u-dispatcher";
    const res = await PATCH(req({ status: "done" }), { params });
    expect(res.status).toBe(200);
    expect(completedNotifs()).toHaveLength(0);
  });

  it("no notification and no crash when assigned_by_id is null", async () => {
    state.task = { id: "t-1", title: "T", status: "in_progress", assignee_id: "u-assignee", assigned_by_id: null, project_id: null };
    auth.current.userId = "u-assignee";
    auth.current.role = "member";
    const res = await PATCH(req({ status: "done" }), { params });
    expect(res.status).toBe(200);
    expect(completedNotifs()).toHaveLength(0);
  });

  it("links to /home when the task has no project", async () => {
    state.task = { id: "t-1", title: "Loose task", status: "in_progress", assignee_id: "u-assignee", assigned_by_id: "u-dispatcher", project_id: null };
    auth.current.userId = "u-assignee";
    auth.current.role = "member";
    await PATCH(req({ status: "done" }), { params });
    expect(completedNotifs()[0]).toMatchObject({ link: "/home" });
  });
});

describe("PATCH /api/v1/tasks/:id — Slice B: transactional email is non-fatal", () => {
  it("email failure does not fail the PATCH and the in-app notification still writes", async () => {
    emailSpy.completed.mockRejectedValueOnce(new Error("resend down"));
    state.task = { id: "t-1", title: "T", status: "in_progress", assignee_id: "u-assignee", assigned_by_id: "u-dispatcher", project_id: "p-1" };
    auth.current.userId = "u-assignee";
    auth.current.role = "member";
    const res = await PATCH(req({ status: "done" }), { params });
    expect(res.status).toBe(200);
    expect(
      notifSpy.mock.calls.flatMap((c) => c[0] as { type: string }[]).some((n) => n.type === "task.completed"),
    ).toBe(true);
    await vi.waitFor(() => expect(emailSpy.completed).toHaveBeenCalled());
  });

  it("sends the assigned email when an admin assigns to someone else", async () => {
    state.task = { id: "t-1", title: "T", status: "todo", assignee_id: null, assigned_by_id: null, project_id: "p-1" };
    const res = await PATCH(req({ assignee_id: "11111111-1111-1111-1111-111111111111" }), { params });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(emailSpy.assigned).toHaveBeenCalled());
  });
});
