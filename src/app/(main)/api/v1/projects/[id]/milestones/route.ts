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
import { validate, required, maxLength, optionalMaxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

  const { data: milestones, error } = await db
    .from("project_milestones")
    .select("*")
    .eq("project_id", id)
    .order("sort_order", { ascending: true });

  if (error) return apiError("DB_ERROR", "Failed to fetch milestones", 500);
  return apiSuccess(milestones ?? []);
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/projects/${id}/milestones` });

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
  });
  const validationErrors: Record<string, string[]> = { ...errors };
  if (body.due_date !== undefined && body.due_date !== null && !DATE_RE.test(String(body.due_date))) {
    validationErrors.due_date = ["Must be an ISO date (YYYY-MM-DD)"];
  }
  if (!valid || Object.keys(validationErrors).length > 0) return apiValidationError(validationErrors);

  const db = await scopedClient(auth);
  const { data: project } = await db.from("projects").select("id").eq("id", id).maybeSingle();
  if (!project) return apiNotFound("Project");

  const { data: posResult } = await db
    .raw()
    .from("project_milestones")
    .select("sort_order")
    .eq("tenant_id", auth.tenantId)
    .eq("project_id", id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSortOrder = posResult ? (posResult.sort_order as number) + 1 : 0;

  const { data: created, error } = await db
    .from("project_milestones")
    .insert({
      project_id: id,
      title: String(body.title).trim(),
      description: body.description ? String(body.description).trim() : null,
      due_date: body.due_date ?? null,
      sort_order: nextSortOrder,
      amount: body.amount != null ? Number(body.amount) : null,
    })
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to create milestone");
    return apiError("DB_ERROR", "Failed to create milestone", 500);
  }

  log.info({ milestoneId: created.id }, "Milestone created");
  return apiSuccess(created, 201);
}
