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
import { validate, optionalMaxLength } from "@/lib/api/validation";
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

  const { data: reports, error } = await db
    .from("project_status_reports")
    .select("*")
    .eq("project_id", id)
    .order("report_date", { ascending: false });

  if (error) return apiError("DB_ERROR", "Failed to fetch status reports", 500);
  return apiSuccess(reports ?? []);
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/projects/${id}/status-reports` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) ?? {};
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    summary: [optionalMaxLength(5000)],
    accomplishments: [optionalMaxLength(5000)],
    in_progress: [optionalMaxLength(5000)],
    risks: [optionalMaxLength(5000)],
    asks: [optionalMaxLength(5000)],
    client_message: [optionalMaxLength(5000)],
  });
  const validationErrors: Record<string, string[]> = { ...errors };
  for (const field of ["report_date", "period_start", "period_end"] as const) {
    const value = body[field];
    if (value !== undefined && value !== null && !DATE_RE.test(String(value))) {
      validationErrors[field] = ["Must be an ISO date (YYYY-MM-DD)"];
    }
  }
  if (!valid || Object.keys(validationErrors).length > 0) return apiValidationError(validationErrors);

  const db = await scopedClient(auth);
  const { data: project } = await db.from("projects").select("id").eq("id", id).maybeSingle();
  if (!project) return apiNotFound("Project");

  const { data: created, error } = await db
    .from("project_status_reports")
    .insert({
      project_id: id,
      report_date: body.report_date ?? new Date().toISOString().slice(0, 10),
      period_start: body.period_start ?? null,
      period_end: body.period_end ?? null,
      summary: body.summary ? String(body.summary).trim() : null,
      accomplishments: body.accomplishments ? String(body.accomplishments).trim() : null,
      in_progress: body.in_progress ? String(body.in_progress).trim() : null,
      risks: body.risks ? String(body.risks).trim() : null,
      asks: body.asks ? String(body.asks).trim() : null,
      client_message: body.client_message ? String(body.client_message).trim() : null,
    })
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to create status report");
    return apiError("DB_ERROR", "Failed to create status report", 500);
  }

  log.info({ statusReportId: created.id }, "Status report draft created");
  return apiSuccess(created, 201);
}
