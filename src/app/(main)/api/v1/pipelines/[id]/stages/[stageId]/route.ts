import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiValidationError,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiConflict,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { validate, maxLength, isIn } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";

interface RouteContext {
  params: Promise<{ id: string; stageId: string }>;
}

// PATCH /api/v1/pipelines/:id/stages/:stageId - Update stage
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id: pipelineId, stageId } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "PATCH",
    path: `/api/v1/pipelines/${pipelineId}/stages/${stageId}`,
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

  const { valid, errors } = validate(body, {
    name: [maxLength(100)],
    color: [maxLength(7)],
    terminal_type: [isIn(["won", "lost"])],
  });
  if (!valid) return apiValidationError(errors);

  log.info({ tenantId: auth.tenantId, pipelineId, stageId }, "Updating stage");

  const supabase = await createServiceClient();

  // Check stage exists and belongs to the pipeline in this tenant
  const { data: existing } = await supabase
    .from("pipeline_stages")
    .select("*")
    .eq("id", stageId)
    .eq("pipeline_id", pipelineId)
    .eq("tenant_id", auth.tenantId)
    .single();

  if (!existing) {
    return apiNotFound("Stage");
  }

  // Build update payload
  const updatePayload: Record<string, unknown> = {};

  if (body.name !== undefined) {
    updatePayload.name = body.name;
  }

  if (body.color !== undefined) {
    updatePayload.color = body.color;
  }

  if (body.is_terminal !== undefined) {
    updatePayload.is_terminal = body.is_terminal;
    if (!body.is_terminal) {
      updatePayload.terminal_type = null;
    }
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

    // If setting as default, unset other defaults
    if (body.is_default === true) {
      await supabase
        .from("pipeline_stages")
        .update({ is_default: false })
        .eq("pipeline_id", pipelineId)
        .eq("is_default", true)
        .neq("id", stageId);
    }
  }

  if (Object.keys(updatePayload).length === 0) {
    return apiValidationError({ body: ["No valid fields to update"] });
  }

  const { data: updated, error: updateError } = await supabase
    .from("pipeline_stages")
    .update(updatePayload)
    .eq("id", stageId)
    .select()
    .single();

  if (updateError) {
    log.error({ err: updateError }, "Failed to update stage");
    return apiServiceUnavailable("Failed to update stage");
  }

  log.info({ stageId }, "Stage updated");
  return apiSuccess(updated);
}

// DELETE /api/v1/pipelines/:id/stages/:stageId - Delete stage
export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id: pipelineId, stageId } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "DELETE",
    path: `/api/v1/pipelines/${pipelineId}/stages/${stageId}`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  log.info({ tenantId: auth.tenantId, pipelineId, stageId }, "Deleting stage");

  const supabase = await createServiceClient();

  // Check stage exists and belongs to the pipeline in this tenant
  const { data: existing } = await supabase
    .from("pipeline_stages")
    .select("id, is_default, is_terminal, terminal_type")
    .eq("id", stageId)
    .eq("pipeline_id", pipelineId)
    .eq("tenant_id", auth.tenantId)
    .single();

  if (!existing) {
    return apiNotFound("Stage");
  }

  // Check if stage has leads
  const { count: leadCount } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("stage_id", stageId)
    .is("deleted_at", null);

  if (leadCount && leadCount > 0) {
    return apiConflict(`Cannot delete stage with ${leadCount} leads. Move the leads first.`);
  }

  // Check this isn't the last stage
  const { count: stageCount } = await supabase
    .from("pipeline_stages")
    .select("id", { count: "exact", head: true })
    .eq("pipeline_id", pipelineId);

  if (stageCount && stageCount <= 1) {
    return apiConflict("Cannot delete the last stage. A pipeline must have at least one stage.");
  }

  // Check we're not deleting the only won or lost stage
  if (existing.is_terminal && existing.terminal_type) {
    const { count: terminalCount } = await supabase
      .from("pipeline_stages")
      .select("id", { count: "exact", head: true })
      .eq("pipeline_id", pipelineId)
      .eq("terminal_type", existing.terminal_type);

    if (terminalCount && terminalCount <= 1) {
      return apiConflict(
        `Cannot delete the only "${existing.terminal_type}" stage. Add another ${existing.terminal_type} stage first.`
      );
    }
  }

  // Delete the stage
  const { error: deleteError } = await supabase
    .from("pipeline_stages")
    .delete()
    .eq("id", stageId);

  if (deleteError) {
    log.error({ err: deleteError }, "Failed to delete stage");
    return apiServiceUnavailable("Failed to delete stage");
  }

  // If we deleted the default stage, set the first remaining stage as default
  if (existing.is_default) {
    const { data: firstStage } = await supabase
      .from("pipeline_stages")
      .select("id")
      .eq("pipeline_id", pipelineId)
      .order("position", { ascending: true })
      .limit(1)
      .single();

    if (firstStage) {
      await supabase
        .from("pipeline_stages")
        .update({ is_default: true })
        .eq("id", firstStage.id);
    }
  }

  log.info({ stageId }, "Stage deleted");
  return apiSuccess({ deleted: true });
}
