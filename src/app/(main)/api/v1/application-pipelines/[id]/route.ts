import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiValidationError,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiConflict,
  apiError,
} from "@/lib/api/response";
import { validate, maxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import type { ApplicationPipelineWithStages, ApplicationStageWithCount } from "@/types/database";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "GET", path: `/api/v1/application-pipelines/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();

  const db = await scopedClient(auth);

  const { data: pipeline, error: pipelineError } = await db
    .from("application_pipelines")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (pipelineError || !pipeline) return apiNotFound("Application pipeline");

  const { data: stages, error: stagesError } = await db
    .from("application_stages")
    .select("*")
    .eq("pipeline_id", id)
    .order("position", { ascending: true });

  if (stagesError) {
    log.error({ error: stagesError }, "Failed to fetch stages");
    return apiError("DB_ERROR", "Failed to fetch pipeline stages", 500);
  }

  const { data: appCounts } = await db
    .from("applications")
    .select("stage_id")
    .eq("pipeline_id", id)
    .is("deleted_at", null);

  const appCountMap = new Map<string, number>();
  for (const a of appCounts || []) {
    const sid = (a as unknown as { stage_id: string }).stage_id;
    if (sid) appCountMap.set(sid, (appCountMap.get(sid) || 0) + 1);
  }

  const stagesWithCounts: ApplicationStageWithCount[] = (stages || []).map((s) => {
    const row = s as unknown as { id: string };
    return { ...(s as object), application_count: appCountMap.get(row.id) || 0 } as ApplicationStageWithCount;
  });

  const result: ApplicationPipelineWithStages = {
    ...(pipeline as object),
    stages: stagesWithCounts,
    application_count: (appCounts || []).length,
  } as ApplicationPipelineWithStages;

  log.info({ pipelineId: id, stageCount: stagesWithCounts.length }, "Application pipeline fetched");
  return apiSuccess(result);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/application-pipelines/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const { valid, errors } = validate(body, { name: [maxLength(100)] });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);

  const { data: existing } = await db
    .from("application_pipelines")
    .select("id, is_default")
    .eq("id", id)
    .maybeSingle();

  if (!existing) return apiNotFound("Application pipeline");

  const updatePayload: Record<string, unknown> = {};

  if (body.name !== undefined) {
    updatePayload.name = body.name;
    updatePayload.slug = (body.name as string)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const { data: duplicate } = await db
      .from("application_pipelines")
      .select("id")
      .eq("slug", updatePayload.slug as string)
      .maybeSingle();

    const dupRow = duplicate as unknown as { id: string } | null;
    if (dupRow && dupRow.id !== id) {
      return apiValidationError({ name: ["A pipeline with this name already exists"] });
    }
  }

  if (body.is_default !== undefined) updatePayload.is_default = body.is_default;

  if (Object.keys(updatePayload).length === 0) {
    return apiValidationError({ body: ["No valid fields to update"] });
  }

  const { data: updated, error } = await db
    .from("application_pipelines")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to update application pipeline");
    return apiError("DB_ERROR", "Failed to update application pipeline", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "application_pipeline.updated",
      entityType: "application_pipeline",
      entityId: id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "application_pipeline.updated",
      entityType: "application_pipeline",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ pipelineId: id }, "Application pipeline updated");
  return apiSuccess(updated);
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/application-pipelines/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);

  const { data: existing } = await db
    .from("application_pipelines")
    .select("id, is_default, name")
    .eq("id", id)
    .maybeSingle();

  if (!existing) return apiNotFound("Application pipeline");

  const existingRow = existing as unknown as { id: string; is_default: boolean; name: string };

  if (existingRow.is_default) {
    return apiConflict("Cannot delete the default pipeline. Set another pipeline as default first.");
  }

  const { count: appCount } = await db
    .from("applications")
    .select("id", { count: "exact", head: true })
    .eq("pipeline_id", id)
    .is("deleted_at", null);

  if (appCount && appCount > 0) {
    return apiConflict(`Cannot delete pipeline with ${appCount} applications. Move or delete the applications first.`);
  }

  const { count: pipelineCount } = await db
    .from("application_pipelines")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);

  if (pipelineCount && pipelineCount <= 1) {
    return apiConflict("Cannot delete the last pipeline. Create another pipeline first.");
  }

  await db.from("application_stages").delete().eq("pipeline_id", id);

  const { error } = await db.from("application_pipelines").delete().eq("id", id);

  if (error) {
    log.error({ error }, "Failed to delete application pipeline");
    return apiError("DB_ERROR", "Failed to delete application pipeline", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "application_pipeline.deleted",
      entityType: "application_pipeline",
      entityId: id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "application_pipeline.deleted",
      entityType: "application_pipeline",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ pipelineId: id }, "Application pipeline deleted");
  return apiSuccess({ deleted: true });
}