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
import { validate, required, maxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { createNotificationsExcept, NotificationTypes } from "@/lib/notifications";
import { getSelfTenantUserId } from "@/lib/api/hr-scope";

interface Props {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: `/api/v1/leave/requests/${id}/reject`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    reason: [required("reason"), maxLength(500)],
  });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);
  const hasManageHR = canManageHR(auth.permissions);
  const selfId = await getSelfTenantUserId(db, auth);

  const { data: existing, error: fetchError } = await db
    .from("leave_requests")
    .select("id, approval_status, user_id, approver_tenant_user_id")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) return apiError("DB_ERROR", "Failed to fetch leave request", 500);
  if (!existing) return apiNotFound("Leave request");

  const row = existing as unknown as {
    id: string;
    approval_status: string;
    user_id: string;
    approver_tenant_user_id: string | null;
  };

  if (!hasManageHR && (!selfId || row.approver_tenant_user_id !== selfId)) {
    return apiForbidden();
  }

  if (row.approval_status !== "pending") {
    return apiError("INVALID_STATE", "Only pending requests can be rejected", 409);
  }

  const reason = String(body.reason).trim();

  const { data: updated, error: updateError } = await db
    .from("leave_requests")
    .update({
      approval_status: "rejected",
      rejection_reason: reason,
    })
    .eq("id", id)
    .eq("approval_status", "pending")
    .select("*, leave_types(id, name, code, color, is_paid)")
    .maybeSingle();

  if (updateError) {
    log.error({ error: updateError }, "Failed to reject leave request");
    return apiError("DB_ERROR", "Failed to reject leave request", 500);
  }
  if (!updated) {
    return apiError("INVALID_STATE", "Only pending requests can be rejected", 409);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "leave_request.rejected",
      entityType: "leave_request",
      entityId: id,
      changes: {
        approval_status: { old: "pending", new: "rejected" },
        rejection_reason: { old: null, new: reason },
      },
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "leave_request.rejected",
      entityType: "leave_request",
      entityId: id,
      requestId,
      payload: { rejection_reason: reason },
    }),
    createNotificationsExcept(auth.userId, [
      {
        tenantId: auth.tenantId,
        userId: row.user_id,
        type: NotificationTypes.LEAVE_REJECTED,
        title: "Leave request rejected",
        message: `Your leave request was rejected: ${reason}`,
        link: "/leave",
      },
    ]),
  ]);

  log.info({ leaveRequestId: id }, "Leave request rejected");
  return apiSuccess(updated);
}
