import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError, apiValidationError } from "@/lib/api/response";
import { validate, optionalMaxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { recordProjectEvent } from "@/lib/projects/events";

interface Props {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/milestones/${id}/reject` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) ?? {};
  } catch {
    // No body is fine — a reason is optional.
  }

  const { valid, errors } = validate(body, { reason: [optionalMaxLength(2000)] });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);
  const { data: existing } = await db
    .from("project_milestones")
    .select("id, project_id, title")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Milestone");
  const existingRow = existing as unknown as { project_id: string; title: string };

  const reason = body.reason ? String(body.reason).trim() : null;

  const { data: updated, error } = await db
    .from("project_milestones")
    .update({
      status: "rejected",
      rejection_reason: reason,
      accepted_at: null,
      accepted_by: null,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to reject milestone");
    return apiError("DB_ERROR", "Failed to reject milestone", 500);
  }

  await recordProjectEvent(db, {
    projectId: existingRow.project_id,
    eventType: "milestone_rejected",
    actorId: auth.userId,
    summary: `Milestone rejected: ${existingRow.title}`,
    payload: { milestone_id: id, reason },
    subjectType: "milestone",
    subjectId: id,
  });

  log.info({ milestoneId: id }, "Milestone rejected");
  return apiSuccess(updated);
}
