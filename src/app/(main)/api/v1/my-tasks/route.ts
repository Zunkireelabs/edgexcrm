import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { validate, required, maxLength, optionalMaxLength, isIn } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import type { TaskStatus, TaskPriority } from "@/types/database";

interface MyTask {
  id: string;
  status: TaskStatus;
  priority: TaskPriority;
  title: string;
  description: string | null;
  due_date: string | null;
  assignee_id: string | null;
  project_id: string | null;
  lead_id: string | null;
  tenant_id: string;
  is_billable: boolean;
  position: number;
  tags: string[];
  created_at: string;
  updated_at: string;
  projects: { id: string; name: string } | null;
  leads: { id: string; first_name: string | null; last_name: string | null } | null;
}

const TASK_STATUSES = ["todo", "in_progress", "done"];
const TASK_PRIORITIES = ["low", "normal", "high", "urgent"];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    .select("*, projects(id, name), leads(id, first_name, last_name)")
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

  const tasks = (queryResult.data ?? []) as unknown as MyTask[];
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

  const validationErrors: Record<string, string[]> = {};

  const { valid, errors } = validate(body, {
    title: [required("title"), maxLength(255)],
    description: [optionalMaxLength(2000)],
    priority: [isIn(TASK_PRIORITIES)],
  });
  Object.assign(validationErrors, errors);

  if (body.due_date !== undefined && body.due_date !== null) {
    if (typeof body.due_date !== "string" || !ISO_DATE_RE.test(body.due_date)) {
      validationErrors.due_date = ["Must be a valid ISO date YYYY-MM-DD or null"];
    }
  }

  if (body.lead_id !== undefined && body.lead_id !== null) {
    if (typeof body.lead_id !== "string" || !UUID_RE.test(body.lead_id)) {
      validationErrors.lead_id = ["Must be a valid UUID or null"];
    }
  }

  if (!valid || Object.keys(validationErrors).length > 0) {
    return apiValidationError(validationErrors);
  }

  const db = await scopedClient(auth);

  if (body.lead_id) {
    const { data: lead } = await db
      .from("leads")
      .select("id")
      .eq("id", body.lead_id as string)
      .maybeSingle();
    if (!lead) {
      return apiValidationError({ lead_id: ["Lead not found in this tenant"] });
    }
  }

  const insert = {
    title: String(body.title).trim(),
    description: body.description ? String(body.description).trim() : null,
    priority: body.priority ? String(body.priority) : "normal",
    due_date: body.due_date ? String(body.due_date) : null,
    lead_id: body.lead_id ? String(body.lead_id) : null,
    project_id: null,
    status: "todo",
    assignee_id: auth.userId,
    is_billable: false,
    position: 0,
  };

  const { data: task, error } = await db
    .from("tasks")
    .insert(insert)
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to create task");
    return apiError("DB_ERROR", "Failed to create task", 500);
  }

  await Promise.all([
    emitEvent({
      tenantId: auth.tenantId,
      type: "task.created",
      entityType: "task",
      entityId: task.id,
      requestId,
    }),
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "task.created",
      entityType: "task",
      entityId: task.id,
      requestId,
    }),
  ]);

  log.info({ taskId: task.id }, "Personal task created");
  return apiSuccess(task, 201);
}
