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
import { validate, required, maxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createAuditLog } from "@/lib/api/audit";

export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);
  const { data, error } = await db
    .from("leave_types")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (error) return apiError("DB_ERROR", "Failed to fetch leave types", 500);
  return apiSuccess(data ?? []);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/leave/types" });

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
    name: [required("name"), maxLength(80)],
  });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);
  const { data: created, error } = await db
    .from("leave_types")
    .insert({
      name: String(body.name).trim(),
      code: body.code ? String(body.code).trim() : null,
      color: body.color ? String(body.color).trim() : null,
      is_paid: body.is_paid !== undefined ? !!body.is_paid : true,
      requires_approval: body.requires_approval !== undefined ? !!body.requires_approval : true,
      annual_allotment_days: body.annual_allotment_days !== undefined ? Number(body.annual_allotment_days) : 0,
      allow_half_day: body.allow_half_day !== undefined ? !!body.allow_half_day : true,
      carry_forward: body.carry_forward !== undefined ? !!body.carry_forward : false,
      max_carry_forward_days: body.max_carry_forward_days !== undefined ? Number(body.max_carry_forward_days) : null,
      sort_order: body.sort_order !== undefined ? Number(body.sort_order) : 0,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return apiValidationError({ name: ["A leave type with this name already exists"] });
    }
    log.error({ error }, "Failed to create leave type");
    return apiError("DB_ERROR", "Failed to create leave type", 500);
  }

  await createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "leave_type.created",
    entityType: "leave_type",
    entityId: (created as { id: string }).id,
    requestId,
  });

  log.info({ leaveTypeId: (created as { id: string }).id }, "Leave type created");
  return apiSuccess(created, 201);
}
