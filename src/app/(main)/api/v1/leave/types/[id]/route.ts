import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { canManageHR } from "@/lib/api/permissions";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { maxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createAuditLog } from "@/lib/api/audit";

interface Props {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/leave/types/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!canManageHR(auth.permissions)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const db = await scopedClient(auth);
  const { data: existing } = await db.from("leave_types").select("id").eq("id", id).maybeSingle();
  if (!existing) return apiNotFound("Leave type");

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const nameErr = maxLength(80)(body.name);
    if (nameErr || !String(body.name).trim()) {
      return apiValidationError({ name: [nameErr ?? "Name cannot be empty"] });
    }
    patch.name = String(body.name).trim();
  }
  if (body.code !== undefined) patch.code = body.code ? String(body.code).trim() : null;
  if (body.color !== undefined) patch.color = body.color ? String(body.color).trim() : null;
  if (body.is_paid !== undefined) patch.is_paid = !!body.is_paid;
  if (body.requires_approval !== undefined) patch.requires_approval = !!body.requires_approval;
  if (body.annual_allotment_days !== undefined) patch.annual_allotment_days = Number(body.annual_allotment_days);
  if (body.allow_half_day !== undefined) patch.allow_half_day = !!body.allow_half_day;
  if (body.carry_forward !== undefined) patch.carry_forward = !!body.carry_forward;
  if (body.max_carry_forward_days !== undefined) {
    patch.max_carry_forward_days = body.max_carry_forward_days === null ? null : Number(body.max_carry_forward_days);
  }
  if (body.sort_order !== undefined) patch.sort_order = Number(body.sort_order);
  if (body.is_active !== undefined) patch.is_active = !!body.is_active;

  if (Object.keys(patch).length === 0) {
    return apiValidationError({ body: ["No valid fields to update"] });
  }

  const { data: updated, error } = await db
    .from("leave_types")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return apiValidationError({ name: ["A leave type with this name already exists"] });
    }
    log.error({ error }, "Failed to update leave type");
    return apiError("DB_ERROR", "Failed to update leave type", 500);
  }

  await createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "leave_type.updated",
    entityType: "leave_type",
    entityId: id,
    changes: { patch: { old: existing, new: patch } },
    requestId,
  });

  log.info({ leaveTypeId: id }, "Leave type updated");
  return apiSuccess(updated);
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/leave/types/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!canManageHR(auth.permissions)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: existing } = await db.from("leave_types").select("id").eq("id", id).maybeSingle();
  if (!existing) return apiNotFound("Leave type");

  // Soft-delete via is_active — leave_requests reference leave_type_id and
  // should keep resolving historically, so we never hard-delete a type once
  // it may have been used.
  const { error } = await db.from("leave_types").update({ is_active: false }).eq("id", id);
  if (error) {
    log.error({ error }, "Failed to deactivate leave type");
    return apiError("DB_ERROR", "Failed to deactivate leave type", 500);
  }

  await createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "leave_type.deactivated",
    entityType: "leave_type",
    entityId: id,
    requestId,
  });

  log.info({ leaveTypeId: id }, "Leave type deactivated");
  return apiSuccess({ id, deleted: true });
}
