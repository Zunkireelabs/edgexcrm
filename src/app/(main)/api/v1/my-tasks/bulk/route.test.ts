import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

// POST /api/v1/my-tasks/bulk — Round 2 slice E batch task creation
// (docs/IT-AGENCY-ROUND2-SLICE-E-CAPTURE-BRIEF.md §3.4, §4). Exercises the
// real createTaskCore / createProjectTaskCore through a fake ScopedClient so
// the bulk route's own orchestration (validate-first, single notification,
// single digest email) is proven against real core behavior, not a stub.

const authenticateRequestMock = vi.fn();
const scopedClientMock = vi.fn();
const getFeatureAccessMock = vi.fn(() => true);
const createAuditLogMock = vi.fn(async () => {});
const emitEventMock = vi.fn(async () => "event-1");
const createNotificationsExceptMock = vi.fn(async () => {});
const notifyTaskAssignedMock = vi.fn();
const notifyTasksAssignedBatchMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: getFeatureAccessMock }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: createAuditLogMock, emitEvent: emitEventMock }));
vi.mock("@/lib/notifications", () => ({
  NotificationTypes: { TASK_ASSIGNED: "task.assigned" },
  createNotificationsExcept: createNotificationsExceptMock,
}));
vi.mock("@/lib/tasks/dispatch-notify", () => ({
  notifyTaskAssigned: notifyTaskAssignedMock,
  notifyTasksAssignedBatch: notifyTasksAssignedBatchMock,
}));

const USER_ID = "10000000-0000-0000-0000-000000000001";
const OTHER_MEMBER_ID = "20000000-0000-0000-0000-000000000002";
const PROJECT_ID = "30000000-0000-0000-0000-000000000003";
const NONMEMBER_ID = "40000000-0000-0000-0000-000000000004";
const NO_PROJECT_ID = "50000000-0000-0000-0000-000000000005";

const FAKE_AUTH = {
  userId: USER_ID,
  email: "user1@example.com",
  tenantId: "tenant-1",
  role: "owner",
  industryId: "it_agency",
  permissions: { canManageBilling: true },
} as unknown as AuthContext;

function fakeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

interface FakeDbOptions {
  /** 1-based index (in insertion order) at which the tasks insert should fail. */
  failAtInsertNumber?: number;
}

function fakeDb(opts: FakeDbOptions = {}) {
  const insertedRows: Record<string, unknown>[] = [];
  let insertCount = 0;

  const db = {
    from: (table: string) => {
      if (table === "tenant_users") {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: async () => ({ data: val === OTHER_MEMBER_ID ? { user_id: OTHER_MEMBER_ID } : null }),
            }),
          }),
        };
      }
      if (table === "projects") {
        return {
          select: () => ({
            eq: (_col: string, val: string) => ({
              maybeSingle: async () => ({ data: val === PROJECT_ID ? { id: PROJECT_ID } : null }),
            }),
          }),
        };
      }
      if (table === "tasks") {
        return {
          insert: (row: Record<string, unknown>) => {
            insertCount += 1;
            return {
              select: () => ({
                single: async () => {
                  if (opts.failAtInsertNumber && insertCount >= opts.failAtInsertNumber) {
                    return { data: null, error: { message: "db down" } };
                  }
                  const task = { id: `task-${insertCount}`, ...row };
                  insertedRows.push(task);
                  return { data: task, error: null };
                },
              }),
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    raw: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }),
        }),
      }),
    }),
  };

  return { db, insertedRows };
}

beforeEach(() => {
  authenticateRequestMock.mockReset();
  scopedClientMock.mockReset();
  getFeatureAccessMock.mockReset().mockReturnValue(true);
  createAuditLogMock.mockClear();
  emitEventMock.mockClear();
  createNotificationsExceptMock.mockClear();
  notifyTaskAssignedMock.mockClear();
  notifyTasksAssignedBatchMock.mockClear();
  authenticateRequestMock.mockResolvedValue(FAKE_AUTH);
});

describe("POST /api/v1/my-tasks/bulk — validation (writes nothing)", () => {
  it("rejects 26 titles", async () => {
    const { db } = fakeDb();
    scopedClientMock.mockResolvedValue(db);
    const { POST } = await import("./route");

    const titles = Array.from({ length: 26 }, (_, i) => `Task ${i + 1}`);
    const res = await POST(fakeReq({ titles }));
    expect(res.status).toBe(422);
    expect(createAuditLogMock).not.toHaveBeenCalled();
  });

  it("rejects an empty title inside the batch", async () => {
    const { db } = fakeDb();
    scopedClientMock.mockResolvedValue(db);
    const { POST } = await import("./route");

    const res = await POST(fakeReq({ titles: ["Call vendor", "   ", "Send invoice"] }));
    expect(res.status).toBe(422);
    expect(createAuditLogMock).not.toHaveBeenCalled();
  });

  it("rejects a foreign (non-tenant) assignee", async () => {
    const { db } = fakeDb();
    scopedClientMock.mockResolvedValue(db);
    const { POST } = await import("./route");

    const res = await POST(fakeReq({ titles: ["Call vendor"], assignee_id: NONMEMBER_ID }));
    expect(res.status).toBe(422);
    expect(createAuditLogMock).not.toHaveBeenCalled();
  });

  it("rejects a foreign (non-tenant) project", async () => {
    const { db } = fakeDb();
    scopedClientMock.mockResolvedValue(db);
    const { POST } = await import("./route");

    const res = await POST(fakeReq({ titles: ["Call vendor"], project_id: NO_PROJECT_ID }));
    expect(res.status).toBe(422);
    expect(createAuditLogMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/my-tasks/bulk — personal batch", () => {
  it("a batch for someone else sends exactly one notification and one digest call", async () => {
    const { db } = fakeDb();
    scopedClientMock.mockResolvedValue(db);
    const { POST } = await import("./route");

    const res = await POST(
      fakeReq({ titles: ["Call vendor", "Send invoice", "Book flights"], assignee_id: OTHER_MEMBER_ID }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.created).toHaveLength(3);
    expect(body.data.failed).toBe(0);
    expect(createNotificationsExceptMock).toHaveBeenCalledTimes(1);
    const [, notifications] = createNotificationsExceptMock.mock.calls[0] as unknown as [unknown, Array<Record<string, unknown>>];
    expect(notifications[0]).toMatchObject({ userId: OTHER_MEMBER_ID, title: "3 new tasks assigned" });
    expect(notifyTasksAssignedBatchMock).toHaveBeenCalledTimes(1);
    const [, batchOpts] = notifyTasksAssignedBatchMock.mock.calls[0] as unknown as [unknown, { titles: string[]; assigneeUserId: string }];
    expect(batchOpts.titles).toEqual(["Call vendor", "Send invoice", "Book flights"]);
    expect(batchOpts.assigneeUserId).toBe(OTHER_MEMBER_ID);
    // Per-task notify must be suppressed — only the batch call fires.
    expect(notifyTaskAssignedMock).not.toHaveBeenCalled();
  });

  it("a self-assigned batch sends no notification and no digest email", async () => {
    const { db } = fakeDb();
    scopedClientMock.mockResolvedValue(db);
    const { POST } = await import("./route");

    const res = await POST(fakeReq({ titles: ["Task one", "Task two"] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.created).toHaveLength(2);
    expect(createNotificationsExceptMock).not.toHaveBeenCalled();
    expect(notifyTasksAssignedBatchMock).not.toHaveBeenCalled();
  });

  it("a mid-batch DB error stops and returns {created, failed}", async () => {
    const { db } = fakeDb({ failAtInsertNumber: 2 });
    scopedClientMock.mockResolvedValue(db);
    const { POST } = await import("./route");

    const res = await POST(fakeReq({ titles: ["Task one", "Task two", "Task three"] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.created).toHaveLength(1);
    expect(body.data.failed).toBe(2);
  });
});

describe("POST /api/v1/my-tasks/bulk — project batch", () => {
  it("goes through createProjectTaskCore, gated by ACCOUNTS feature access", async () => {
    getFeatureAccessMock.mockReturnValue(false);
    const { db } = fakeDb();
    scopedClientMock.mockResolvedValue(db);
    const { POST } = await import("./route");

    const res = await POST(fakeReq({ titles: ["Ship it"], project_id: PROJECT_ID }));
    expect(res.status).toBe(403);
  });

  it("creates project-linked tasks when the gate passes", async () => {
    getFeatureAccessMock.mockReturnValue(true);
    const { db, insertedRows } = fakeDb();
    scopedClientMock.mockResolvedValue(db);
    const { POST } = await import("./route");

    const res = await POST(fakeReq({ titles: ["Ship it", "Test it"], project_id: PROJECT_ID }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.created).toHaveLength(2);
    expect(insertedRows.every((r) => r.project_id === PROJECT_ID)).toBe(true);
  });
});
