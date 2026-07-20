import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
  apiConflict,
} from "@/lib/api/response";
import { validate, required, isUUID } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog } from "@/lib/api/audit";

const ACTIVE_TIMER_SELECT =
  "id, task_id, project_id, started_at, created_at, tasks(id, title), projects(id, name, accounts(id, name))";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.TIME_TRACKING)) return apiForbidden();

  const db = await scopedClient(auth);
  const { searchParams } = new URL(request.url);

  // Default to the caller's own timers. An admin may inspect a specific user's
  // timers via ?user_id=, but the unfiltered default stays own-scoped so a
  // personal running-timers panel never surfaces (or lets you stop) other
  // users' timers.
  const isAdmin = requireAdmin(auth);
  const requestedUserId = searchParams.get("user_id");
  const userIdParam = isAdmin && requestedUserId ? requestedUserId : auth.userId;

  const query = db
    .from("active_timers")
    .select(ACTIVE_TIMER_SELECT)
    .eq("user_id", userIdParam);

  const { data, error } = await query.order("started_at", { ascending: true });
  if (error) return apiError("DB_ERROR", "Failed to fetch active timers", 500);

  return apiSuccess(data ?? []);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/timers" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.TIME_TRACKING)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    task_id: [required("task_id"), isUUID()],
  });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);

  const { data: task } = await db
    .from("tasks")
    .select("id, project_id, is_billable, title")
    .eq("id", String(body.task_id))
    .maybeSingle();
  if (!task) return apiNotFound("Task");

  const taskRow = task as unknown as { id: string; project_id: string | null };
  if (taskRow.project_id == null) {
    return apiError("NO_PROJECT", "Task is not attached to a project", 422);
  }

  const { data: created, error } = await db
    .from("active_timers")
    .insert({
      user_id: auth.userId,
      task_id: taskRow.id,
      project_id: taskRow.project_id,
    })
    .select(ACTIVE_TIMER_SELECT)
    .single();

  if (error) {
    // Unique violation on (user_id, task_id): a timer is already running for this task.
    if ((error as { code?: string }).code === "23505") {
      return apiConflict("A timer is already running for this task");
    }
    log.error({ error }, "Failed to start timer");
    return apiError("DB_ERROR", "Failed to start timer", 500);
  }

  await createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "timer.started",
    entityType: "active_timer",
    entityId: (created as { id: string }).id,
    requestId,
  });

  log.info({ timerId: (created as { id: string }).id, taskId: taskRow.id }, "Timer started");
  return apiSuccess(created, 201);
}
