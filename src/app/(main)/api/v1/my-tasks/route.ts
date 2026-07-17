import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { resolveUserNames } from "@/lib/supabase/queries";
import { createTaskForUser } from "@/lib/tasks/create-task";
import type { TaskStatus, TaskPriority } from "@/types/database";

interface MyTask {
  id: string;
  status: TaskStatus;
  priority: TaskPriority;
  title: string;
  description: string | null;
  due_date: string | null;
  assignee_id: string | null;
  assigned_by_id: string | null;
  project_id: string | null;
  lead_id: string | null;
  deal_id: string | null;
  tenant_id: string;
  is_billable: boolean;
  position: number;
  tags: string[];
  created_at: string;
  updated_at: string;
  projects: { id: string; name: string } | null;
  leads: { id: string; first_name: string | null; last_name: string | null } | null;
  deals: { id: string; name: string } | null;
}

const TASK_STATUSES = ["todo", "in_progress", "done"];

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "GET", path: "/api/v1/my-tasks" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const { searchParams } = new URL(request.url);
  const rawStatus = searchParams.get("status");
  const statuses = rawStatus
    ? rawStatus.split(",").filter((s) => TASK_STATUSES.includes(s))
    : [];

  const db = await scopedClient(auth);

  let query = db
    .from("tasks")
    .select("*, projects(id, name), leads(id, first_name, last_name), deals(id, name)")
    .eq("assignee_id", auth.userId);

  if (statuses.length > 0) query = query.in("status", statuses);

  // scopedClient drops column inference — cast at call site per scoped.ts comment.
  const queryResult = await query
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (queryResult.error) {
    log.error({ error: queryResult.error }, "Failed to fetch my tasks");
    return apiError("DB_ERROR", "Failed to fetch tasks", 500);
  }

  const rawTasks = (queryResult.data ?? []) as unknown as MyTask[];
  const nameMap = await resolveUserNames(
    rawTasks.map((t) => t.assigned_by_id).filter((id): id is string => !!id)
  );
  const tasks = rawTasks.map((t) => ({
    ...t,
    assigned_by_name: t.assigned_by_id ? nameMap.get(t.assigned_by_id) ?? null : null,
  }));
  const open = tasks.filter((t) => t.status !== "done");
  const completed = tasks.filter((t) => t.status === "done").slice(0, 10);

  log.info({ open: open.length, completed: completed.length }, "My tasks fetched");
  return apiSuccess({ open, completed });
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/my-tasks" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const db = await scopedClient(auth);
  const outcome = await createTaskForUser(db, auth, body, { requestId });

  if (outcome.kind === "validation") {
    return apiValidationError(outcome.errors);
  }
  if (outcome.kind === "db_error") {
    log.error({ error: outcome.error }, "Failed to create task");
    return apiError("DB_ERROR", "Failed to create task", 500);
  }

  log.info({ taskId: outcome.task.id, assigneeId: outcome.task.assignee_id }, "Personal task created");
  return apiSuccess(outcome.task, 201);
}
