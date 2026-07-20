import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError, apiValidationError, apiConflict } from "@/lib/api/response";
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
    .select("id, project_id, title, status")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Milestone");
  const existingRow = existing as unknown as { project_id: string; title: string; status: string };
  if (existingRow.status === "accepted" || existingRow.status === "rejected") {
    return apiConflict(`Milestone already ${existingRow.status}`);
  }

  const reason = body.reason ? String(body.reason).trim() : null;

  // TOCTOU guard: mirrors accept/route.ts — a concurrent double-action
  // affects 0 rows and bails out below instead of double-recording an event.
  const { data: updated, error } = await db
    .from("project_milestones")
    .update({
      status: "rejected",
      rejection_reason: reason,
      accepted_at: null,
      accepted_by: null,
    })
    .eq("id", id)
    .in("status", ["pending", "in_progress", "submitted"])
    .select()
    .maybeSingle();

  if (error) {
    log.error({ error }, "Failed to reject milestone");
    return apiError("DB_ERROR", "Failed to reject milestone", 500);
  }
  if (!updated) {
    return apiConflict("Milestone already decided");
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
