import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { AuthContext } from "@/lib/api/auth";
import { createTaskForUser } from "./create-task";

const { createAuditLogMock, emitEventMock, createNotificationsExceptMock } = vi.hoisted(() => ({
  createAuditLogMock: vi.fn(async () => {}),
  emitEventMock: vi.fn(async () => "event-1"),
  createNotificationsExceptMock: vi.fn(async () => {}),
}));

vi.mock("@/lib/api/audit", () => ({
  createAuditLog: createAuditLogMock,
  emitEvent: emitEventMock,
}));
vi.mock("@/lib/notifications", () => ({
  NotificationTypes: { TASK_ASSIGNED: "task.assigned" },
  createNotificationsExcept: createNotificationsExceptMock,
}));

const USER_ID = "10000000-0000-0000-0000-000000000001";
const MEMBER_ID = "20000000-0000-0000-0000-000000000002";

function fixtureAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: USER_ID,
    email: "user1@example.com",
    tenantId: "tenant-1",
    role: "owner",
    industryId: "education_consultancy",
    positionId: null,
    positionSlug: null,
    branchId: null,
    branchMemberIds: [],
    permissions: {} as AuthContext["permissions"],
    plan: "free",
    entitlements: {} as AuthContext["entitlements"],
    ...overrides,
  };
}

interface FakeDbOptions {
  leadExists?: boolean;
  dealExists?: boolean;
  memberExists?: boolean;
  insertedTask?: Record<string, unknown>;
  insertError?: { message: string } | null;
}

function fakeDb(opts: FakeDbOptions = {}) {
  const insertedRows: Record<string, unknown>[] = [];

  const db = {
    from: (table: string) => {
      if (table === "leads") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.leadExists ? { id: "lead-1" } : null }) }) }) };
      }
      if (table === "deals") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.dealExists ? { id: "deal-1" } : null }) }) }) };
      }
      if (table === "tenant_users") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.memberExists ? { user_id: MEMBER_ID } : null }) }) }),
        };
      }
      if (table === "tasks") {
        return {
          insert: (row: Record<string, unknown>) => {
            insertedRows.push(row);
            return {
              select: () => ({
                single: async () => {
                  if (opts.insertError) return { data: null, error: opts.insertError };
                  return { data: opts.insertedTask ?? { id: "task-1", ...row }, error: null };
                },
              }),
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    fromGlobal: () => {
      throw new Error("not used in this test");
    },
    raw: () => {
      throw new Error("not used in this test");
    },
  } as unknown as ScopedClient;

  return { db, insertedRows };
}

beforeEach(() => {
  createAuditLogMock.mockClear();
  emitEventMock.mockClear();
  createNotificationsExceptMock.mockClear();
});

describe("createTaskForUser — validation", () => {
  it("rejects a missing title", async () => {
    const { db } = fakeDb();
    const outcome = await createTaskForUser(db, fixtureAuth(), {});
    expect(outcome.kind).toBe("validation");
    if (outcome.kind === "validation") expect(outcome.errors.title).toBeDefined();
  });

  it("rejects a title over 255 characters", async () => {
    const { db } = fakeDb();
    const outcome = await createTaskForUser(db, fixtureAuth(), { title: "x".repeat(256) });
    expect(outcome.kind).toBe("validation");
    if (outcome.kind === "validation") expect(outcome.errors.title).toBeDefined();
  });

  it("rejects a bad priority", async () => {
    const { db } = fakeDb();
    const outcome = await createTaskForUser(db, fixtureAuth(), { title: "Call back", priority: "urgentish" });
    expect(outcome.kind).toBe("validation");
    if (outcome.kind === "validation") expect(outcome.errors.priority).toBeDefined();
  });

  it("rejects a malformed due_date", async () => {
    const { db } = fakeDb();
    const outcome = await createTaskForUser(db, fixtureAuth(), { title: "Call back", due_date: "07/20/2026" });
    expect(outcome.kind).toBe("validation");
    if (outcome.kind === "validation") expect(outcome.errors.due_date).toBeDefined();
  });

  it("rejects a lead_id not found in this tenant (cross-tenant probe)", async () => {
    const { db } = fakeDb({ leadExists: false });
    const outcome = await createTaskForUser(db, fixtureAuth(), { title: "Call back", lead_id: "11111111-1111-1111-1111-111111111111" });
    expect(outcome.kind).toBe("validation");
    if (outcome.kind === "validation") expect(outcome.errors.lead_id).toEqual(["Lead not found in this tenant"]);
  });

  it("rejects a deal_id not found in this tenant", async () => {
    const { db } = fakeDb({ dealExists: false });
    const outcome = await createTaskForUser(db, fixtureAuth(), { title: "Call back", deal_id: "22222222-2222-2222-2222-222222222222" });
    expect(outcome.kind).toBe("validation");
    if (outcome.kind === "validation") expect(outcome.errors.deal_id).toEqual(["Deal not found in this tenant"]);
  });

  it("rejects an assignee_id that is not a member of this tenant", async () => {
    const { db } = fakeDb({ memberExists: false });
    const outcome = await createTaskForUser(db, fixtureAuth(), {
      title: "Call back",
      assignee_id: "33333333-3333-3333-3333-333333333333",
    });
    expect(outcome.kind).toBe("validation");
    if (outcome.kind === "validation") expect(outcome.errors.assignee_id).toEqual(["Not a member of this tenant"]);
  });
});

describe("createTaskForUser — happy paths", () => {
  it("defaults assignee to self and does not notify or set assigned_by_id", async () => {
    const { db, insertedRows } = fakeDb();
    const outcome = await createTaskForUser(db, fixtureAuth(), { title: "Call back" });

    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.notified).toBe(false);
    expect(insertedRows[0]).toMatchObject({ assignee_id: USER_ID, assigned_by_id: null, status: "todo", project_id: null, is_billable: false, position: 0 });
    expect(createNotificationsExceptMock).not.toHaveBeenCalled();
    expect(emitEventMock).toHaveBeenCalledWith(expect.objectContaining({ type: "task.created" }));
    expect(createAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({ action: "task.created", userId: USER_ID }));
  });

  it("delegating to another member sets assigned_by_id and notifies (TASK_ASSIGNED)", async () => {
    const { db, insertedRows } = fakeDb({ memberExists: true, insertedTask: { id: "task-2", title: "Follow up", assignee_id: MEMBER_ID, assigned_by_id: USER_ID, lead_id: null, deal_id: null } });
    const outcome = await createTaskForUser(db, fixtureAuth(), { title: "Follow up", assignee_id: MEMBER_ID });

    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.notified).toBe(true);
    expect(insertedRows[0]).toMatchObject({ assignee_id: MEMBER_ID, assigned_by_id: USER_ID });
    expect(createNotificationsExceptMock).toHaveBeenCalledTimes(1);
    // Param-less mock (avoids unused-param lint warnings); cast at the access
    // site instead — same pattern as the other tool test suites.
    const [actorId, notifications] = createNotificationsExceptMock.mock.calls[0] as unknown as [
      string | null,
      Array<Record<string, unknown>>,
    ];
    expect(actorId).toBe(USER_ID);
    expect(notifications[0]).toMatchObject({ userId: MEMBER_ID, type: "task.assigned" });
  });

  it("assigning to self explicitly (assignee_id === auth.userId) does not set assigned_by_id or notify", async () => {
    const { db, insertedRows } = fakeDb();
    const outcome = await createTaskForUser(db, fixtureAuth(), { title: "Call back", assignee_id: USER_ID });

    expect(outcome.kind).toBe("ok");
    if (outcome.kind !== "ok") return;
    expect(outcome.notified).toBe(false);
    expect(insertedRows[0]).toMatchObject({ assignee_id: USER_ID, assigned_by_id: null });
    expect(createNotificationsExceptMock).not.toHaveBeenCalled();
  });

  it("links a lead_id that exists in this tenant", async () => {
    const { db, insertedRows } = fakeDb({ leadExists: true });
    const outcome = await createTaskForUser(db, fixtureAuth(), { title: "Call back", lead_id: "11111111-1111-1111-1111-111111111111" });
    expect(outcome.kind).toBe("ok");
    expect(insertedRows[0]).toMatchObject({ lead_id: "11111111-1111-1111-1111-111111111111" });
  });
});

describe("createTaskForUser — db error", () => {
  it("returns a db_error outcome carrying the Postgrest error when the insert fails", async () => {
    const { db } = fakeDb({ insertError: { message: "boom" } });
    const outcome = await createTaskForUser(db, fixtureAuth(), { title: "Call back" });
    expect(outcome.kind).toBe("db_error");
    if (outcome.kind === "db_error") expect(outcome.error).toEqual({ message: "boom" });
  });
});
