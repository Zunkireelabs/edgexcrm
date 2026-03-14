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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; checklistId: string }> }
) {
  const { id, checklistId } = await params;
  const requestId = crypto.randomUUID();
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || null;
  const log = createRequestLogger({
    requestId,
    method: "PATCH",
    path: `/api/v1/leads/${id}/checklists/${checklistId}`,
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

  // Verify lead exists, not soft-deleted, tenant scoped
  const { data: lead } = await supabase
    .from("leads")
    .select("id, assigned_to")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (!lead) return apiNotFound("Lead");

  // Access check
  if (!requireLeadAccess(auth, lead)) {
    return apiForbidden();
  }

  // Fetch existing checklist item
  const { data: existing } = await supabase
    .from("lead_checklists")
    .select("*")
    .eq("id", checklistId)
    .eq("lead_id", id)
    .eq("tenant_id", auth.tenantId)
    .single();

  if (!existing) return apiNotFound("Checklist item");

  // Build update payload based on role
  const updatePayload: Record<string, unknown> = {};

  // Counselor can only toggle is_completed
  if (auth.role === "counselor") {
    if (body.title !== undefined || body.position !== undefined) {
      return apiForbidden();
    }
    if (body.is_completed !== undefined) {
      updatePayload.is_completed = body.is_completed;
    }
  } else {
    // Admin: can update title, position, is_completed
    if (body.title !== undefined) {
      if (typeof body.title !== "string" || body.title.length > 255) {
        return apiValidationError({ title: ["Must be at most 255 characters"] });
      }
      updatePayload.title = body.title;
    }
    if (body.position !== undefined) {
      const pos = Number(body.position);
      if (!Number.isInteger(pos) || pos < 0) {
        return apiValidationError({ position: ["Must be a non-negative integer"] });
      }
      updatePayload.position = pos;
    }
    if (body.is_completed !== undefined) {
      updatePayload.is_completed = body.is_completed;
    }
  }

  // Handle completion timestamps
  if (updatePayload.is_completed !== undefined) {
    if (updatePayload.is_completed) {
      updatePayload.completed_at = new Date().toISOString();
      updatePayload.completed_by = auth.userId;
    } else {
      updatePayload.completed_at = null;
      updatePayload.completed_by = null;
    }
  }

  if (Object.keys(updatePayload).length === 0) {
    return apiValidationError({ body: ["No valid fields to update"] });
  }

  const { data: updated, error } = await supabase
    .from("lead_checklists")
    .update(updatePayload)
    .eq("id", checklistId)
    .eq("lead_id", id)
    .select()
    .single();

  if (error) {
    log.error({ err: error }, "Failed to update checklist item");
    return apiServiceUnavailable("Failed to update checklist item");
  }

  // Build audit diff
  const changes: Record<string, { old: unknown; new: unknown }> = {};
  for (const field of Object.keys(updatePayload)) {
    const oldVal = (existing as Record<string, unknown>)[field];
    const newVal = (updated as Record<string, unknown>)[field];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes[field] = { old: oldVal, new: newVal };
    }
  }

  log.info({ checklistId, leadId: id, changes }, "Checklist item updated");

  Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "checklist.updated",
      entityType: "checklist",
      entityId: checklistId,
      changes,
      ipAddress: ip,
      userAgent,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "checklist.updated",
      entityType: "checklist",
      entityId: checklistId,
      payload: { lead_id: id, changes },
      requestId,
    }),
  ]);

  return apiSuccess(updated);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; checklistId: string }> }
) {
  const { id, checklistId } = await params;
  const requestId = crypto.randomUUID();
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || null;
  const log = createRequestLogger({
    requestId,
    method: "DELETE",
    path: `/api/v1/leads/${id}/checklists/${checklistId}`,
    ip,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  const supabase = await createServiceClient();

  // Verify lead exists, not soft-deleted, tenant scoped
  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (!lead) return apiNotFound("Lead");

  // Verify checklist item exists
  const { data: existing } = await supabase
    .from("lead_checklists")
    .select("id, title")
    .eq("id", checklistId)
    .eq("lead_id", id)
    .eq("tenant_id", auth.tenantId)
    .single();

  if (!existing) return apiNotFound("Checklist item");

  // Hard delete
  const { error } = await supabase
    .from("lead_checklists")
    .delete()
    .eq("id", checklistId);

  if (error) {
    log.error({ err: error }, "Failed to delete checklist item");
    return apiServiceUnavailable("Failed to delete checklist item");
  }

  log.info({ checklistId, leadId: id }, "Checklist item deleted");

  Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "checklist.deleted",
      entityType: "checklist",
      entityId: checklistId,
      changes: { title: { old: existing.title, new: null } },
      ipAddress: ip,
      userAgent,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "checklist.deleted",
      entityType: "checklist",
      entityId: checklistId,
      payload: { lead_id: id },
      requestId,
    }),
  ]);

  return apiSuccess({ id: checklistId, deleted: true });
}
