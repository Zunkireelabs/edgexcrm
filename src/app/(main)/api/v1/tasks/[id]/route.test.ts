import { describe, it, expect, vi, beforeEach } from "vitest";
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
  } as Record<string, string>,
}));

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: vi.fn(async () => auth.current),
  requireAdmin: (a: { role: string }) => a.role === "owner" || a.role === "admin",
}));

vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => true }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: vi.fn(), emitEvent: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  NotificationTypes: { TASK_ASSIGNED: "task_assigned" },
  createNotificationsExcept: vi.fn(),
}));

const state = vi.hoisted(() => ({
  task: {} as Record<string, unknown>,
  updateArgs: null as unknown,
}));

vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: vi.fn(async () => ({
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
  state.task = { id: "t-1", title: "T", assignee_id: "u-assignee", assigned_by_id: null, project_id: "p-1" };
  state.updateArgs = null;
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

  it("DELETE stays admin-only — a member (even the assignee) is forbidden", async () => {
    auth.current.userId = "u-assignee";
    auth.current.role = "member";
    const res = await DELETE({} as unknown as NextRequest, { params });
    expect(res.status).toBe(403);
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
