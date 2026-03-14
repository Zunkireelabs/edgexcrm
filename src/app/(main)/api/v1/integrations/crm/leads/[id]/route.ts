import { NextRequest } from "next/server";
import {
  gateIntegrationRequest,
  buildLookupMaps,
  normalizeLead,
  logIntegrationAudit,
  emitIntegrationEvent,
  withIntegrationErrorBoundary,
} from "@/lib/api/integration-helpers";
import {
  apiSuccess,
  apiValidationError,
  apiNotFound,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { requirePermission } from "@/lib/api/integration-permissions";
import type { Lead } from "@/types/database";

const UPDATABLE_FIELDS = [
  "status",
  "stage_id",
  "assigned_to",
  "first_name",
  "last_name",
  "email",
  "phone",
  "city",
  "country",
  "custom_fields",
  "file_urls",
  "intake_source",
  "intake_medium",
  "intake_campaign",
  "preferred_contact_method",
] as const;

// GET /api/v1/integrations/crm/leads/:id
export const GET = withIntegrationErrorBoundary(async function GET(
  request: NextRequest,
  context?: unknown
) {
  const { params } = context as { params: Promise<{ id: string }> };
  const { id } = await params;
  const gate = await gateIntegrationRequest(request);
  if (!gate.ok) return gate.response;
  const { ctx } = gate;

  const denied = requirePermission(ctx.auth, "read");
  if (denied) return denied;

  const { data: lead, error } = await ctx.supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", ctx.auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (error || !lead) {
    return apiNotFound("Lead");
  }

  const { stageMap, userMap } = await buildLookupMaps(ctx.supabase, ctx.auth.tenantId);

  // Fetch checklist summary
  const { data: checklists } = await ctx.supabase
    .from("lead_checklists")
    .select("is_completed")
    .eq("lead_id", id);

  const checklistTotal = checklists?.length || 0;
  const checklistCompleted = checklists?.filter((c) => c.is_completed).length || 0;

  const normalized = {
    ...normalizeLead(lead as Lead, stageMap, userMap),
    checklist_total: checklistTotal,
    checklist_completed: checklistCompleted,
  };

  return apiSuccess(normalized);
});

// PATCH /api/v1/integrations/crm/leads/:id
export const PATCH = withIntegrationErrorBoundary(async function PATCH(
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

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const tenantId = ctx.auth.tenantId;

  // Fetch existing lead
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

  // Dual-mode status/stage_id resolution (same logic as dashboard route)
  if (body.status !== undefined && body.stage_id !== undefined) {
    return apiValidationError({
      status: ["Cannot provide both status and stage_id. Use one or the other."],
    });
  }

  if (body.status && typeof body.status === "string") {
    const { data: stage } = await ctx.supabase
      .from("pipeline_stages")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("slug", body.status)
      .single();

    if (!stage) {
      return apiValidationError({
        status: [`Invalid status: "${body.status}". No matching pipeline stage found.`],
      });
    }
    body.stage_id = stage.id;
  } else if (body.stage_id && typeof body.stage_id === "string") {
    const { data: stage } = await ctx.supabase
      .from("pipeline_stages")
      .select("slug")
      .eq("id", body.stage_id)
      .eq("tenant_id", tenantId)
      .single();

    if (!stage) {
      return apiValidationError({
        stage_id: ["Invalid stage_id. No matching pipeline stage found."],
      });
    }
    body.status = stage.slug;
  }

  // Validate assigned_to: must be tenant member
  if (body.assigned_to !== undefined && body.assigned_to !== null) {
    const { data: memberCheck } = await ctx.supabase
      .from("tenant_users")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", body.assigned_to as string)
      .single();

    if (!memberCheck) {
      return apiValidationError({
        assigned_to: ["Assigned user is not a member of this tenant"],
      });
    }
  }

  // Build update payload from whitelist
  const updatePayload: Record<string, unknown> = {};
  for (const field of UPDATABLE_FIELDS) {
    if (body[field] !== undefined) {
      updatePayload[field] = body[field];
    }
  }

  if (Object.keys(updatePayload).length === 0) {
    return apiValidationError({ body: ["No valid fields to update"] });
  }

  const { data: updated, error } = await ctx.supabase
    .from("leads")
    .update(updatePayload)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select()
    .single();

  if (error) {
    return apiServiceUnavailable("Failed to update lead");
  }

  // Build audit diff
  const changes: Record<string, { old: unknown; new: unknown }> = {};
  for (const field of Object.keys(updatePayload)) {
    const oldVal = (existingLead as Record<string, unknown>)[field];
    const newVal = (updated as Record<string, unknown>)[field];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes[field] = { old: oldVal, new: newVal };
    }
  }

  const statusChanged = body.status && body.status !== existingLead.status;
  const assignedChanged =
    updatePayload.assigned_to !== undefined &&
    existingLead.assigned_to !== updated.assigned_to;

  const promises: Promise<unknown>[] = [
    logIntegrationAudit(ctx, "integration.lead.updated", "lead", id, changes),
  ];

  if (statusChanged) {
    promises.push(
      emitIntegrationEvent(ctx, "lead.status_changed", "lead", id, {
        old_status: existingLead.status,
        new_status: body.status,
      })
    );
  }
  if (assignedChanged) {
    promises.push(
      emitIntegrationEvent(ctx, "lead.assigned", "lead", id, {
        old_assigned_to: existingLead.assigned_to,
        new_assigned_to: updated.assigned_to,
      })
    );
  }

  await Promise.all(promises);

  const { stageMap, userMap } = await buildLookupMaps(ctx.supabase, tenantId);
  return apiSuccess(normalizeLead(updated as Lead, stageMap, userMap));
});
