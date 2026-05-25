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
import { createAuditLog, emitEvent } from "@/lib/api/audit";

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id: projectId } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.TIME_TRACKING)) return apiForbidden();

  const db = await scopedClient(auth);

  // Verify project belongs to this tenant
  const { data: project } = await db
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return apiNotFound("Project");

  const { data: tasks, error } = await db
    .from("tasks")
    .select("*")
    .eq("project_id", projectId)
    .order("position", { ascending: true });

  if (error) return apiError("DB_ERROR", "Failed to fetch tasks", 500);
  return apiSuccess(tasks ?? []);
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id: projectId } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: `/api/v1/projects/${projectId}/tasks`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.TIME_TRACKING)) return apiForbidden();
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
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);

  // Verify project belongs to this tenant
  const { data: project } = await db
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return apiNotFound("Project");

  // Get next position
  const { data: posResult } = await db
    .raw()
    .from("tasks")
    .select("position")
    .eq("tenant_id", auth.tenantId)
    .eq("project_id", projectId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPosition = posResult ? (posResult.position as number) + 1 : 0;

  const { data: created, error } = await db
    .from("tasks")
    .insert({
      project_id: projectId,
      title: String(body.title).trim(),
      description: body.description ? String(body.description).trim() : null,
      status: "todo",
      estimated_minutes:
        body.estimated_minutes != null ? Number(body.estimated_minutes) : null,
      is_billable: body.is_billable !== false,
      position: nextPosition,
    })
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to create task");
    return apiError("DB_ERROR", "Failed to create task", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "task.created",
      entityType: "task",
      entityId: created.id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "task.created",
      entityType: "task",
      entityId: created.id,
      requestId,
    }),
  ]);

  log.info({ taskId: created.id }, "Task created");
  return apiSuccess(created, 201);
}
