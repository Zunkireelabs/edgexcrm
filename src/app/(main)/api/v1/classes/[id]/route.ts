import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
  apiConflict,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { canManageClasses } from "@/lib/api/permissions";

interface Props {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/classes/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CLASSES)) return apiForbidden();
  if (!canManageClasses(auth.permissions)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const db = await scopedClient(auth);
  const { data: existing } = await db.from("classes").select("*").eq("id", id).maybeSingle();
  if (!existing) return apiNotFound("Class");

  const patch: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return apiValidationError({ name: ["name cannot be empty"] });
    patch.name = name;
  }
  if (body.default_fee !== undefined) {
    if (body.default_fee === null) {
      patch.default_fee = null;
    } else {
      const fee = Number(body.default_fee);
      if (isNaN(fee) || fee < 0) return apiValidationError({ default_fee: ["default_fee must be a non-negative number"] });
      patch.default_fee = fee;
    }
  }
  if (body.is_active !== undefined) {
    patch.is_active = Boolean(body.is_active);
  }

  if (Object.keys(patch).length === 0) return apiSuccess(existing);

  const { data: updated, error } = await db
    .from("classes")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return apiConflict("A class with that name already exists.");
    }
    log.error({ error }, "Failed to update class");
    return apiError("DB_ERROR", "Failed to update class", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "class.updated",
      entityType: "class",
      entityId: id,
      changes: { patch: { old: existing, new: patch } },
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "class.updated",
      entityType: "class",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ classId: id }, "Class updated");
  return apiSuccess(updated);
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/classes/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CLASSES)) return apiForbidden();
  if (!canManageClasses(auth.permissions)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: existing } = await db.from("classes").select("id").eq("id", id).maybeSingle();
  if (!existing) return apiNotFound("Class");

  // Block delete if it has any active enrollment
  const { count } = await db
    .from("class_enrollments")
    .select("id", { count: "exact", head: true })
    .eq("class_id", id)
    .is("deleted_at", null);

  if (count && count > 0) {
    return apiConflict(`Cannot delete a class with ${count} active enrollment(s). Un-enroll students first.`);
  }

  const { error } = await db.from("classes").delete().eq("id", id);
  if (error) {
    log.error({ error }, "Failed to delete class");
    return apiError("DB_ERROR", "Failed to delete class", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "class.deleted",
      entityType: "class",
      entityId: id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "class.deleted",
      entityType: "class",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ classId: id }, "Class deleted");
  return apiSuccess({ id });
}
