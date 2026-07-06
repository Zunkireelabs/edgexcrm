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
import { createNotificationsExcept, NotificationTypes } from "@/lib/notifications";
import { getSelfTenantUserId } from "@/lib/api/hr-scope";

interface Props {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: `/api/v1/leave/requests/${id}/approve`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

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

  // Authorization: HR, or the resolved approver for this request.
  if (!hasManageHR && (!selfId || row.approver_tenant_user_id !== selfId)) {
    return apiForbidden();
  }

  if (row.approval_status !== "pending") {
    return apiError("INVALID_STATE", "Only pending requests can be approved", 409);
  }

  // Atomic UPDATE: .eq("approval_status", "pending") is the TOCTOU precondition —
  // if the request was concurrently approved/rejected/cancelled, 0 rows update.
  const { data: updated, error: updateError } = await db
    .from("leave_requests")
    .update({
      approval_status: "approved",
      approved_by: auth.userId,
      approved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("approval_status", "pending")
    .select("*, leave_types(id, name, code, color, is_paid)")
    .maybeSingle();

  if (updateError) {
    log.error({ error: updateError }, "Failed to approve leave request");
    return apiError("DB_ERROR", "Failed to approve leave request", 500);
  }
  if (!updated) {
    return apiError("INVALID_STATE", "Only pending requests can be approved", 409);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "leave_request.approved",
      entityType: "leave_request",
      entityId: id,
      changes: { approval_status: { old: "pending", new: "approved" } },
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "leave_request.approved",
      entityType: "leave_request",
      entityId: id,
      requestId,
    }),
    createNotificationsExcept(auth.userId, [
      {
        tenantId: auth.tenantId,
        userId: row.user_id,
        type: NotificationTypes.LEAVE_APPROVED,
        title: "Leave request approved",
        message: "Your leave request has been approved.",
        link: "/leave",
      },
    ]),
  ]);

  log.info({ leaveRequestId: id }, "Leave request approved");
  return apiSuccess(updated);
}
