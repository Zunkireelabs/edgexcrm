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

// PATCH /api/v1/settings/email-rules/:id — update a rule
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const log = createRequestLogger({
    requestId: crypto.randomUUID(),
    method: "PATCH",
    path: `/api/v1/settings/email-rules/${id}`,
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

  const supabase = await createServiceClient();

  // Verify rule exists and belongs to tenant
  const { data: existing } = await supabase
    .from("email_forward_rules")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .single();

  if (!existing) return apiNotFound("Email rule");

  // If changing pipeline/stage, validate them
  if (body.pipeline_id || body.stage_id) {
    const pipelineId = body.pipeline_id as string | undefined;
    const stageId = body.stage_id as string | undefined;

    if (pipelineId && stageId) {
      const { data: stage } = await supabase
        .from("pipeline_stages")
        .select("id")
        .eq("id", stageId)
        .eq("pipeline_id", pipelineId)
        .eq("tenant_id", auth.tenantId)
        .single();

      if (!stage) {
        return apiValidationError({
          stage_id: ["Invalid stage or pipeline for this tenant"],
        });
      }
    }
  }

  const allowedFields = [
    "name", "is_active", "from_name", "pipeline_id", "stage_id",
    "subject", "body",
  ];

  const updatePayload: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updatePayload[field] = body[field];
    }
  }

  if (Object.keys(updatePayload).length === 0) {
    return apiValidationError({ body: ["No valid fields to update"] });
  }

  const { data: updated, error } = await supabase
    .from("email_forward_rules")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    log.error({ err: error }, "Failed to update email rule");
    return apiServiceUnavailable("Failed to update email rule");
  }

  log.info({ ruleId: id }, "Email forward rule updated");
  return apiSuccess({ ...updated, smtp_password: "••••••••" });
}

// DELETE /api/v1/settings/email-rules/:id — delete a rule
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const log = createRequestLogger({
    requestId: crypto.randomUUID(),
    method: "DELETE",
    path: `/api/v1/settings/email-rules/${id}`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  const supabase = await createServiceClient();

  const { data: existing } = await supabase
    .from("email_forward_rules")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .single();

  if (!existing) return apiNotFound("Email rule");

  const { error } = await supabase
    .from("email_forward_rules")
    .delete()
    .eq("id", id);

  if (error) {
    log.error({ err: error }, "Failed to delete email rule");
    return apiServiceUnavailable("Failed to delete email rule");
  }

  log.info({ ruleId: id }, "Email forward rule deleted");
  return apiSuccess({ deleted: true });
}
