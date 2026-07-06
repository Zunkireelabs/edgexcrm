import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { canManageHR } from "@/lib/api/permissions";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { getSelfTenantUserId, canReadEmployee } from "@/lib/api/hr-scope";

interface Props {
  params: Promise<{ id: string }>;
}

interface LeaveRequestRow {
  id: string;
  tenant_user_id: string;
  approval_status: string;
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);
  const selfId = await getSelfTenantUserId(db, auth);

  const { data: entry, error } = await db
    .from("leave_requests")
    .select("*, leave_types(id, name, code, color, is_paid)")
    .eq("id", id)
    .maybeSingle();

  if (error) return apiError("DB_ERROR", "Failed to fetch leave request", 500);
  if (!entry) return apiNotFound("Leave request");

  const row = entry as unknown as LeaveRequestRow;
  const hasManageHR = canManageHR(auth.permissions);
  const allowed = await canReadEmployee(db, selfId, hasManageHR, row.tenant_user_id);
  if (!allowed) return apiForbidden();

  return apiSuccess(entry);
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/leave/requests/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  if (body.approval_status !== "cancelled") {
    return apiError("VALIDATION_ERROR", "Only cancelling a pending request is supported here", 422);
  }

  const db = await scopedClient(auth);
  const selfId = await getSelfTenantUserId(db, auth);
  if (!selfId) return apiError("NOT_FOUND", "No tenant membership found for the current user", 404);

  const { data: existing } = await db
    .from("leave_requests")
    .select("id, tenant_user_id, approval_status")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Leave request");

  const row = existing as unknown as LeaveRequestRow;
  if (row.tenant_user_id !== selfId) return apiForbidden();

  const { data: updated, error } = await db
    .from("leave_requests")
    .update({ approval_status: "cancelled" })
    .eq("id", id)
    .eq("approval_status", "pending")
    .select("*, leave_types(id, name, code, color, is_paid)")
    .maybeSingle();

  if (error) {
    log.error({ error }, "Failed to cancel leave request");
    return apiError("DB_ERROR", "Failed to cancel leave request", 500);
  }
  if (!updated) {
    return apiError("INVALID_STATE", "Only pending requests can be cancelled", 409);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "leave_request.cancelled",
      entityType: "leave_request",
      entityId: id,
      changes: { approval_status: { old: "pending", new: "cancelled" } },
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "leave_request.cancelled",
      entityType: "leave_request",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ leaveRequestId: id }, "Leave request cancelled");
  return apiSuccess(updated);
}
