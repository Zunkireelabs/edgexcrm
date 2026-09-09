import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared dispatch-loop side-effects (Round 1). The bar: email is best-effort
// (never throws), self-pings are suppressed, and the tenant-level gate is the
// only switch.

const createNotificationsExcept = vi.hoisted(() => vi.fn());
const sendTaskAssignedEmail = vi.hoisted(() => vi.fn(async () => ({ success: true })));
const sendTaskCompletedEmail = vi.hoisted(() => vi.fn(async () => ({ success: true })));
const isTaskEmailEnabled = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/lib/notifications", () => ({
  createNotificationsExcept,
  NotificationTypes: { TASK_COMPLETED: "task.completed", TASK_ASSIGNED: "task.assigned" },
}));
vi.mock("@/lib/email/send-task-assigned", () => ({ sendTaskAssignedEmail, sendTaskCompletedEmail }));
vi.mock("@/lib/email/task-email-gate", () => ({ isTaskEmailEnabled }));

import { notifyTaskAssigned, notifyTaskCompleted } from "./dispatch-notify";

function ctx(overrides: Record<string, unknown> = {}) {
  return {
    db: {
      raw: () => ({
        auth: { admin: { getUserById: async () => ({ data: { user: { email: "doer@x.co" } } }) } },
        from: () => ({
          select: () => ({
            eq: () => ({ single: async () => ({ data: { name: "Zunkiree", primary_color: null } }) }),
          }),
        }),
      }),
    },
    log: { warn: vi.fn(), error: vi.fn() },
    tenantId: "tenant-A",
    actorUserId: "u-actor",
    actorEmail: "actor@x.co",
    industryId: "it_agency",
    ...overrides,
  } as never;
}

beforeEach(() => {
  createNotificationsExcept.mockClear();
  sendTaskAssignedEmail.mockClear();
  sendTaskCompletedEmail.mockClear();
  isTaskEmailEnabled.mockReturnValue(true);
});

describe("notifyTaskCompleted", () => {
  it("writes the in-app notification and sends the completed email to the assigner", async () => {
    notifyTaskCompleted(ctx(), { taskId: "t1", taskTitle: "Ship", assignedById: "u-dispatch", projectId: "p1" });
    expect(createNotificationsExcept).toHaveBeenCalledWith("u-actor", [
      expect.objectContaining({ userId: "u-dispatch", type: "task.completed", link: "/projects/p1" }),
    ]);
    await vi.waitFor(() => expect(sendTaskCompletedEmail).toHaveBeenCalled());
  });

  it("links to /tasks when there is no project", () => {
    notifyTaskCompleted(ctx(), { taskId: "t1", taskTitle: "Ship", assignedById: "u-dispatch", projectId: null });
    expect(createNotificationsExcept.mock.calls[0][1][0]).toMatchObject({ link: "/tasks" });
  });

  it("does not email when the assigner is the actor (self-completion)", async () => {
    notifyTaskCompleted(ctx(), { taskId: "t1", taskTitle: "Ship", assignedById: "u-actor", projectId: "p1" });
    await new Promise((r) => setTimeout(r, 10));
    expect(sendTaskCompletedEmail).not.toHaveBeenCalled();
  });

  it("does not email when the tenant gate is off, but still writes the in-app notification", async () => {
    isTaskEmailEnabled.mockReturnValue(false);
    notifyTaskCompleted(ctx({ industryId: "education_consultancy" }), {
      taskId: "t1",
      taskTitle: "Ship",
      assignedById: "u-dispatch",
      projectId: "p1",
    });
    expect(createNotificationsExcept).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 10));
    expect(sendTaskCompletedEmail).not.toHaveBeenCalled();
  });

  it("a throwing email sender never propagates", async () => {
    sendTaskCompletedEmail.mockRejectedValueOnce(new Error("resend down"));
    const c = ctx();
    expect(() =>
      notifyTaskCompleted(c, { taskId: "t1", taskTitle: "Ship", assignedById: "u-dispatch", projectId: "p1" }),
    ).not.toThrow();
    await vi.waitFor(() => expect((c as { log: { error: ReturnType<typeof vi.fn> } }).log.error).toHaveBeenCalled());
  });
});

describe("notifyTaskAssigned", () => {
  it("sends the assigned email to the new assignee", async () => {
    notifyTaskAssigned(ctx(), { taskId: "t1", taskTitle: "Ship", assigneeUserId: "u-new", taskPath: "/projects/p1" });
    await vi.waitFor(() => expect(sendTaskAssignedEmail).toHaveBeenCalled());
  });

  it("never emails the actor", async () => {
    notifyTaskAssigned(ctx(), { taskId: "t1", taskTitle: "Ship", assigneeUserId: "u-actor", taskPath: "/tasks" });
    await new Promise((r) => setTimeout(r, 10));
    expect(sendTaskAssignedEmail).not.toHaveBeenCalled();
  });
});
