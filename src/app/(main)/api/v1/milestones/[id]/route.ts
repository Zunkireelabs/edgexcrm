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
import { validate, maxLength, optionalMaxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Props {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/milestones/${id}` });

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
  });
  const validationErrors: Record<string, string[]> = { ...errors };
  if (body.due_date !== undefined && body.due_date !== null && !DATE_RE.test(String(body.due_date))) {
    validationErrors.due_date = ["Must be an ISO date (YYYY-MM-DD)"];
  }
  if (!valid || Object.keys(validationErrors).length > 0) return apiValidationError(validationErrors);

  const db = await scopedClient(auth);
  const { data: existing } = await db.from("project_milestones").select("id").eq("id", id).maybeSingle();
  if (!existing) return apiNotFound("Milestone");

  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) patch.title = String(body.title).trim();
  if (body.description !== undefined) patch.description = body.description ? String(body.description).trim() : null;
  if (body.due_date !== undefined) patch.due_date = body.due_date ?? null;
  if (body.sort_order !== undefined) patch.sort_order = Number(body.sort_order);
  if (body.amount !== undefined) patch.amount = body.amount != null ? Number(body.amount) : null;
  // Status changes flow exclusively through /transition, /accept, /reject —
  // this generic field-editor deliberately ignores a `status` in the body.

  if (Object.keys(patch).length === 0) {
    const { data: current } = await db.from("project_milestones").select("*").eq("id", id).maybeSingle();
    return apiSuccess(current ?? existing);
  }

  const { data: updated, error } = await db
    .from("project_milestones")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to update milestone");
    return apiError("DB_ERROR", "Failed to update milestone", 500);
  }

  log.info({ milestoneId: id }, "Milestone updated");
  return apiSuccess(updated);
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/milestones/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: existing } = await db.from("project_milestones").select("id").eq("id", id).maybeSingle();
  if (!existing) return apiNotFound("Milestone");

  const { error } = await db.from("project_milestones").delete().eq("id", id);
  if (error) {
    log.error({ error }, "Failed to delete milestone");
    return apiError("DB_ERROR", "Failed to delete milestone", 500);
  }

  log.info({ milestoneId: id }, "Milestone deleted");
  return apiSuccess({ id });
}
