import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { canManageHR } from "@/lib/api/permissions";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { validate, required, isUUID } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createAuditLog } from "@/lib/api/audit";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);
  const { searchParams } = new URL(request.url);
  const branchId = searchParams.get("branch_id");

  let query = db.from("holidays").select("*").order("holiday_date", { ascending: true });
  query = branchId ? query.or(`branch_id.eq.${branchId},branch_id.is.null`) : query.is("branch_id", null);

  const { data, error } = await query;
  if (error) return apiError("DB_ERROR", "Failed to fetch holidays", 500);
  return apiSuccess(data ?? []);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/leave/holidays" });

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
    name: [required("name")],
    holiday_date: [required("holiday_date")],
    branch_id: [isUUID()],
  });
  if (!valid) return apiValidationError(errors);
  if (!DATE_RE.test(String(body.holiday_date))) {
    return apiValidationError({ holiday_date: ["Must be a valid date (YYYY-MM-DD)"] });
  }

  const db = await scopedClient(auth);

  if (body.branch_id) {
    const { data: branch } = await db.from("branches").select("id").eq("id", String(body.branch_id)).maybeSingle();
    if (!branch) return apiValidationError({ branch_id: ["Branch not found in this tenant"] });
  }

  const { data: created, error } = await db
    .from("holidays")
    .insert({
      name: String(body.name).trim(),
      holiday_date: String(body.holiday_date),
      branch_id: body.branch_id ? String(body.branch_id) : null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return apiValidationError({ holiday_date: ["A holiday already exists for this date on this calendar"] });
    }
    log.error({ error }, "Failed to create holiday");
    return apiError("DB_ERROR", "Failed to create holiday", 500);
  }

  await createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "holiday.created",
    entityType: "holiday",
    entityId: (created as { id: string }).id,
    requestId,
  });

  log.info({ holidayId: (created as { id: string }).id }, "Holiday created");
  return apiSuccess(created, 201);
}
