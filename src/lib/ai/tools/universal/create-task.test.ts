import { describe, it, expect, vi } from "vitest";
import type { AuthContext } from "@/lib/api/auth";
import type { ToolContext } from "../types";
import { createTaskTool } from "./create-task";

const { createTaskForUserMock } = vi.hoisted(() => ({ createTaskForUserMock: vi.fn() }));
vi.mock("@/lib/tasks/create-task", () => ({
  createTaskForUser: createTaskForUserMock,
  TASK_PRIORITIES: ["low", "normal", "high", "urgent"],
}));

function fixtureCtx(): ToolContext {
  return {
    auth: { userId: "user-1", tenantId: "tenant-1" } as AuthContext,
    db: {} as ToolContext["db"],
    logger: {} as ToolContext["logger"],
    runId: "run-1",
    conversationId: "conv-1",
  };
}

describe("create_task tool — input schema sanitize (junk-args guard)", () => {
  it("parses the NIL uuid assigneeId to undefined, not a real assignment", () => {
    const result = createTaskTool.inputSchema.parse({
      title: "x",
      assigneeId: "00000000-0000-0000-0000-000000000000",
    }) as { assigneeId?: string };
    expect(result.assigneeId).toBeUndefined();
  });

  it("parses an empty-string assigneeId to undefined", () => {
    const result = createTaskTool.inputSchema.parse({ title: "x", assigneeId: "" }) as { assigneeId?: string };
    expect(result.assigneeId).toBeUndefined();
  });

  it("parses the NIL uuid leadId to undefined", () => {
    const result = createTaskTool.inputSchema.parse({
      title: "x",
      leadId: "00000000-0000-0000-0000-000000000000",
    }) as { leadId?: string };
    expect(result.leadId).toBeUndefined();
  });

  it("parses a blank dueDate to undefined rather than an invalid-date rejection", () => {
    const result = createTaskTool.inputSchema.parse({ title: "x", dueDate: "" }) as { dueDate?: string };
    expect(result.dueDate).toBeUndefined();
  });

  it("rejects a title-less input", () => {
    const result = createTaskTool.inputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects a malformed dueDate that isn't blank", () => {
    const result = createTaskTool.inputSchema.safeParse({ title: "x", dueDate: "07/20/2026" });
    expect(result.success).toBe(false);
  });

  it("defaults priority to normal when omitted", () => {
    const result = createTaskTool.inputSchema.parse({ title: "x" }) as { priority?: string };
    expect(result.priority).toBe("normal");
  });
});

describe("create_task tool — execute() delegates to createTaskForUser", () => {
  it("maps camelCase tool input to the shared helper's snake_case shape and shapes a successful result", async () => {
    createTaskForUserMock.mockResolvedValueOnce({
      kind: "ok",
      notified: false,
      task: { id: "task-9", title: "Call Aisha", assignee_id: "user-1", due_date: "2026-07-20", lead_id: null },
    });

    const ctx = fixtureCtx();
    const result = await createTaskTool.execute(ctx, {
      title: "Call Aisha",
      priority: "normal",
      dueDate: "2026-07-20",
    } as never);

    expect(createTaskForUserMock).toHaveBeenCalledWith(
      ctx.db,
      ctx.auth,
      expect.objectContaining({ title: "Call Aisha", due_date: "2026-07-20" }),
      { requestId: "run-1" },
    );
    expect(result).toMatchObject({
      taskId: "task-9",
      title: "Call Aisha",
      assignedTo: "user-1",
      dueDate: "2026-07-20",
      leadId: null,
    });
  });

  it("returns a model-readable {error} on validation failure instead of throwing", async () => {
    createTaskForUserMock.mockResolvedValueOnce({ kind: "validation", errors: { title: ["title is required"] } });
    const ctx = fixtureCtx();
    const result = await createTaskTool.execute(ctx, { title: "x" } as never);
    expect(result).toEqual({ error: expect.stringContaining("title is required") });
  });

  it("returns a model-readable {error} on a db failure", async () => {
    createTaskForUserMock.mockResolvedValueOnce({ kind: "db_error" });
    const ctx = fixtureCtx();
    const result = await createTaskTool.execute(ctx, { title: "x" } as never);
    expect(result).toEqual({ error: expect.stringContaining("Failed to create the task") });
  });
});
