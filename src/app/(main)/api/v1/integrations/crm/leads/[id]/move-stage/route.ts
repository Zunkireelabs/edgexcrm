import { NextRequest } from "next/server";
import {
  gateIntegrationRequest,
  buildLookupMaps,
  normalizeLead,
  logIntegrationAudit,
  emitIntegrationEvent,
  checkIdempotency,
  storeIdempotency,
  withIntegrationErrorBoundary,
} from "@/lib/api/integration-helpers";
import {
  apiSuccess,
  apiValidationError,
  apiNotFound,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { requirePermission } from "@/lib/api/integration-permissions";
import { validate, required, isUUID } from "@/lib/api/validation";
import type { Lead } from "@/types/database";

// POST /api/v1/integrations/crm/leads/:id/move-stage
export const POST = withIntegrationErrorBoundary(async function POST(
  request: NextRequest,
  context?: unknown
) {
  const { params } = context as { params: Promise<{ id: string }> };
  const { id } = await params;
  const gate = await gateIntegrationRequest(request);
  if (!gate.ok) return gate.response;
  const { ctx } = gate;

  const denied = requirePermission(ctx.auth, "write");
  if (denied) return denied;

  // Idempotency check
  const idempotencyKey = request.headers.get("idempotency-key");
  if (idempotencyKey) {
    const cached = await checkIdempotency(ctx.supabase, ctx.auth.tenantId, idempotencyKey);
    if (cached) return apiSuccess(cached);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const { valid, errors } = validate(body, {
    stage_id: [required("stage_id"), isUUID()],
  });
  if (!valid) return apiValidationError(errors);

  const tenantId = ctx.auth.tenantId;
  const newStageId = body.stage_id as string;

  // Verify lead exists
  const { data: existingLead } = await ctx.supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .single();

  if (!existingLead) {
    return apiNotFound("Lead");
  }

  // Validate target stage exists and belongs to tenant
  const { data: targetStage } = await ctx.supabase
    .from("pipeline_stages")
    .select("id, slug, name")
    .eq("id", newStageId)
    .eq("tenant_id", tenantId)
    .single();

  if (!targetStage) {
    return apiValidationError({
      stage_id: ["Invalid stage_id. No matching pipeline stage found for this tenant."],
    });
  }

  // Check if current stage is terminal
  if (existingLead.stage_id) {
    const { data: currentStage } = await ctx.supabase
      .from("pipeline_stages")
      .select("is_terminal, name")
      .eq("id", existingLead.stage_id)
      .single();

    if (currentStage?.is_terminal) {
      return apiValidationError({
        stage_id: [`Cannot move lead from terminal stage "${currentStage.name}"`],
      });
    }
  }

  const { data: updated, error } = await ctx.supabase
    .from("leads")
    .update({ stage_id: newStageId, status: targetStage.slug })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select()
    .single();

  if (error) {
    return apiServiceUnavailable("Failed to move lead stage");
  }

  await Promise.all([
    logIntegrationAudit(ctx, "integration.stage.changed", "lead", id, {
      stage_id: { old: existingLead.stage_id, new: newStageId },
      status: { old: existingLead.status, new: targetStage.slug },
    }),
    emitIntegrationEvent(ctx, "lead.status_changed", "lead", id, {
      old_status: existingLead.status,
      new_status: targetStage.slug,
      old_stage_id: existingLead.stage_id,
      new_stage_id: newStageId,
    }),
  ]);

  const { stageMap, userMap } = await buildLookupMaps(ctx.supabase, tenantId);
  const result = normalizeLead(updated as Lead, stageMap, userMap);

  // Store idempotency result
  if (idempotencyKey) {
    await storeIdempotency(ctx.supabase, tenantId, idempotencyKey, "move-stage", result);
  }

  return apiSuccess(result, 201);
});
