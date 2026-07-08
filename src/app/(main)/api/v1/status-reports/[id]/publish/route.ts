import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError, apiConflict } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { recordProjectEvent } from "@/lib/projects/events";
import { computeProjectHealth, computePctComplete } from "@/lib/projects/health";

interface Props {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/status-reports/${id}/publish` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: existing } = await db
    .from("project_status_reports")
    .select("id, project_id, published_at")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Status report");
  const existingRow = existing as unknown as { project_id: string; published_at: string | null };
  if (existingRow.published_at) return apiConflict("Status report already published");

  const { data: project } = await db
    .from("projects")
    .select("health_override, current_estimate_minutes, target_end_date")
    .eq("id", existingRow.project_id)
    .maybeSingle();
  const projectRow = project as unknown as {
    health_override: string | null;
    current_estimate_minutes: number | null;
    target_end_date: string | null;
  } | null;

  const [{ data: tasks }, { data: timeEntries }] = await Promise.all([
    db.from("tasks").select("status, estimated_minutes").eq("project_id", existingRow.project_id),
    db.from("time_entries").select("minutes").eq("project_id", existingRow.project_id),
  ]);

  const taskRows = (tasks ?? []) as unknown as Array<{ status: string; estimated_minutes: number | null }>;
  const pctComplete = computePctComplete(
    taskRows.map((t) => ({ status: t.status, estimatedMinutes: t.estimated_minutes }))
  );
  const actualMinutes = ((timeEntries ?? []) as unknown as Array<{ minutes: number }>).reduce((sum, e) => sum + e.minutes, 0);
  const health = computeProjectHealth({
    healthOverride: (projectRow?.health_override as "green" | "amber" | "red" | null) ?? null,
    actualMinutes,
    currentEstimateMinutes: projectRow?.current_estimate_minutes ?? null,
    targetEndDate: projectRow?.target_end_date ?? null,
    pctComplete,
  });
  const hoursActual = Math.round(actualMinutes / 60);
  const hoursEstimate = Math.round((projectRow?.current_estimate_minutes ?? 0) / 60);

  const { data: updated, error } = await db
    .from("project_status_reports")
    .update({
      health_snapshot: health,
      pct_complete_snapshot: pctComplete,
      hours_actual_snapshot: hoursActual,
      hours_estimate_snapshot: hoursEstimate,
      published_at: new Date().toISOString(),
      published_by: auth.userId,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to publish status report");
    return apiError("DB_ERROR", "Failed to publish status report", 500);
  }

  await recordProjectEvent(db, {
    projectId: existingRow.project_id,
    eventType: "status_published",
    actorId: auth.userId,
    summary: `Status published: ${health} · ${pctComplete}% complete`,
    payload: {
      status_report_id: id,
      health,
      pct_complete: pctComplete,
      hours_actual: hoursActual,
      hours_estimate: hoursEstimate,
    },
    subjectType: "status_report",
    subjectId: id,
  });

  log.info({ statusReportId: id, health, pctComplete }, "Status report published");
  return apiSuccess(updated);
}
