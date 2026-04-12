import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiValidationError,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/v1/pipelines/:id/stages/reorder - Reorder stages
export async function POST(request: NextRequest, context: RouteContext) {
  const { id: pipelineId } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: `/api/v1/pipelines/${pipelineId}/stages/reorder`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const stageIds = body.stage_ids;

  if (!Array.isArray(stageIds) || stageIds.length === 0) {
    return apiValidationError({ stage_ids: ["stage_ids must be a non-empty array of UUIDs"] });
  }

  // Validate all items are strings (UUIDs)
  for (const id of stageIds) {
    if (typeof id !== "string") {
      return apiValidationError({ stage_ids: ["All stage_ids must be strings"] });
    }
  }

  log.info({ tenantId: auth.tenantId, pipelineId, stageCount: stageIds.length }, "Reordering stages");

  const supabase = await createServiceClient();

  // Check pipeline exists and belongs to tenant
  const { data: pipeline } = await supabase
    .from("pipelines")
    .select("id")
    .eq("id", pipelineId)
    .eq("tenant_id", auth.tenantId)
    .single();

  if (!pipeline) {
    return apiNotFound("Pipeline");
  }

  // Verify all stage IDs belong to this pipeline
  const { data: existingStages } = await supabase
    .from("pipeline_stages")
    .select("id")
    .eq("pipeline_id", pipelineId);

  const existingIds = new Set((existingStages || []).map((s) => s.id));
  const providedIds = new Set(stageIds as string[]);

  // Check all provided IDs exist
  for (const id of stageIds as string[]) {
    if (!existingIds.has(id)) {
      return apiValidationError({ stage_ids: [`Stage ${id} not found in this pipeline`] });
    }
  }

  // Check all existing stages are provided (no stages lost)
  if (providedIds.size !== existingIds.size) {
    return apiValidationError({
      stage_ids: ["All stages must be included in the reorder operation"],
    });
  }

  // Update positions
  const updates = (stageIds as string[]).map((stageId, index) =>
    supabase
      .from("pipeline_stages")
      .update({ position: index })
      .eq("id", stageId)
  );

  const results = await Promise.all(updates);

  // Check for errors
  for (const result of results) {
    if (result.error) {
      log.error({ err: result.error }, "Failed to update stage position");
      return apiServiceUnavailable("Failed to reorder stages");
    }
  }

  // Fetch updated stages
  const { data: updatedStages, error: fetchError } = await supabase
    .from("pipeline_stages")
    .select("*")
    .eq("pipeline_id", pipelineId)
    .order("position", { ascending: true });

  if (fetchError) {
    log.error({ err: fetchError }, "Failed to fetch updated stages");
    return apiServiceUnavailable("Failed to fetch updated stages");
  }

  log.info({ pipelineId, stageCount: stageIds.length }, "Stages reordered");
  return apiSuccess(updatedStages);
}
