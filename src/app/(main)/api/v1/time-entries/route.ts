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
import { validate, required, isUUID, isPositiveInt } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.TIME_TRACKING)) return apiForbidden();

  const db = await scopedClient(auth);
  const { searchParams } = new URL(request.url);

  const isAdmin = requireAdmin(auth);
  // Non-admins are always scoped to their own entries.
  const userIdParam = isAdmin ? searchParams.get("user_id") : auth.userId;
  const projectId = searchParams.get("project_id");
  const approvalStatus = searchParams.get("approval_status");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let query = db
    .from("time_entries")
    .select("*, projects(id, name, account_id), tasks(id, title)");

  if (userIdParam) query = query.eq("user_id", userIdParam);
  if (projectId) query = query.eq("project_id", projectId);
  if (approvalStatus) query = query.eq("approval_status", approvalStatus);
  if (from && DATE_RE.test(from)) query = query.gte("entry_date", from);
  if (to && DATE_RE.test(to)) query = query.lte("entry_date", to);

  const { data, error } = await query.order("entry_date", { ascending: false });
  if (error) return apiError("DB_ERROR", "Failed to fetch time entries", 500);
  return apiSuccess(data ?? []);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/time-entries" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.TIME_TRACKING)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    project_id: [required("project_id"), isUUID()],
    entry_date: [required("entry_date")],
    minutes: [required("minutes"), isPositiveInt()],
    task_id: [isUUID()],
  });
  if (!valid) return apiValidationError(errors);

  if (!DATE_RE.test(String(body.entry_date))) {
    return apiValidationError({ entry_date: ["Must be a valid date (YYYY-MM-DD)"] });
  }

  const db = await scopedClient(auth);

  // Verify project belongs to this tenant
  const { data: project } = await db
    .from("projects")
    .select("id, is_billable")
    .eq("id", String(body.project_id))
    .maybeSingle();
  if (!project) return apiNotFound("Project");

  // If task_id provided, verify it belongs to this project
  let isBillable = (project as unknown as { is_billable: boolean }).is_billable;
  if (body.task_id) {
    const { data: task } = await db
      .from("tasks")
      .select("id, is_billable, project_id")
      .eq("id", String(body.task_id))
      .maybeSingle();
    if (!task) return apiNotFound("Task");
    if ((task as unknown as { project_id: string }).project_id !== String(body.project_id)) {
      return apiValidationError({ task_id: ["Task does not belong to the specified project"] });
    }
    isBillable = (task as unknown as { is_billable: boolean }).is_billable;
  }

  const { data: created, error } = await db
    .from("time_entries")
    .insert({
      user_id: auth.userId,
      project_id: String(body.project_id),
      task_id: body.task_id ? String(body.task_id) : null,
      entry_date: String(body.entry_date),
      minutes: Number(body.minutes),
      notes: body.notes ? String(body.notes).trim() : null,
      is_billable: isBillable,
      approval_status: "pending",
      rate_snapshot: null,
    })
    .select("*, projects(id, name, account_id), tasks(id, title)")
    .single();

  if (error) {
    log.error({ error }, "Failed to create time entry");
    return apiError("DB_ERROR", "Failed to create time entry", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "time_entry.created",
      entityType: "time_entry",
      entityId: (created as { id: string }).id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "time_entry.created",
      entityType: "time_entry",
      entityId: (created as { id: string }).id,
      requestId,
    }),
  ]);

  log.info({ entryId: (created as { id: string }).id }, "Time entry created");
  return apiSuccess(created, 201);
}
