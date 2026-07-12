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

const RISK_LEVELS = ["low", "medium", "high"];
const RISK_STATUSES = ["open", "mitigating", "closed", "occurred"];
const TERMINAL_STATUSES = new Set(["closed", "occurred"]);

interface Props {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/risks/${id}` });

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
    probability: [isIn(RISK_LEVELS)],
    impact: [isIn(RISK_LEVELS)],
    mitigation: [optionalMaxLength(2000)],
    owner_id: [isUUID()],
    status: [isIn(RISK_STATUSES)],
  });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);
  const { data: existing } = await db
    .from("project_risks")
    .select("id, project_id, title, status")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Risk");
  const existingRow = existing as unknown as { project_id: string; title: string; status: string };

  if (body.owner_id) {
    const { data: member } = await db
      .from("tenant_users")
      .select("user_id")
      .eq("user_id", String(body.owner_id))
      .maybeSingle();
    if (!member) return apiValidationError({ owner_id: ["Not a member of this tenant"] });
  }

  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) patch.title = String(body.title).trim();
  if (body.description !== undefined) patch.description = body.description ? String(body.description).trim() : null;
  if (body.probability !== undefined) patch.probability = String(body.probability);
  if (body.impact !== undefined) patch.impact = String(body.impact);
  if (body.mitigation !== undefined) patch.mitigation = body.mitigation ? String(body.mitigation).trim() : null;
  if (body.owner_id !== undefined) patch.owner_id = body.owner_id ?? null;
  if (body.review_date !== undefined) patch.review_date = body.review_date ?? null;

  const wasTerminal = TERMINAL_STATUSES.has(existingRow.status);
  const nextStatus = body.status !== undefined ? String(body.status) : existingRow.status;
  const enteringTerminal = body.status !== undefined && TERMINAL_STATUSES.has(nextStatus) && !wasTerminal;
  const leavingTerminal = body.status !== undefined && !TERMINAL_STATUSES.has(nextStatus) && wasTerminal;

  if (body.status !== undefined) {
    patch.status = nextStatus;
    if (enteringTerminal) patch.resolved_at = new Date().toISOString();
    if (leavingTerminal) patch.resolved_at = null;
  }

  if (Object.keys(patch).length === 0) {
    return apiSuccess(existing);
  }

  const { data: updated, error } = await db
    .from("project_risks")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to update risk");
    return apiError("DB_ERROR", "Failed to update risk", 500);
  }

  if (enteringTerminal) {
    const eventType = nextStatus === "closed" ? "risk_closed" : "risk_occurred";
    const summary =
      nextStatus === "closed" ? `Risk closed: ${existingRow.title}` : `Risk occurred: ${existingRow.title}`;
    await recordProjectEvent(db, {
      projectId: existingRow.project_id,
      eventType,
      actorId: auth.userId,
      summary,
      payload: { risk_id: id, from: existingRow.status, to: nextStatus },
      subjectType: "risk",
      subjectId: id,
    });
  }
  // Reopen (terminal -> open/mitigating) clears resolved_at above but emits no
  // terminal event — mirrors issues' one-directional resolve, extended for
  // project_risks' two-terminal-state (closed/occurred) lifecycle.

  log.info({ riskId: id }, "Risk updated");
  return apiSuccess(updated);
}
