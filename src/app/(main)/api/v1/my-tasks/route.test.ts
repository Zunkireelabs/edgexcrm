import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

const authenticateRequestMock = vi.fn();
const scopedClientMock = vi.fn();
const createAuditLogMock = vi.fn(async () => {});
const emitEventMock = vi.fn(async () => "event-1");
const createNotificationsExceptMock = vi.fn(async () => {});

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));
vi.mock("@/lib/api/audit", () => ({
  createAuditLog: createAuditLogMock,
  emitEvent: emitEventMock,
}));
vi.mock("@/lib/notifications", () => ({
  NotificationTypes: { TASK_ASSIGNED: "task.assigned" },
  createNotificationsExcept: createNotificationsExceptMock,
}));
vi.mock("@/lib/supabase/queries", () => ({ resolveUserNames: vi.fn(async () => new Map()) }));

const FAKE_AUTH = { userId: "user-1", tenantId: "tenant-1", role: "owner" } as unknown as AuthContext;

function fakeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

interface FakeDbOptions {
  memberExists?: boolean;
  insertedTask?: Record<string, unknown>;
}

function fakeDb(opts: FakeDbOptions = {}) {
  const insertedRows: Record<string, unknown>[] = [];
  return {
    from: (table: string) => {
      if (table === "tenant_users") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.memberExists ? { user_id: "member-1" } : null }) }) }),
        };
      }
      if (table === "tasks") {
        return {
          insert: (row: Record<string, unknown>) => {
            insertedRows.push(row);
            return {
              select: () => ({
                single: async () => ({ data: opts.insertedTask ?? { id: "task-1", ...row }, error: null }),
              }),
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

describe("POST /api/v1/my-tasks — REST parity after createTaskForUser extraction", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset();
    scopedClientMock.mockReset();
    createAuditLogMock.mockClear();
    emitEventMock.mockClear();
    createNotificationsExceptMock.mockClear();
    authenticateRequestMock.mockResolvedValue(FAKE_AUTH);
  });

  it("happy path: creates a self-assigned task and returns 201 with the task row", async () => {
    const db = fakeDb();
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(fakeReq({ title: "Call back Aisha" }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data).toMatchObject({ title: "Call back Aisha", assignee_id: "user-1", assigned_by_id: null, status: "todo" });
    expect(emitEventMock).toHaveBeenCalledWith(expect.objectContaining({ type: "task.created" }));
  });

  it("validation reject: missing title returns 422 VALIDATION_ERROR", async () => {
    scopedClientMock.mockResolvedValue(fakeDb());

    const { POST } = await import("./route");
    const res = await POST(fakeReq({}));
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.title).toBeDefined();
  });

  it("assignee rule: assigning to a non-member returns a validation error, no task created", async () => {
    const db = fakeDb({ memberExists: false });
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(fakeReq({ title: "Follow up", assignee_id: "44444444-4444-4444-4444-444444444444" }));
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.details.assignee_id).toEqual(["Not a member of this tenant"]);
  });
});
