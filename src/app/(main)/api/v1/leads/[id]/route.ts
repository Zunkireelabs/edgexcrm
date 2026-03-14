import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireAdmin, requireLeadAccess, getClientIp } from "@/lib/api/auth";
import {
  apiSuccess,
  apiValidationError,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { createRequestLogger } from "@/lib/logger";
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
  "step",
  "is_final",
  "intake_source",
  "intake_medium",
  "intake_campaign",
  "preferred_contact_method",
] as const;

const ADMIN_ONLY_FIELDS = ["assigned_to"];

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "GET",
    path: `/api/v1/leads/${id}`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const supabase = await createServiceClient();
  const { data: lead, error } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (error || !lead) {
    log.info({ leadId: id }, "Lead not found");
    return apiNotFound("Lead");
  }

  // Counselor scoping: can only view assigned leads
  if (auth.role === "counselor" && lead.assigned_to !== auth.userId) {
    return apiNotFound("Lead");
  }

  return apiSuccess(lead as Lead);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || null;
  const log = createRequestLogger({
    requestId,
    method: "PATCH",
    path: `/api/v1/leads/${id}`,
    ip,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const supabase = await createServiceClient();

  // Fetch existing lead for audit diff + access check
  const { data: existingLead } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (!existingLead) {
    log.info({ leadId: id }, "Lead not found for update");
    return apiNotFound("Lead");
  }

  // Access check: admin or counselor with assignment
  if (!requireLeadAccess(auth, existingLead)) {
    return apiForbidden();
  }

  // Counselor cannot update admin-only fields
  if (auth.role === "counselor") {
    for (const field of ADMIN_ONLY_FIELDS) {
      if (body[field] !== undefined) {
        return apiForbidden();
      }
    }
  }

  // Dual-mode status/stage_id resolution
  if (body.status !== undefined && body.stage_id !== undefined) {
    return apiValidationError({
      status: ["Cannot provide both status and stage_id. Use one or the other."],
    });
  }

  if (body.status && typeof body.status === "string") {
    // Resolve stage_id from status slug
    const { data: stage } = await supabase
      .from("pipeline_stages")
      .select("id")
      .eq("tenant_id", auth.tenantId)
      .eq("slug", body.status)
      .single();

    if (!stage) {
      return apiValidationError({
        status: [`Invalid status: "${body.status}". No matching pipeline stage found.`],
      });
    }

    body.stage_id = stage.id;
  } else if (body.stage_id && typeof body.stage_id === "string") {
    // Resolve status slug from stage_id
    const { data: stage } = await supabase
      .from("pipeline_stages")
      .select("slug")
      .eq("id", body.stage_id)
      .eq("tenant_id", auth.tenantId)
      .single();

    if (!stage) {
      return apiValidationError({
        stage_id: ["Invalid stage_id. No matching pipeline stage found."],
      });
    }

    body.status = stage.slug;
  }

  // Validate assigned_to: must be a tenant member
  if (body.assigned_to !== undefined && body.assigned_to !== null) {
    const { data: memberCheck } = await supabase
      .from("tenant_users")
      .select("user_id")
      .eq("tenant_id", auth.tenantId)
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

  const { data: updated, error } = await supabase
    .from("leads")
    .update(updatePayload)
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .select()
    .single();

  if (error) {
    log.error({ err: error }, "Failed to update lead");
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

  log.info({ leadId: id, changes }, "Lead updated");

  const statusChanged = body.status && body.status !== existingLead.status;
  const assignedChanged =
    updatePayload.assigned_to !== undefined &&
    existingLead.assigned_to !== updated.assigned_to;

  Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "lead.updated",
      entityType: "lead",
      entityId: id,
      changes,
      ipAddress: ip,
      userAgent,
      requestId,
    }),
    ...(statusChanged
      ? [
          emitEvent({
            tenantId: auth.tenantId,
            type: "lead.status_changed",
            entityType: "lead",
            entityId: id,
            payload: {
              old_status: existingLead.status,
              new_status: body.status,
            },
            requestId,
          }),
        ]
      : []),
    ...(assignedChanged
      ? [
          emitEvent({
            tenantId: auth.tenantId,
            type: "lead.assigned",
            entityType: "lead",
            entityId: id,
            payload: {
              old_assigned_to: existingLead.assigned_to,
              new_assigned_to: updated.assigned_to,
            },
            requestId,
          }),
        ]
      : []),
  ]);

  return apiSuccess(updated as Lead);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || null;
  const log = createRequestLogger({
    requestId,
    method: "DELETE",
    path: `/api/v1/leads/${id}`,
    ip,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  const supabase = await createServiceClient();

  // Verify lead exists and belongs to tenant
  const { data: existingLead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (!existingLead) {
    log.info({ leadId: id }, "Lead not found for deletion");
    return apiNotFound("Lead");
  }

  // Soft delete
  const { error } = await supabase
    .from("leads")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", auth.tenantId);

  if (error) {
    log.error({ err: error }, "Failed to soft delete lead");
    return apiServiceUnavailable("Failed to delete lead");
  }

  log.info({ leadId: id }, "Lead soft deleted");

  Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "lead.deleted",
      entityType: "lead",
      entityId: id,
      ipAddress: ip,
      userAgent,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "lead.deleted",
      entityType: "lead",
      entityId: id,
      requestId,
    }),
  ]);

  return apiSuccess({ id, deleted: true });
}
