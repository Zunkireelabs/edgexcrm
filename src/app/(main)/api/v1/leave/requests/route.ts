import { NextRequest } from "next/server";
import { authenticateRequest, type AuthContext } from "@/lib/api/auth";
import { canManageHR } from "@/lib/api/permissions";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { validate, required, isUUID } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { createNotificationsExcept, getTenantAdminRecipients, NotificationTypes } from "@/lib/notifications";
import { getSelfTenantUserId, getDirectReportIds } from "@/lib/api/hr-scope";
import { resolveApprover, getHolidaySet } from "@/lib/hr/leave";
import { countLeaveDays } from "@/lib/hr/dates";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);
  const selfId = await getSelfTenantUserId(db, auth);
  if (!selfId) return apiError("NOT_FOUND", "No tenant membership found for the current user", 404);

  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") ?? "mine";
  const status = searchParams.get("status");
  const from = searchParams.get("from");
  const hasManageHR = canManageHR(auth.permissions);

  let query = db
    .from("leave_requests")
    .select("*, leave_types(id, name, code, color, is_paid)");

  if (scope === "all") {
    if (!hasManageHR) return apiForbidden();
  } else if (scope === "team") {
    const reportIds = await getDirectReportIds(db, selfId);
    if (reportIds.length === 0) return apiSuccess([]);
    query = query.in("tenant_user_id", reportIds);
  } else {
    query = query.eq("tenant_user_id", selfId);
  }

  if (status) query = query.eq("approval_status", status);
  if (from && DATE_RE.test(from)) query = query.gte("start_date", from);

  const { data, error } = await query.order("start_date", { ascending: false });
  if (error) return apiError("DB_ERROR", "Failed to fetch leave requests", 500);
  return apiSuccess(data ?? []);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/leave/requests" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);
  const hasManageHR = canManageHR(auth.permissions);
  const selfId = await getSelfTenantUserId(db, auth);
  if (!selfId) return apiError("NOT_FOUND", "No tenant membership found for the current user", 404);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    leave_type_id: [required("leave_type_id"), isUUID()],
    start_date: [required("start_date")],
    end_date: [required("end_date")],
    tenant_user_id: [isUUID()],
  });
  if (!valid) return apiValidationError(errors);
  if (!DATE_RE.test(String(body.start_date)) || !DATE_RE.test(String(body.end_date))) {
    return apiValidationError({ start_date: ["Must be a valid date (YYYY-MM-DD)"] });
  }
  if (String(body.end_date) < String(body.start_date)) {
    return apiValidationError({ end_date: ["End date cannot be before start date"] });
  }

  // Only canManageHR may file on behalf of someone else.
  const targetTenantUserId = body.tenant_user_id ? String(body.tenant_user_id) : selfId;
  if (targetTenantUserId !== selfId && !hasManageHR) return apiForbidden();

  const startDate = String(body.start_date);
  const endDate = String(body.end_date);
  const startHalf = !!body.start_half;
  const endHalf = !!body.end_half;
  if (startDate === endDate && startHalf && endHalf) {
    return apiValidationError({ start_half: ["A single-day request can only be a half-day on one side"] });
  }

  const [leaveTypeRes, employeeRes, tenantRes] = await Promise.all([
    db.from("leave_types").select("id, is_active, allow_half_day").eq("id", String(body.leave_type_id)).maybeSingle(),
    db.from("tenant_users").select("id, user_id, branch_id").eq("id", targetTenantUserId).maybeSingle(),
    db.raw().from("tenants").select("timezone, weekend_days").eq("id", auth.tenantId).single(),
  ]);

  const leaveType = leaveTypeRes.data as unknown as { id: string; is_active: boolean; allow_half_day: boolean } | null;
  if (!leaveType) return apiNotFound("Leave type");
  if (!leaveType.is_active) return apiValidationError({ leave_type_id: ["This leave type is no longer active"] });
  if ((startHalf || endHalf) && !leaveType.allow_half_day) {
    return apiValidationError({ start_half: ["This leave type does not allow half-days"] });
  }

  const employee = employeeRes.data as unknown as { id: string; user_id: string; branch_id: string | null } | null;
  if (!employee) return apiNotFound("Employee");

  const tenantLocale = tenantRes.data as unknown as { timezone: string; weekend_days: number[] } | null;
  const weekendDays = tenantLocale?.weekend_days ?? [6];

  const holidays = await getHolidaySet(db, employee.branch_id, startDate, endDate);
  const totalDays = countLeaveDays(startDate, endDate, { weekendDays, holidays, startHalf, endHalf });
  if (totalDays <= 0) {
    return apiValidationError({ start_date: ["This range contains no working days"] });
  }

  const approverTenantUserId = await resolveApprover(db, targetTenantUserId);

  const { data: created, error } = await db
    .from("leave_requests")
    .insert({
      user_id: employee.user_id,
      tenant_user_id: targetTenantUserId,
      leave_type_id: String(body.leave_type_id),
      start_date: startDate,
      end_date: endDate,
      start_half: startHalf,
      end_half: endHalf,
      total_days: totalDays,
      reason: body.reason ? String(body.reason).trim() : null,
      approval_status: "pending",
      approver_tenant_user_id: approverTenantUserId,
    })
    .select("*, leave_types(id, name, code, color, is_paid)")
    .single();

  if (error) {
    log.error({ error }, "Failed to create leave request");
    return apiError("DB_ERROR", "Failed to create leave request", 500);
  }

  const createdId = (created as { id: string }).id;

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "leave_request.created",
      entityType: "leave_request",
      entityId: createdId,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "leave_request.created",
      entityType: "leave_request",
      entityId: createdId,
      requestId,
      payload: { tenant_user_id: targetTenantUserId, leave_type_id: String(body.leave_type_id), total_days: totalDays },
    }),
    notifyApproverOrHR(db, auth, approverTenantUserId),
  ]);

  log.info({ leaveRequestId: createdId, totalDays }, "Leave request created");
  return apiSuccess(created, 201);
}

async function notifyApproverOrHR(
  db: Awaited<ReturnType<typeof scopedClient>>,
  auth: AuthContext,
  approverTenantUserId: string | null,
) {
  let recipientUserIds: string[] = [];
  if (approverTenantUserId) {
    const { data } = await db.from("tenant_users").select("user_id").eq("id", approverTenantUserId).maybeSingle();
    const userId = (data as unknown as { user_id: string } | null)?.user_id;
    if (userId) recipientUserIds = [userId];
  } else {
    recipientUserIds = await getTenantAdminRecipients(db.raw(), auth.tenantId);
  }

  await createNotificationsExcept(
    auth.userId,
    recipientUserIds.map((userId) => ({
      tenantId: auth.tenantId,
      userId,
      type: NotificationTypes.LEAVE_REQUESTED,
      title: "New leave request",
      message: "A leave request is waiting for your approval.",
      link: "/leave",
    })),
  );
}
