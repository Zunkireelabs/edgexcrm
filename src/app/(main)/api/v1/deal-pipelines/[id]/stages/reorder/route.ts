import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiValidationError,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id: pipelineId } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/deal-pipelines/${pipelineId}/stages/reorder` });

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

  const stageIds = body.stage_ids;
  if (!Array.isArray(stageIds) || stageIds.length === 0) {
    return apiValidationError({ stage_ids: ["stage_ids must be a non-empty array of UUIDs"] });
  }
  for (const id of stageIds) {
    if (typeof id !== "string") {
      return apiValidationError({ stage_ids: ["All stage_ids must be strings"] });
    }
  }

  const db = await scopedClient(auth);

  const { data: pipeline } = await db
    .from("deal_pipelines")
    .select("id")
    .eq("id", pipelineId)
    .maybeSingle();

  if (!pipeline) return apiNotFound("Deal pipeline");

  const { data: existingStages } = await db
    .from("deal_stages")
    .select("id")
    .eq("pipeline_id", pipelineId);

  const existingIds = new Set((existingStages || []).map((s) => (s as unknown as { id: string }).id));
  const providedIds = new Set(stageIds as string[]);

  for (const id of stageIds as string[]) {
    if (!existingIds.has(id)) {
      return apiValidationError({ stage_ids: [`Stage ${id} not found in this pipeline`] });
    }
  }

  if (providedIds.size !== existingIds.size) {
    return apiValidationError({ stage_ids: ["All stages must be included in the reorder operation"] });
  }

  const updates = (stageIds as string[]).map((stageId, index) =>
    db.from("deal_stages").update({ position: index }).eq("id", stageId)
  );

  const results = await Promise.all(updates);
  for (const result of results) {
    if (result.error) {
      log.error({ error: result.error }, "Failed to update stage position");
      return apiError("DB_ERROR", "Failed to reorder stages", 500);
    }
  }

  const { data: updatedStages } = await db
    .from("deal_stages")
    .select("*")
    .eq("pipeline_id", pipelineId)
    .order("position", { ascending: true });

  log.info({ pipelineId, stageCount: stageIds.length }, "Deal stages reordered");
  return apiSuccess(updatedStages);
}
