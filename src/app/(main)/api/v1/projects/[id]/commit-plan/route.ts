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

export async function POST(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/projects/${id}/commit-plan` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: project } = await db.from("projects").select("id").eq("id", id).maybeSingle();
  if (!project) return apiNotFound("Project");

  const { data: tasks, error } = await db
    .from("tasks")
    .select("estimated_minutes")
    .eq("project_id", id);
  if (error) {
    log.error({ error }, "Failed to fetch tasks for plan commit");
    return apiError("DB_ERROR", "Failed to fetch tasks", 500);
  }

  const taskRows = (tasks ?? []) as unknown as Array<{ estimated_minutes: number | null }>;
  const taskCount = taskRows.length;
  const plannedMinutes = taskRows.reduce((sum, t) => sum + (t.estimated_minutes ?? 0), 0);

  await recordProjectEvent(db, {
    projectId: id,
    eventType: "plan_committed",
    actorId: auth.userId,
    summary: `Plan committed: ${taskCount} task${taskCount === 1 ? "" : "s"}, ${Math.round(plannedMinutes / 60)}h planned`,
    payload: { task_count: taskCount, planned_minutes: plannedMinutes },
  });

  log.info({ projectId: id, taskCount, plannedMinutes }, "Plan committed");
  return apiSuccess({ task_count: taskCount, planned_minutes: plannedMinutes });
}
