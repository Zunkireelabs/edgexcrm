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
import { validate, required, isUUID } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createAuditLog } from "@/lib/api/audit";

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/leave/adjustments" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!canManageHR(auth.permissions)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    tenant_user_id: [required("tenant_user_id"), isUUID()],
    leave_type_id: [required("leave_type_id"), isUUID()],
    year: [required("year")],
    delta_days: [required("delta_days")],
  });
  if (!valid) return apiValidationError(errors);

  const year = Number(body.year);
  const deltaDays = Number(body.delta_days);
  if (!Number.isInteger(year)) return apiValidationError({ year: ["Must be an integer year"] });
  if (!Number.isFinite(deltaDays)) return apiValidationError({ delta_days: ["Must be a number"] });

  const db = await scopedClient(auth);

  const [employeeRes, leaveTypeRes] = await Promise.all([
    db.from("tenant_users").select("id").eq("id", String(body.tenant_user_id)).maybeSingle(),
    db.from("leave_types").select("id").eq("id", String(body.leave_type_id)).maybeSingle(),
  ]);
  if (!employeeRes.data) return apiNotFound("Employee");
  if (!leaveTypeRes.data) return apiNotFound("Leave type");

  const { data: created, error } = await db
    .from("leave_adjustments")
    .insert({
      tenant_user_id: String(body.tenant_user_id),
      leave_type_id: String(body.leave_type_id),
      year,
      delta_days: deltaDays,
      note: body.note ? String(body.note).trim() : null,
      created_by: auth.userId,
    })
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to create leave adjustment");
    return apiError("DB_ERROR", "Failed to create leave adjustment", 500);
  }

  await createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "leave_adjustment.created",
    entityType: "leave_adjustment",
    entityId: (created as { id: string }).id,
    requestId,
  });

  log.info({ adjustmentId: (created as { id: string }).id }, "Leave adjustment created");
  return apiSuccess(created, 201);
}
