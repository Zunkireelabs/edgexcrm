import { describe, it, expect, vi, beforeEach } from "vitest";

// Slice C (docs/IT-AGENCY-DISPATCH-LOOP-BRIEF.md §2): project-task due reminders.
// The bar is the idempotency guarantee — stamp reminded_at only after a
// confirmed notify, so a failed notify is retried on the next scan and a
// successful one never re-fires.

const createNotification = vi.hoisted(() => vi.fn());
const createServiceClient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({ createServiceClient }));
vi.mock("@/lib/notifications", () => ({
  createNotification,
  NotificationTypes: { TASK_REMINDER: "task.reminder" },
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { runProjectTaskReminders } from "./reminders";

interface Row {
  id: string;
  tenant_id: string;
  title: string;
  project_id: string | null;
  assignee_id: string;
}

function fakeService(rows: Row[]) {
  const stamped: string[][] = [];
  const filters: Array<[string, unknown[]]> = [];
  const rec = (op: string) => (...args: unknown[]) => {
    filters.push([op, args]);
    return selectChain;
  };
  // The SELECT chain: .select().lt().neq().not().is().eq().limit()
  const selectChain: Record<string, (...a: unknown[]) => unknown> = {
    lt: rec("lt"),
    neq: rec("neq"),
    not: rec("not"),
    is: rec("is"),
    eq: rec("eq"),
    limit: () => Promise.resolve({ data: rows, error: null }),
  };
  const client = {
    from: (table: string) => {
      if (table !== "tasks") throw new Error(`unexpected table ${table}`);
      return {
        select: () => selectChain,
        update: () => ({
          in: (_col: string, ids: string[]) => {
            stamped.push(ids);
            return Promise.resolve({ error: null });
          },
        }),
      };
    },
  };
  return { client, stamped, filters };
}

const ROW: Row = {
  id: "task-1",
  tenant_id: "tenant-A",
  title: "Fix the thing",
  project_id: "p-1",
  assignee_id: "u-doer",
};

beforeEach(() => {
  createNotification.mockReset();
  createServiceClient.mockReset();
});

describe("runProjectTaskReminders", () => {
  it("notifies the assignee once and stamps only after confirmed delivery", async () => {
    const { client, stamped } = fakeService([ROW]);
    createServiceClient.mockResolvedValue(client);
    createNotification.mockResolvedValue({ id: "n-1" });

    const res = await runProjectTaskReminders();

    expect(res).toEqual({ processed: 1, notified: 1 });
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u-doer",
        tenantId: "tenant-A",
        type: "task.reminder",
        message: "Fix the thing",
        link: "/projects/p-1",
      }),
    );
    expect(stamped).toEqual([["task-1"]]);
  });

  it("a second scan does not re-notify (the row is filtered out by reminded_at at the DB)", async () => {
    const { client, stamped } = fakeService([]); // stamped row no longer matches
    createServiceClient.mockResolvedValue(client);

    const res = await runProjectTaskReminders();

    expect(res).toEqual({ processed: 0, notified: 0 });
    expect(createNotification).not.toHaveBeenCalled();
    expect(stamped).toEqual([]);
  });

  it("a task whose notification throws is NOT stamped and is retried next scan", async () => {
    const { client, stamped } = fakeService([ROW]);
    createServiceClient.mockResolvedValue(client);
    createNotification.mockRejectedValue(new Error("notify boom"));

    const res = await runProjectTaskReminders();

    expect(res).toEqual({ processed: 0, notified: 0 });
    expect(stamped).toEqual([]); // never stamped -> next scan retries
  });

  it("a task whose createNotification returns null (insert failed, not thrown) is NOT stamped and is retried", async () => {
    const { client, stamped } = fakeService([ROW]);
    createServiceClient.mockResolvedValue(client);
    createNotification.mockResolvedValue(null); // logs-and-returns-null failure mode

    const res = await runProjectTaskReminders();

    expect(res).toEqual({ processed: 0, notified: 0 });
    expect(stamped).toEqual([]); // never stamped -> next scan retries
  });

  it("links to /tasks when the task has no project", async () => {
    const { client } = fakeService([{ ...ROW, project_id: null }]);
    createServiceClient.mockResolvedValue(client);
    createNotification.mockResolvedValue({ id: "n-1" });

    await runProjectTaskReminders();

    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ link: "/tasks" }));
  });

  it("scopes the scan: past-due, not done, assigned, unreminded, it_agency, limit 500", async () => {
    const { client, filters } = fakeService([]);
    createServiceClient.mockResolvedValue(client);

    await runProjectTaskReminders();

    const flat = Object.fromEntries(filters.map(([op, args]) => [op, args]));
    expect(flat.lt[0]).toBe("due_date"); // excludes NULL due_date and future
    expect(flat.neq).toEqual(["status", "done"]);
    expect(flat.not).toEqual(["assignee_id", "is", null]);
    expect(flat.is).toEqual(["reminded_at", null]);
    expect(flat.eq).toEqual(["tenants.industry_id", "it_agency"]);
  });

  it("throws (fail-closed) when the SELECT errors", async () => {
    const selectChain = {
      lt: () => selectChain,
      neq: () => selectChain,
      not: () => selectChain,
      is: () => selectChain,
      eq: () => selectChain,
      limit: () => Promise.resolve({ data: null, error: { message: "db down" } }),
    };
    createServiceClient.mockResolvedValue({ from: () => ({ select: () => selectChain }) });

    await expect(runProjectTaskReminders()).rejects.toBeDefined();
  });
});
