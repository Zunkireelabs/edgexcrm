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
import { validate, maxLength, optionalMaxLength, isIn, isUUID } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { recordProjectEvent } from "@/lib/projects/events";

const ISSUE_KINDS = ["query", "issue", "blocker"];
const ISSUE_SEVERITIES = ["low", "medium", "high"];
const ISSUE_STATUSES = ["open", "in_progress", "resolved", "closed"];

interface Props {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/issues/${id}` });

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
    title: [maxLength(255)],
    description: [optionalMaxLength(2000)],
    kind: [isIn(ISSUE_KINDS)],
    severity: [isIn(ISSUE_SEVERITIES)],
    status: [isIn(ISSUE_STATUSES)],
    assigned_to: [isUUID()],
  });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);
  const { data: existing } = await db
    .from("project_issues")
    .select("id, project_id, title, kind, severity, status")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Issue");
  const existingRow = existing as unknown as {
    project_id: string;
    title: string;
    kind: string;
    severity: string;
    status: string;
  };

  if (body.assigned_to) {
    const { data: member } = await db
      .from("tenant_users")
      .select("user_id")
      .eq("user_id", String(body.assigned_to))
      .maybeSingle();
    if (!member) return apiValidationError({ assigned_to: ["Not a member of this tenant"] });
  }

  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) patch.title = String(body.title).trim();
  if (body.description !== undefined) patch.description = body.description ? String(body.description).trim() : null;
  if (body.kind !== undefined) patch.kind = String(body.kind);
  if (body.severity !== undefined) patch.severity = String(body.severity);
  if (body.assigned_to !== undefined) patch.assigned_to = body.assigned_to ?? null;

  const transitioningToResolved = body.status === "resolved" && existingRow.status !== "resolved";
  if (body.status !== undefined) {
    patch.status = String(body.status);
    if (transitioningToResolved) patch.resolved_at = new Date().toISOString();
  }

  if (Object.keys(patch).length === 0) {
    return apiSuccess(existing);
  }

  const { data: updated, error } = await db
    .from("project_issues")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to update issue");
    return apiError("DB_ERROR", "Failed to update issue", 500);
  }

  if (transitioningToResolved) {
    await recordProjectEvent(db, {
      projectId: existingRow.project_id,
      eventType: "issue_resolved",
      actorId: auth.userId,
      summary: `Issue resolved: ${existingRow.title}`,
      payload: { issue_id: id, kind: existingRow.kind, severity: existingRow.severity },
      subjectType: "issue",
      subjectId: id,
    });
  }

  log.info({ issueId: id }, "Issue updated");
  return apiSuccess(updated);
}
