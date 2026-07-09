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
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/milestones/${id}/accept` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: existing } = await db
    .from("project_milestones")
    .select("id, project_id, title, amount")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Milestone");
  const existingRow = existing as unknown as { project_id: string; title: string; amount: number | null };

  const { data: updated, error } = await db
    .from("project_milestones")
    .update({
      status: "accepted",
      accepted_at: new Date().toISOString(),
      accepted_by: auth.userId,
      rejection_reason: null,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to accept milestone");
    return apiError("DB_ERROR", "Failed to accept milestone", 500);
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
