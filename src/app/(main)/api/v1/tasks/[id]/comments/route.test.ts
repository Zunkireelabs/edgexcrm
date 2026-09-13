import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// Round 2 slice C Phase 2 (docs/IT-AGENCY-ROUND2-TASK-PANEL-BRIEF.md §5),
// modelled on ../route.test.ts.

const auth = vi.hoisted(() => ({
  current: { userId: "u-author", email: "author@x.co", tenantId: "tenant-A", role: "member", industryId: "it_agency" } as Record<
    string,
    unknown
  >,
}));

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: vi.fn(async () => auth.current),
  requireAdmin: (a: { role: string }) => a.role === "owner" || a.role === "admin",
}));

vi.mock("@/lib/api/audit", () => ({ createAuditLog: vi.fn() }));

const notifSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/notifications", () => ({
  NotificationTypes: { TASK_COMMENTED: "task.commented" },
  createNotificationsExcept: (actor: string | null, params: { userId: string }[]) => {
    notifSpy(params.filter((p) => p.userId !== actor));
    return Promise.resolve([]);
  },
}));

const state = vi.hoisted(() => ({
  task: null as Record<string, unknown> | null,
  comment: null as Record<string, unknown> | null,
  comments: [] as Record<string, unknown>[],
  insertArgs: null as unknown,
  deleteCalled: false,
}));

vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: vi.fn(async () => ({
    from: (table: string) => {
      if (table === "tasks") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.task }) }) }),
        };
      }
      // task_comments
      return {
        select: () => ({
          eq: (col: string) => {
            if (col === "task_id") {
              return { order: async () => ({ data: state.comments, error: null }) };
            }
            // eq("id", commentId)
            return { maybeSingle: async () => ({ data: state.comment }) };
          },
        }),
        insert: (row: unknown) => {
          state.insertArgs = row;
          return {
            select: () => ({
              single: async () => ({
                data: { id: "c-new", ...(row as object) },
                error: null,
              }),
            }),
          };
        },
        delete: () => ({
          eq: async () => {
            state.deleteCalled = true;
            return { error: null };
          },
        }),
      };
    },
  })),
}));

import { GET, POST } from "./route";
import { DELETE } from "./[commentId]/route";

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}
const params = Promise.resolve({ id: "t-1" });
const commentParams = Promise.resolve({ id: "t-1", commentId: "c-1" });

beforeEach(() => {
  auth.current = { userId: "u-author", email: "author@x.co", tenantId: "tenant-A", role: "member", industryId: "it_agency" };
  state.task = { id: "t-1", title: "Ship it", assignee_id: "u-assignee", assigned_by_id: "u-dispatcher" };
  state.comment = { id: "c-1", task_id: "t-1", author_id: "u-author" };
  state.comments = [];
  state.insertArgs = null;
  state.deleteCalled = false;
  notifSpy.mockClear();
});

describe("GET /api/v1/tasks/:id/comments", () => {
  it("404s when the task doesn't exist in this tenant", async () => {
    state.task = null;
    const res = await GET({} as NextRequest, { params });
    expect(res.status).toBe(404);
  });

  it("returns comments for a task in this tenant", async () => {
    state.comments = [{ id: "c-1", task_id: "t-1", author_id: "u-author", body: "hi", created_at: "2026-01-01" }];
    const res = await GET({} as NextRequest, { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
  });
});

describe("POST /api/v1/tasks/:id/comments", () => {
  it("400s on an empty body", async () => {
    const res = await POST(req({ body: "   " }), { params });
    expect(res.status).toBe(422);
  });

  it("400s on a body over 2000 chars", async () => {
    const res = await POST(req({ body: "x".repeat(2001) }), { params });
    expect(res.status).toBe(422);
  });

  it("404s when the task doesn't exist in this tenant", async () => {
    state.task = null;
    const res = await POST(req({ body: "hello" }), { params });
    expect(res.status).toBe(404);
  });

  it("a successful POST notifies the assignee and assigner and not the actor", async () => {
    auth.current.userId = "u-assignee";
    const res = await POST(req({ body: "client pushed the date" }), { params });
    expect(res.status).toBe(201);
    expect(notifSpy).toHaveBeenCalledTimes(1);
    const recipients = notifSpy.mock.calls[0][0] as { userId: string }[];
    expect(recipients.map((r) => r.userId)).toEqual(["u-dispatcher"]);
  });

  it("does not notify anyone when both assignee and assigner are null", async () => {
    state.task = { id: "t-1", title: "Loose", assignee_id: null, assigned_by_id: null };
    await POST(req({ body: "hello" }), { params });
    expect(notifSpy).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/v1/tasks/:id/comments/:commentId", () => {
  it("the author can delete their own comment", async () => {
    auth.current.userId = "u-author";
    auth.current.role = "member";
    const res = await DELETE({} as NextRequest, { params: commentParams });
    expect(res.status).toBe(200);
    expect(state.deleteCalled).toBe(true);
  });

  it("an admin can delete someone else's comment", async () => {
    auth.current.userId = "u-someone-else";
    auth.current.role = "admin";
    const res = await DELETE({} as NextRequest, { params: commentParams });
    expect(res.status).toBe(200);
  });

  it("a non-author, non-admin is forbidden", async () => {
    auth.current.userId = "u-stranger";
    auth.current.role = "member";
    const res = await DELETE({} as NextRequest, { params: commentParams });
    expect(res.status).toBe(403);
    expect(state.deleteCalled).toBe(false);
  });

  it("404s when the comment doesn't belong to the route's task id", async () => {
    state.comment = { id: "c-1", task_id: "t-OTHER", author_id: "u-author" };
    const res = await DELETE({} as NextRequest, { params: commentParams });
    expect(res.status).toBe(404);
  });
});
