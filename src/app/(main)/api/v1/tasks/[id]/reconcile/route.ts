import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { recordProjectEvent } from "@/lib/projects/events";

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * Not itemized as its own endpoint in the Phase 1 brief's Slice 2 route
 * list, but the `task_reconciled` event (§2 of the brief) and the Slice 5
 * per-task "reconcile" UI action both require a route that emits it. Added
 * here alongside the rest of the event-emit seam.
 */
export async function POST(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/tasks/${id}/reconcile` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: task } = await db
    .from("tasks")
    .select("id, project_id, title, estimated_minutes")
    .eq("id", id)
    .maybeSingle();
  if (!task) return apiNotFound("Task");
  const taskRow = task as unknown as {
    project_id: string | null;
    title: string;
    estimated_minutes: number | null;
  };
  if (!taskRow.project_id) return apiError("NO_PROJECT", "Task is not attached to a project", 422);

  const { data: entries, error } = await db.from("time_entries").select("minutes").eq("task_id", id);
  if (error) {
    log.error({ error }, "Failed to fetch time entries for reconciliation");
    return apiError("DB_ERROR", "Failed to fetch time entries", 500);
  }

  const actualMinutes = ((entries ?? []) as unknown as Array<{ minutes: number }>).reduce((sum, e) => sum + e.minutes, 0);
  const estimatedMinutes = taskRow.estimated_minutes;
  const variancePct =
    estimatedMinutes && estimatedMinutes > 0
      ? Math.round(((actualMinutes - estimatedMinutes) / estimatedMinutes) * 1000) / 10
      : null;

  await recordProjectEvent(db, {
    projectId: taskRow.project_id,
    eventType: "task_reconciled",
    actorId: auth.userId,
    summary: `Reconciled "${taskRow.title}": ${estimatedMinutes ?? "?"}m est vs ${actualMinutes}m actual`,
    payload: { task_id: id, est_minutes: estimatedMinutes, actual_minutes: actualMinutes, variance_pct: variancePct },
    subjectType: "task",
    subjectId: id,
  });

  log.info({ taskId: id, actualMinutes, estimatedMinutes }, "Task reconciled");
  return apiSuccess({ task_id: id, estimated_minutes: estimatedMinutes, actual_minutes: actualMinutes, variance_pct: variancePct });
}
