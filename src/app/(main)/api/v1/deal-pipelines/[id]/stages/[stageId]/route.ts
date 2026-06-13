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
import { validate, maxLength, isIn } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

interface RouteContext {
  params: Promise<{ id: string; stageId: string }>;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id: pipelineId, stageId } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/deal-pipelines/${pipelineId}/stages/${stageId}` });

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

  const { valid, errors } = validate(body, {
    name: [maxLength(100)],
    color: [maxLength(7)],
    terminal_type: [isIn(["won", "lost"])],
  });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);

  const { data: existing } = await db
    .from("deal_stages")
    .select("*")
    .eq("id", stageId)
    .eq("pipeline_id", pipelineId)
    .maybeSingle();

  if (!existing) return apiNotFound("Stage");

  const updatePayload: Record<string, unknown> = {};

  if (body.name !== undefined) updatePayload.name = body.name;
  if (body.color !== undefined) updatePayload.color = body.color;

  if (body.is_terminal !== undefined) {
    updatePayload.is_terminal = body.is_terminal;
    if (!body.is_terminal) updatePayload.terminal_type = null;
  }

  if (body.terminal_type !== undefined) {
    if (body.terminal_type === null || body.terminal_type === "") {
      updatePayload.terminal_type = null;
      updatePayload.is_terminal = false;
    } else {
      updatePayload.terminal_type = body.terminal_type;
      updatePayload.is_terminal = true;
    }
  }

  if (body.is_default !== undefined) {
    updatePayload.is_default = body.is_default;
    if (body.is_default === true) {
      await db
        .from("deal_stages")
        .update({ is_default: false })
        .eq("pipeline_id", pipelineId)
        .eq("is_default", true)
        .neq("id", stageId);
    }
  }

  if (Object.keys(updatePayload).length === 0) {
    return apiValidationError({ body: ["No valid fields to update"] });
  }

  const { data: updated, error } = await db
    .from("deal_stages")
    .update(updatePayload)
    .eq("id", stageId)
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to update deal stage");
    return apiError("DB_ERROR", "Failed to update stage", 500);
  }

  log.info({ stageId }, "Deal stage updated");
  return apiSuccess(updated);
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id: pipelineId, stageId } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/deal-pipelines/${pipelineId}/stages/${stageId}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.DEALS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);

  const { data: existing } = await db
    .from("deal_stages")
    .select("id, is_default, is_terminal, terminal_type")
    .eq("id", stageId)
    .eq("pipeline_id", pipelineId)
    .maybeSingle();

  if (!existing) return apiNotFound("Stage");

  const existingRow = existing as unknown as {
    id: string;
    is_default: boolean;
    is_terminal: boolean;
    terminal_type: string | null;
  };

  const { count: dealCount } = await db
    .from("deals")
    .select("id", { count: "exact", head: true })
    .eq("stage_id", stageId)
    .is("deleted_at", null);

  if (dealCount && dealCount > 0) {
    return apiConflict(`Cannot delete stage with ${dealCount} deals. Move the deals first.`);
  }

  const { count: stageCount } = await db
    .from("deal_stages")
    .select("id", { count: "exact", head: true })
    .eq("pipeline_id", pipelineId);

  if (stageCount && stageCount <= 1) {
    return apiConflict("Cannot delete the last stage. A pipeline must have at least one stage.");
  }

  if (existingRow.is_terminal && existingRow.terminal_type) {
    const { count: terminalCount } = await db
      .from("deal_stages")
      .select("id", { count: "exact", head: true })
      .eq("pipeline_id", pipelineId)
      .eq("terminal_type", existingRow.terminal_type);

    if (terminalCount && terminalCount <= 1) {
      return apiConflict(
        `Cannot delete the only "${existingRow.terminal_type}" stage. Add another ${existingRow.terminal_type} stage first.`
      );
    }
  }

  const { error } = await db
    .from("deal_stages")
    .delete()
    .eq("id", stageId);

  if (error) {
    log.error({ error }, "Failed to delete deal stage");
    return apiError("DB_ERROR", "Failed to delete stage", 500);
  }

  if (existingRow.is_default) {
    const { data: firstStage } = await db
      .from("deal_stages")
      .select("id")
      .eq("pipeline_id", pipelineId)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();

    const firstRow = firstStage as unknown as { id: string } | null;
    if (firstRow) {
      await db
        .from("deal_stages")
        .update({ is_default: true })
        .eq("id", firstRow.id);
    }
  }

  log.info({ stageId }, "Deal stage deleted");
  return apiSuccess({ deleted: true });
}
