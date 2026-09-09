import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// Round 1 Slice A on the doer's primary surface: the Home "My Tasks" widget and
// the /tasks page both PATCH /api/v1/my-tasks/[id] (not /api/v1/tasks/[id],
// which the brief named). Completion must close the dispatch loop here too.

const auth = vi.hoisted(() => ({
  current: { userId: "u-doer", email: "doer@x.co", tenantId: "tenant-A", role: "member", industryId: "it_agency" } as Record<string, unknown>,
}));
vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: vi.fn(async () => auth.current),
  requireAdmin: (a: { role: string }) => a.role === "owner" || a.role === "admin",
}));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: vi.fn(), emitEvent: vi.fn() }));

const notifSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/notifications", () => ({
  NotificationTypes: { TASK_ASSIGNED: "task.assigned", TASK_COMPLETED: "task.completed" },
  createNotificationsExcept: (actor: string | null, params: { userId: string }[]) => {
    notifSpy(params.filter((p) => p.userId !== actor));
    return Promise.resolve([]);
  },
}));
const dispatchSpy = vi.hoisted(() => ({ assigned: vi.fn(), completed: vi.fn() }));
vi.mock("@/lib/tasks/dispatch-notify", () => ({
  notifyTaskAssigned: (...a: unknown[]) => dispatchSpy.assigned(...a),
  notifyTaskCompleted: (...a: unknown[]) => dispatchSpy.completed(...a),
}));

const state = vi.hoisted(() => ({ task: {} as Record<string, unknown> }));
vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: vi.fn(async () => ({
    from: (table: string) => {
      if (table === "tenant_users") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { user_id: "u-other" } }) }) }) };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.task }) }) }),
        update: (patch: object) => ({
          eq: () => ({ select: () => ({ single: async () => ({ data: { ...state.task, ...patch }, error: null }) }) }),
        }),
      };
    },
  })),
}));

import { PATCH } from "./route";

const req = (body: unknown) => ({ json: async () => body, url: "http://localhost/api/v1/my-tasks/t-1" }) as unknown as NextRequest;
const params = Promise.resolve({ id: "t-1" });

beforeEach(() => {
  auth.current = { userId: "u-doer", email: "doer@x.co", tenantId: "tenant-A", role: "member", industryId: "it_agency" };
  state.task = { id: "t-1", title: "T", status: "in_progress", assignee_id: "u-doer", assigned_by_id: "u-dispatch", lead_id: null, deal_id: null, project_id: "p-1" };
  notifSpy.mockClear();
  dispatchSpy.assigned.mockClear();
  dispatchSpy.completed.mockClear();
});

describe("PATCH /api/v1/my-tasks/:id — dispatch loop", () => {
  it("fires TASK_COMPLETED once to the assigner on → done", async () => {
    const res = await PATCH(req({ status: "done" }), { params });
    expect(res.status).toBe(200);
    expect(dispatchSpy.completed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ assignedById: "u-dispatch", taskTitle: "T", projectId: "p-1" }),
    );
  });

  it("does not fire when the task was already done", async () => {
    state.task = { ...state.task, status: "done" };
    const res = await PATCH(req({ status: "done" }), { params });
    expect(res.status).toBe(200);
    expect(dispatchSpy.completed).not.toHaveBeenCalled();
  });

  it("does not fire and does not crash when assigned_by_id is null", async () => {
    state.task = { ...state.task, assigned_by_id: null };
    const res = await PATCH(req({ status: "done" }), { params });
    expect(res.status).toBe(200);
    expect(dispatchSpy.completed).not.toHaveBeenCalled();
  });
});
