import { z } from "zod";
import type { AgentTool } from "../types";
import { optionalString, optionalUuid } from "./lib/sanitize";
import { createTaskForUser, TASK_PRIORITIES } from "@/lib/tasks/create-task";

const inputSchema = z.object({
  title: z.string().min(1).max(255).describe("The task's title. Required."),
  description: optionalString(
    z.string().max(2000).optional().describe("Optional longer description/notes for the task."),
  ),
  priority: z
    .enum(TASK_PRIORITIES)
    .optional()
    .default("normal")
    .describe("One of low, normal, high, urgent. Defaults to normal."),
  dueDate: optionalString(
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
      .optional()
      .describe("Due date as YYYY-MM-DD. Omit if the user didn't give one."),
  ),
  leadId: optionalUuid(z.string().uuid().optional().describe("Link the task to this lead, if the conversation is about one.")),
  assigneeId: optionalUuid(
    z
      .string()
      .uuid()
      .optional()
      .describe(
        "The tenant user id to assign the task to. Omit unless the user explicitly names someone else — " +
          "never invent an assignee. Omitting assigns the task to the current user (self).",
      ),
  ),
});

type CreateTaskToolInput = z.infer<typeof inputSchema>;

export const createTaskTool: AgentTool<CreateTaskToolInput> = {
  id: "create_task",
  description:
    "Create a real task/to-do/reminder for the current user (or, if they name a teammate, for that teammate). " +
    "Call this directly when the user asks to be reminded of something, wants a follow-up tracked, or asks to " +
    "create a to-do — don't just describe the task in chat and wait; calling the tool IS how you propose it. " +
    "This is a write action: the user is shown the exact details and must approve before it runs; never claim " +
    "the task was created until the tool result confirms it.",
  inputSchema,
  scope: "write",
  async execute(ctx, input) {
    const { db, auth, runId } = ctx;

    const outcome = await createTaskForUser(
      db,
      auth,
      {
        title: input.title,
        description: input.description,
        priority: input.priority,
        due_date: input.dueDate,
        lead_id: input.leadId,
        assignee_id: input.assigneeId,
      },
      { requestId: runId },
    );

    if (outcome.kind === "validation") {
      const messages = Object.entries(outcome.errors)
        .map(([field, msgs]) => `${field}: ${msgs.join(", ")}`)
        .join("; ");
      return { error: `Could not create the task — ${messages}` };
    }
    if (outcome.kind === "db_error") {
      return { error: "Failed to create the task. Try again." };
    }

    const task = outcome.task as {
      id: string;
      title: string;
      assignee_id: string;
      due_date: string | null;
      lead_id: string | null;
    };

    return {
      taskId: task.id,
      title: task.title,
      assignedTo: task.assignee_id,
      dueDate: task.due_date,
      leadId: task.lead_id,
      note: `Task "${task.title}" created${task.due_date ? ` (due ${task.due_date})` : ""}.`,
    };
  },
};
