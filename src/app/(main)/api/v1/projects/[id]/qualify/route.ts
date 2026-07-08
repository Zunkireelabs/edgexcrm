import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
  apiConflict,
} from "@/lib/api/response";
import { validate, required, maxLength, isIn, isPositiveInt } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { recordProjectEvent } from "@/lib/projects/events";

const ENGAGEMENT_MODELS = ["fixed_bid", "time_materials", "retainer", "staff_aug"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Props {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/projects/${id}/qualify` });

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
    definition_of_done: [required("definition_of_done"), maxLength(5000)],
    baseline_estimate_minutes: [required("baseline_estimate_minutes"), isPositiveInt()],
    engagement_model: [isIn(ENGAGEMENT_MODELS)],
  });
  const validationErrors: Record<string, string[]> = { ...errors };

  if (
    body.target_end_date !== undefined &&
    body.target_end_date !== null &&
    !DATE_RE.test(String(body.target_end_date))
  ) {
    validationErrors.target_end_date = ["Must be an ISO date (YYYY-MM-DD)"];
  }
  if (body.start_date !== undefined && body.start_date !== null && !DATE_RE.test(String(body.start_date))) {
    validationErrors.start_date = ["Must be an ISO date (YYYY-MM-DD)"];
  }
  if (!valid || Object.keys(validationErrors).length > 0) return apiValidationError(validationErrors);

  const db = await scopedClient(auth);
  const { data: existing } = await db
    .from("projects")
    .select("id, qualified_at")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Project");

  const existingRow = existing as unknown as { qualified_at: string | null };
  if (existingRow.qualified_at) {
    return apiConflict("Project already qualified — baseline_estimate_minutes is immutable");
  }

  const baselineMinutes = Number(body.baseline_estimate_minutes);
  const patch: Record<string, unknown> = {
    definition_of_done: String(body.definition_of_done).trim(),
    baseline_estimate_minutes: baselineMinutes,
    current_estimate_minutes: baselineMinutes,
    qualified_at: new Date().toISOString(),
    qualified_by: auth.userId,
  };
  if (body.engagement_model !== undefined && body.engagement_model !== null) {
    patch.engagement_model = String(body.engagement_model);
  }
  if (body.budget_amount !== undefined && body.budget_amount !== null) {
    patch.budget_amount = Number(body.budget_amount);
  }
  if (body.start_date !== undefined && body.start_date !== null) {
    patch.start_date = String(body.start_date);
  }
  if (body.target_end_date !== undefined && body.target_end_date !== null) {
    patch.target_end_date = String(body.target_end_date);
  }

  const { data: updated, error } = await db.from("projects").update(patch).eq("id", id).select().single();
  if (error) {
    log.error({ error }, "Failed to qualify project");
    return apiError("DB_ERROR", "Failed to qualify project", 500);
  }

  const updatedRow = updated as unknown as {
    engagement_model: string | null;
    target_end_date: string | null;
    budget_amount: number | null;
  };

  await recordProjectEvent(db, {
    projectId: id,
    eventType: "scope_baseline_set",
    actorId: auth.userId,
    summary: `Scope committed at ${Math.round(baselineMinutes / 60)}h`,
    payload: {
      estimate_minutes: baselineMinutes,
      dod: patch.definition_of_done,
      engagement_model: updatedRow.engagement_model,
      target_end_date: updatedRow.target_end_date,
      budget_amount: updatedRow.budget_amount,
    },
  });

  log.info({ projectId: id, baselineMinutes }, "Project qualified");
  return apiSuccess(updated);
}
