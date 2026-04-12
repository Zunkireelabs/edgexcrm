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
import { validate, maxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import type { PipelineWithStages, PipelineStageWithCount } from "@/types/database";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/v1/pipelines/:id - Get pipeline with stages
export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "GET",
    path: `/api/v1/pipelines/${id}`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  log.info({ tenantId: auth.tenantId, pipelineId: id }, "Fetching pipeline");

  const supabase = await createServiceClient();

  // Fetch pipeline
  const { data: pipeline, error: pipelineError } = await supabase
    .from("pipelines")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .single();

  if (pipelineError || !pipeline) {
    return apiNotFound("Pipeline");
  }

  // Fetch stages
  const { data: stages, error: stagesError } = await supabase
    .from("pipeline_stages")
    .select("*")
    .eq("pipeline_id", id)
    .order("position", { ascending: true });

  if (stagesError) {
    log.error({ err: stagesError }, "Failed to fetch stages");
    return apiServiceUnavailable("Failed to fetch pipeline stages");
  }

  // Get lead counts per stage
  const { data: leadCounts } = await supabase
    .from("leads")
    .select("stage_id")
    .eq("pipeline_id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null);

  const leadCountMap = new Map<string, number>();
  for (const l of leadCounts || []) {
    if (l.stage_id) {
      leadCountMap.set(l.stage_id, (leadCountMap.get(l.stage_id) || 0) + 1);
    }
  }

  const stagesWithCounts: PipelineStageWithCount[] = (stages || []).map((s) => ({
    ...s,
    lead_count: leadCountMap.get(s.id) || 0,
  }));

  const totalLeads = (leadCounts || []).length;

  const result: PipelineWithStages = {
    ...pipeline,
    stages: stagesWithCounts,
    lead_count: totalLeads,
  };

  log.info({ pipelineId: id, stageCount: stagesWithCounts.length }, "Pipeline fetched");
  return apiSuccess(result);
}

// PATCH /api/v1/pipelines/:id - Update pipeline
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "PATCH",
    path: `/api/v1/pipelines/${id}`,
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
  });
  if (!valid) return apiValidationError(errors);

  log.info({ tenantId: auth.tenantId, pipelineId: id }, "Updating pipeline");

  const supabase = await createServiceClient();

  // Check pipeline exists and belongs to tenant
  const { data: existing } = await supabase
    .from("pipelines")
    .select("id, is_default")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .single();

  if (!existing) {
    return apiNotFound("Pipeline");
  }

  // Build update payload
  const updatePayload: Record<string, unknown> = {};

  if (body.name !== undefined) {
    updatePayload.name = body.name;
    // Update slug if name changes
    updatePayload.slug = (body.name as string)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    // Check for duplicate slug
    const { data: duplicate } = await supabase
      .from("pipelines")
      .select("id")
      .eq("tenant_id", auth.tenantId)
      .eq("slug", updatePayload.slug)
      .neq("id", id)
      .single();

    if (duplicate) {
      return apiValidationError({ name: ["A pipeline with this name already exists"] });
    }
  }

  if (body.is_default !== undefined) {
    updatePayload.is_default = body.is_default;
    // The database trigger will unset is_default on other pipelines
  }

  if (body.description !== undefined) {
    updatePayload.description = body.description;
  }

  if (Object.keys(updatePayload).length === 0) {
    return apiValidationError({ body: ["No valid fields to update"] });
  }

  const { data: updated, error: updateError } = await supabase
    .from("pipelines")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (updateError) {
    log.error({ err: updateError }, "Failed to update pipeline");
    return apiServiceUnavailable("Failed to update pipeline");
  }

  log.info({ pipelineId: id }, "Pipeline updated");
  return apiSuccess(updated);
}

// DELETE /api/v1/pipelines/:id - Delete pipeline
export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "DELETE",
    path: `/api/v1/pipelines/${id}`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  log.info({ tenantId: auth.tenantId, pipelineId: id }, "Deleting pipeline");

  const supabase = await createServiceClient();

  // Check pipeline exists and belongs to tenant
  const { data: existing } = await supabase
    .from("pipelines")
    .select("id, is_default, name")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .single();

  if (!existing) {
    return apiNotFound("Pipeline");
  }

  // Cannot delete default pipeline
  if (existing.is_default) {
    return apiConflict("Cannot delete the default pipeline. Set another pipeline as default first.");
  }

  // Check if pipeline has leads
  const { count: leadCount } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("pipeline_id", id)
    .is("deleted_at", null);

  if (leadCount && leadCount > 0) {
    return apiConflict(`Cannot delete pipeline with ${leadCount} leads. Move or delete the leads first.`);
  }

  // Check this isn't the last pipeline
  const { count: pipelineCount } = await supabase
    .from("pipelines")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", auth.tenantId)
    .eq("is_active", true);

  if (pipelineCount && pipelineCount <= 1) {
    return apiConflict("Cannot delete the last pipeline. Create another pipeline first.");
  }

  // Delete stages first (cascade should handle this, but being explicit)
  await supabase.from("pipeline_stages").delete().eq("pipeline_id", id);

  // Delete pipeline
  const { error: deleteError } = await supabase
    .from("pipelines")
    .delete()
    .eq("id", id);

  if (deleteError) {
    log.error({ err: deleteError }, "Failed to delete pipeline");
    return apiServiceUnavailable("Failed to delete pipeline");
  }

  log.info({ pipelineId: id }, "Pipeline deleted");
  return apiSuccess({ deleted: true });
}
