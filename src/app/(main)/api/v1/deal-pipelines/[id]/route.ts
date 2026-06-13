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
import type { DealPipelineWithStages, DealStageWithCount } from "@/types/database";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "GET", path: `/api/v1/deal-pipelines/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.DEALS)) return apiForbidden();

  const db = await scopedClient(auth);

  const { data: pipeline, error: pipelineError } = await db
    .from("deal_pipelines")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (pipelineError || !pipeline) return apiNotFound("Deal pipeline");

  const { data: stages, error: stagesError } = await db
    .from("deal_stages")
    .select("*")
    .eq("pipeline_id", id)
    .order("position", { ascending: true });

  if (stagesError) {
    log.error({ error: stagesError }, "Failed to fetch stages");
    return apiError("DB_ERROR", "Failed to fetch pipeline stages", 500);
  }

  const { data: dealCounts } = await db
    .from("deals")
    .select("stage_id")
    .eq("pipeline_id", id)
    .is("deleted_at", null);

  const dealCountMap = new Map<string, number>();
  for (const d of dealCounts || []) {
    const sid = (d as unknown as { stage_id: string }).stage_id;
    if (sid) dealCountMap.set(sid, (dealCountMap.get(sid) || 0) + 1);
  }

  const stagesWithCounts: DealStageWithCount[] = (stages || []).map((s) => {
    const row = s as unknown as { id: string };
    return { ...(s as object), deal_count: dealCountMap.get(row.id) || 0 } as DealStageWithCount;
  });

  const result: DealPipelineWithStages = {
    ...(pipeline as object),
    stages: stagesWithCounts,
    deal_count: (dealCounts || []).length,
  } as DealPipelineWithStages;

  log.info({ pipelineId: id, stageCount: stagesWithCounts.length }, "Deal pipeline fetched");
  return apiSuccess(result);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/deal-pipelines/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.DEALS)) return apiForbidden();
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
    .from("deal_pipelines")
    .select("id, is_default")
    .eq("id", id)
    .maybeSingle();

  if (!existing) return apiNotFound("Deal pipeline");

  const updatePayload: Record<string, unknown> = {};

  if (body.name !== undefined) {
    updatePayload.name = body.name;
    updatePayload.slug = (body.name as string)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const { data: duplicate } = await db
      .from("deal_pipelines")
      .select("id")
      .eq("slug", updatePayload.slug as string)
      .maybeSingle();

    const dupRow = duplicate as unknown as { id: string } | null;
    if (dupRow && dupRow.id !== id) {
      return apiValidationError({ name: ["A pipeline with this name already exists"] });
    }
  }

  if (body.is_default !== undefined) updatePayload.is_default = body.is_default;
  if (body.description !== undefined) updatePayload.description = body.description;

  if (Object.keys(updatePayload).length === 0) {
    return apiValidationError({ body: ["No valid fields to update"] });
  }

  const { data: updated, error } = await db
    .from("deal_pipelines")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to update deal pipeline");
    return apiError("DB_ERROR", "Failed to update deal pipeline", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "deal_pipeline.updated",
      entityType: "deal_pipeline",
      entityId: id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "deal_pipeline.updated",
      entityType: "deal_pipeline",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ pipelineId: id }, "Deal pipeline updated");
  return apiSuccess(updated);
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/deal-pipelines/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.DEALS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);

  const { data: existing } = await db
    .from("deal_pipelines")
    .select("id, is_default, name")
    .eq("id", id)
    .maybeSingle();

  if (!existing) return apiNotFound("Deal pipeline");

  const existingRow = existing as unknown as { id: string; is_default: boolean; name: string };

  if (existingRow.is_default) {
    return apiConflict("Cannot delete the default pipeline. Set another pipeline as default first.");
  }

  const { count: dealCount } = await db
    .from("deals")
    .select("id", { count: "exact", head: true })
    .eq("pipeline_id", id)
    .is("deleted_at", null);

  if (dealCount && dealCount > 0) {
    return apiConflict(`Cannot delete pipeline with ${dealCount} deals. Move or delete the deals first.`);
  }

  const { count: pipelineCount } = await db
    .from("deal_pipelines")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);

  if (pipelineCount && pipelineCount <= 1) {
    return apiConflict("Cannot delete the last pipeline. Create another pipeline first.");
  }

  await db.from("deal_stages").delete().eq("pipeline_id", id);

  const { error } = await db.from("deal_pipelines").delete().eq("id", id);

  if (error) {
    log.error({ error }, "Failed to delete deal pipeline");
    return apiError("DB_ERROR", "Failed to delete deal pipeline", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "deal_pipeline.deleted",
      entityType: "deal_pipeline",
      entityId: id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "deal_pipeline.deleted",
      entityType: "deal_pipeline",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ pipelineId: id }, "Deal pipeline deleted");
  return apiSuccess({ deleted: true });
}
