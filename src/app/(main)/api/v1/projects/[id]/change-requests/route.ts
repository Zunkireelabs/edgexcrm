import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { validate, required, maxLength, optionalMaxLength, isIn, isUUID } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { recordProjectEvent } from "@/lib/projects/events";

const CLASSIFICATIONS = ["in_scope", "new_scope"];

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: project } = await db.from("projects").select("id").eq("id", id).maybeSingle();
  if (!project) return apiNotFound("Project");

  const { data: changeRequests, error } = await db
    .from("project_change_requests")
    .select("*")
    .eq("project_id", id)
    .order("created_at", { ascending: false });

  if (error) return apiError("DB_ERROR", "Failed to fetch change requests", 500);
  return apiSuccess(changeRequests ?? []);
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/projects/${id}/change-requests` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    title: [required("title"), maxLength(255)],
    description: [optionalMaxLength(2000)],
    classification: [isIn(CLASSIFICATIONS)],
    origin_issue_id: [isUUID()],
  });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);
  const { data: project } = await db.from("projects").select("id").eq("id", id).maybeSingle();
  if (!project) return apiNotFound("Project");

  if (body.origin_issue_id) {
    const { data: issue } = await db
      .from("project_issues")
      .select("id")
      .eq("id", String(body.origin_issue_id))
      .eq("project_id", id)
      .maybeSingle();
    if (!issue) return apiValidationError({ origin_issue_id: ["Not an issue on this project"] });
  }

  const classification = body.classification ? String(body.classification) : "new_scope";
  const estimateDeltaMinutes = body.estimate_delta_minutes != null ? Math.trunc(Number(body.estimate_delta_minutes)) : 0;

  const { data: created, error } = await db
    .from("project_change_requests")
    .insert({
      project_id: id,
      title: String(body.title).trim(),
      description: body.description ? String(body.description).trim() : null,
      classification,
      estimate_delta_minutes: estimateDeltaMinutes,
      budget_delta_amount: body.budget_delta_amount != null ? Number(body.budget_delta_amount) : null,
      client_approved: Boolean(body.client_approved),
      origin_issue_id: body.origin_issue_id ?? null,
    })
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to create change request");
    return apiError("DB_ERROR", "Failed to create change request", 500);
  }

  await recordProjectEvent(db, {
    projectId: id,
    eventType: "change_request_proposed",
    actorId: auth.userId,
    summary: `CR proposed: ${created.title} (${estimateDeltaMinutes >= 0 ? "+" : ""}${Math.round(estimateDeltaMinutes / 60)}h)`,
    payload: { change_request_id: created.id, delta_minutes: estimateDeltaMinutes, classification },
    subjectType: "change_request",
    subjectId: created.id,
  });

  log.info({ changeRequestId: created.id }, "Change request created");
  return apiSuccess(created, 201);
}
