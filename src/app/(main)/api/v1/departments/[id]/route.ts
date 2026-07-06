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
import { validate, maxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createAuditLog, emitEvent } from "@/lib/api/audit";

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!canManageHR(auth.permissions)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data, error } = await db.from("departments").select("*").eq("id", id).maybeSingle();
  if (error) return apiError("DB_ERROR", "Failed to fetch department", 500);
  if (!data) return apiNotFound("Department");
  return apiSuccess(data);
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/departments/${id}` });

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
    name: body.name !== undefined ? [maxLength(255)] : [],
  });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);
  const { data: existing } = await db.from("departments").select("id").eq("id", id).maybeSingle();
  if (!existing) return apiNotFound("Department");

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.lead_tenant_user_id !== undefined) {
    if (body.lead_tenant_user_id !== null) {
      const { data: leadCheck } = await db
        .from("tenant_users")
        .select("id")
        .eq("id", String(body.lead_tenant_user_id))
        .maybeSingle();
      if (!leadCheck) return apiError("NOT_FOUND", "lead_tenant_user_id not found in this tenant", 404);
    }
    patch.lead_tenant_user_id = body.lead_tenant_user_id;
  }

  if (Object.keys(patch).length === 0) return apiNotFound("Department");

  const { data: updated, error } = await db
    .from("departments")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") return apiError("CONFLICT", "A department with this name already exists", 409);
    log.error({ error }, "Failed to update department");
    return apiError("DB_ERROR", "Failed to update department", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "department.updated",
      entityType: "department",
      entityId: id,
      changes: { patch: { old: null, new: patch } },
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "department.updated",
      entityType: "department",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ departmentId: id }, "Department updated");
  return apiSuccess(updated);
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/departments/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!canManageHR(auth.permissions)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: existing } = await db.from("departments").select("id").eq("id", id).maybeSingle();
  if (!existing) return apiNotFound("Department");

  const { error } = await db.from("departments").delete().eq("id", id);
  if (error) {
    log.error({ error }, "Failed to delete department");
    return apiError("DB_ERROR", "Failed to delete department", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "department.deleted",
      entityType: "department",
      entityId: id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "department.deleted",
      entityType: "department",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ departmentId: id }, "Department deleted");
  return apiSuccess({ id });
}
