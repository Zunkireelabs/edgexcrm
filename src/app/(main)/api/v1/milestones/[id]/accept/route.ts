import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError, apiConflict } from "@/lib/api/response";
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
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/milestones/${id}/accept` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: existing } = await db
    .from("project_milestones")
    .select("id, project_id, title, amount, status")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Milestone");
  const existingRow = existing as unknown as { project_id: string; title: string; amount: number | null; status: string };
  if (existingRow.status === "accepted" || existingRow.status === "rejected") {
    return apiConflict(`Milestone already ${existingRow.status}`);
  }

  // TOCTOU guard: only pending/in_progress/submitted milestones can be
  // accepted (cockpit legitimately accepts from any of those stages) — a
  // concurrent double-accept affects 0 rows and bails out below.
  const { data: updated, error } = await db
    .from("project_milestones")
    .update({
      status: "accepted",
      accepted_at: new Date().toISOString(),
      accepted_by: auth.userId,
      rejection_reason: null,
    })
    .eq("id", id)
    .in("status", ["pending", "in_progress", "submitted"])
    .select()
    .maybeSingle();

  if (error) {
    log.error({ error }, "Failed to accept milestone");
    return apiError("DB_ERROR", "Failed to accept milestone", 500);
  }
  if (!updated) {
    return apiConflict("Milestone already decided");
  }

  await recordProjectEvent(db, {
    projectId: existingRow.project_id,
    eventType: "milestone_accepted",
    actorId: auth.userId,
    summary: `Milestone accepted: ${existingRow.title}`,
    payload: { milestone_id: id, amount: existingRow.amount },
    subjectType: "milestone",
    subjectId: id,
  });

  log.info({ milestoneId: id }, "Milestone accepted");
  return apiSuccess(updated);
}
