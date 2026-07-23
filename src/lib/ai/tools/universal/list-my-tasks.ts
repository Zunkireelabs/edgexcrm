import { z } from "zod";
import { assertUserAuth } from "@/lib/ai/agent-auth";
import type { AgentTool } from "../types";
import { optionalUuid } from "./lib/sanitize";

const inputSchema = z.object({
  forUserId: optionalUuid(
    z
      .string()
      .uuid()
      .optional()
      .describe("Look up a specific teammate's tasks by user id — only honored for owner/admin callers, otherwise ignored"),
  ),
  status: z.enum(["todo", "in_progress", "done"]).optional(),
  limit: z.number().int().min(1).max(20).default(20),
});

export const listMyTasksTool: AgentTool<z.infer<typeof inputSchema>> = {
  id: "list_my_tasks",
  description:
    "List due/overdue/open tasks for the current user (or, if owner/admin, for a named teammate). " +
    "Use for questions like \"what's on my plate\" or \"what does X still need to do\".",
  inputSchema,
  scope: "read",
  async execute(ctx, input) {
    const { db, auth } = ctx;
    assertUserAuth(auth);

    const isAdmin = auth.permissions.baseTier === "owner" || auth.permissions.baseTier === "admin";
    const assigneeId = input.forUserId && isAdmin ? input.forUserId : auth.userId;

    let query = db
      .from("tasks")
      .select("id, title, status, priority, due_date, lead_id, deal_id, created_at")
      .eq("assignee_id", assigneeId);

    if (input.status) query = query.eq("status", input.status);

    const { data, error } = await query
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(input.limit);

    if (error) return { error: "Failed to fetch tasks." };

    const rows = (data ?? []) as unknown as Array<{
      id: string;
      title: string;
      status: string;
      priority: string;
      due_date: string | null;
      lead_id: string | null;
      deal_id: string | null;
      created_at: string;
    }>;

    return {
      forUserId: assigneeId,
      tasks: rows.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        dueDate: t.due_date,
        createdAt: t.created_at,
        href: t.lead_id ? `/leads/${t.lead_id}` : t.deal_id ? `/deals/${t.deal_id}` : null,
      })),
    };
  },
};
