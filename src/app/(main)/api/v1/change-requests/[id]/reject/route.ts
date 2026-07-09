import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError, apiConflict, apiValidationError } from "@/lib/api/response";
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
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/change-requests/${id}/reject` });

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
    .from("project_change_requests")
    .select("id, project_id, status, title")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Change request");
  const existingRow = existing as unknown as { project_id: string; status: string; title: string };
  if (existingRow.status !== "proposed") {
    return apiConflict(`Change request already ${existingRow.status}`);
  }

  const reason = body.reason ? String(body.reason).trim() : null;

  const { data: updated, error } = await db
    .from("project_change_requests")
    .update({ status: "rejected", decided_at: new Date().toISOString(), decided_by: auth.userId })
    .eq("id", id)
    .select()
    .single();
  if (error) {
    log.error({ error }, "Failed to reject change request");
    return apiError("DB_ERROR", "Failed to reject change request", 500);
  }

  await recordProjectEvent(db, {
    projectId: existingRow.project_id,
    eventType: "change_request_rejected",
    actorId: auth.userId,
    summary: `CR rejected: ${existingRow.title}`,
    payload: { change_request_id: id, reason },
    subjectType: "change_request",
    subjectId: id,
  });

  log.info({ changeRequestId: id }, "Change request rejected");
  return apiSuccess(updated);
}
