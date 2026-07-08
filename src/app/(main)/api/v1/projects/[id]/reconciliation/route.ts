import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: project } = await db
    .from("projects")
    .select("id, current_estimate_minutes")
    .eq("id", id)
    .maybeSingle();
  if (!project) return apiNotFound("Project");
  const projectRow = project as unknown as { current_estimate_minutes: number | null };

  const [{ data: tasks, error: tasksError }, { data: timeEntries, error: entriesError }] = await Promise.all([
    db.from("tasks").select("id, title, status, estimated_minutes").eq("project_id", id),
    db.from("time_entries").select("task_id, minutes").eq("project_id", id),
  ]);
  if (tasksError || entriesError) return apiError("DB_ERROR", "Failed to fetch reconciliation data", 500);

  const taskRows = (tasks ?? []) as unknown as Array<{
    id: string;
    title: string;
    status: string;
    estimated_minutes: number | null;
  }>;
  const entryRows = (timeEntries ?? []) as unknown as Array<{ task_id: string | null; minutes: number }>;

  const actualByTask = new Map<string, number>();
  let unassignedActualMinutes = 0;
  for (const entry of entryRows) {
    if (entry.task_id) {
      actualByTask.set(entry.task_id, (actualByTask.get(entry.task_id) ?? 0) + entry.minutes);
    } else {
      unassignedActualMinutes += entry.minutes;
    }
  }

  const taskReconciliation = taskRows.map((t) => {
    const actualMinutes = actualByTask.get(t.id) ?? 0;
    const estimatedMinutes = t.estimated_minutes;
    const variancePct =
      estimatedMinutes && estimatedMinutes > 0
        ? Math.round(((actualMinutes - estimatedMinutes) / estimatedMinutes) * 1000) / 10
        : null;
    return {
      task_id: t.id,
      title: t.title,
      status: t.status,
      estimated_minutes: estimatedMinutes,
      actual_minutes: actualMinutes,
      variance_minutes: estimatedMinutes != null ? actualMinutes - estimatedMinutes : null,
      variance_pct: variancePct,
    };
  });

  const totalActualMinutes = entryRows.reduce((sum, e) => sum + e.minutes, 0);
  const rollupEstimateMinutes =
    projectRow.current_estimate_minutes ?? taskRows.reduce((sum, t) => sum + (t.estimated_minutes ?? 0), 0);
  const rollupVariancePct =
    rollupEstimateMinutes > 0
      ? Math.round(((totalActualMinutes - rollupEstimateMinutes) / rollupEstimateMinutes) * 1000) / 10
      : null;

  return apiSuccess({
    tasks: taskReconciliation,
    unassigned_actual_minutes: unassignedActualMinutes,
    rollup: {
      estimate_minutes: rollupEstimateMinutes,
      actual_minutes: totalActualMinutes,
      variance_minutes: rollupEstimateMinutes > 0 ? totalActualMinutes - rollupEstimateMinutes : null,
      variance_pct: rollupVariancePct,
    },
  });
}
