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
import { createAuditLog, emitEvent } from "@/lib/api/audit";

export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!canManageHR(auth.permissions)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data, error } = await db
    .from("departments")
    .select("*")
    .order("name", { ascending: true });

  if (error) return apiError("DB_ERROR", "Failed to fetch departments", 500);
  return apiSuccess(data ?? []);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/departments" });

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
    name: [required("name"), maxLength(255)],
  });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);

  if (body.lead_tenant_user_id) {
    const { data: leadCheck } = await db
      .from("tenant_users")
      .select("id")
      .eq("id", String(body.lead_tenant_user_id))
      .maybeSingle();
    if (!leadCheck) return apiError("NOT_FOUND", "lead_tenant_user_id not found in this tenant", 404);
  }

  const { data: created, error } = await db
    .from("departments")
    .insert({
      name: String(body.name).trim(),
      lead_tenant_user_id: body.lead_tenant_user_id ? String(body.lead_tenant_user_id) : null,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") return apiError("CONFLICT", "A department with this name already exists", 409);
    log.error({ error }, "Failed to create department");
    return apiError("DB_ERROR", "Failed to create department", 500);
  }

  const createdRow = created as unknown as { id: string };
  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "department.created",
      entityType: "department",
      entityId: createdRow.id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "department.created",
      entityType: "department",
      entityId: createdRow.id,
      requestId,
    }),
  ]);

  log.info({ departmentId: createdRow.id }, "Department created");
  return apiSuccess(created, 201);
}
