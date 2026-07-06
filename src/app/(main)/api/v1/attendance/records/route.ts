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
import { validate, required, isUUID, isIn } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { getSelfTenantUserId, getDirectReportIds } from "@/lib/api/hr-scope";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ["present", "absent", "remote", "half_day"];

async function regularize(request: NextRequest, method: "POST" | "PATCH") {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method, path: "/api/v1/attendance/records" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    tenant_user_id: [required("tenant_user_id"), isUUID()],
    work_date: [required("work_date")],
    status: body.status !== undefined ? [isIn(STATUSES)] : [],
  });
  if (!valid) return apiValidationError(errors);
  if (!DATE_RE.test(String(body.work_date))) {
    return apiValidationError({ work_date: ["Must be a valid date (YYYY-MM-DD)"] });
  }

  const db = await scopedClient(auth);
  const hasManageHR = canManageHR(auth.permissions);
  const selfId = await getSelfTenantUserId(db, auth);

  const targetTenantUserId = String(body.tenant_user_id);
  const isDirectReport = !!selfId && (await getDirectReportIds(db, selfId)).includes(targetTenantUserId);
  if (!hasManageHR && !isDirectReport) return apiForbidden();

  const { data: target } = await db
    .from("tenant_users")
    .select("id, user_id")
    .eq("id", targetTenantUserId)
    .maybeSingle();
  const targetRow = target as { id: string; user_id: string } | null;
  if (!targetRow) return apiNotFound("Employee");

  const workDate = String(body.work_date);

  const { data: existing } = await db
    .from("attendance_records")
    .select("id")
    .eq("tenant_user_id", targetTenantUserId)
    .eq("work_date", workDate)
    .maybeSingle();
  const existingRow = existing as { id: string } | null;

  if (method === "PATCH" && !existingRow) return apiNotFound("Attendance record");

  const patch: Record<string, unknown> = { source: "manual" };
  if (body.status !== undefined) patch.status = body.status;
  if (body.clock_in_at !== undefined) patch.clock_in_at = body.clock_in_at;
  if (body.clock_out_at !== undefined) patch.clock_out_at = body.clock_out_at;
  if (body.note !== undefined) patch.note = body.note ? String(body.note).trim() : null;

  const result = existingRow
    ? await db.from("attendance_records").update(patch).eq("id", existingRow.id).select().single()
    : await db
        .from("attendance_records")
        .insert({
          tenant_user_id: targetTenantUserId,
          user_id: targetRow.user_id,
          work_date: workDate,
          status: "present",
          ...patch,
        })
        .select()
        .single();

  if (result.error) {
    log.error({ error: result.error }, "Failed to regularize attendance");
    return apiError("DB_ERROR", "Failed to save attendance record", 500);
  }

  const row = result.data as { id: string };

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "attendance.regularized",
      entityType: "attendance_record",
      entityId: row.id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "attendance.regularized",
      entityType: "attendance_record",
      entityId: row.id,
      requestId,
      payload: { tenant_user_id: targetTenantUserId, work_date: workDate },
    }),
  ]);

  log.info({ attendanceRecordId: row.id }, "Attendance regularized");
  return apiSuccess(result.data, existingRow ? 200 : 201);
}

export async function POST(request: NextRequest) {
  return regularize(request, "POST");
}

export async function PATCH(request: NextRequest) {
  return regularize(request, "PATCH");
}
