import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { validate, maxLength, optionalMaxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";

const BILLING_TYPES = ["fixed", "hourly", "retainer"] as const;

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.SERVICES)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: service, error } = await db
    .from("services")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return apiError("DB_ERROR", "Failed to fetch service", 500);
  if (!service) return apiNotFound("Service");

  return apiSuccess(service);
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/services/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.SERVICES)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    name: [maxLength(255)],
    description: [optionalMaxLength(2000)],
    category: [optionalMaxLength(100)],
  });
  if (!valid) return apiValidationError(errors);

  if (
    body.billing_type !== undefined &&
    body.billing_type !== null &&
    !BILLING_TYPES.includes(body.billing_type as (typeof BILLING_TYPES)[number])
  ) {
    return apiValidationError({ billing_type: [`Must be one of: ${BILLING_TYPES.join(", ")}`] });
  }

  for (const field of ["hours", "price"] as const) {
    if (body[field] === undefined || body[field] === null || body[field] === "") continue;
    const num = Number(body[field]);
    if (!Number.isFinite(num) || num < 0) {
      return apiValidationError({ [field]: ["Must be a non-negative number"] });
    }
  }

  const db = await scopedClient(auth);

  const { data: existing } = await db
    .from("services")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Service");

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.description !== undefined) patch.description = body.description ? String(body.description).trim() : null;
  if (body.category !== undefined) patch.category = body.category ? String(body.category).trim() : null;
  if (body.billing_type !== undefined) patch.billing_type = body.billing_type;
  if (body.hours !== undefined) patch.hours = body.hours === null || body.hours === "" ? null : Number(body.hours);
  if (body.price !== undefined) patch.price = body.price === null || body.price === "" ? null : Number(body.price);
  if (body.sort_order !== undefined) patch.sort_order = Number(body.sort_order);
  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);

  const { data: updated, error } = await db
    .from("services")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to update service");
    return apiError("DB_ERROR", "Failed to update service", 500);
  }

  const changedFields = Object.keys(patch);
  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "service.updated",
      entityType: "service",
      entityId: id,
      changes: { patch: { old: existing, new: patch } },
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "service.updated",
      entityType: "service",
      entityId: id,
      requestId,
      payload: { changed_fields: changedFields, old: existing, new: patch },
    }),
  ]);

  log.info({ serviceId: id }, "Service updated");
  return apiSuccess(updated);
}

// TODO(SOW): guard delete once services are referenced by proposals
export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/services/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.SERVICES)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: existing } = await db
    .from("services")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Service");

  const { error } = await db.from("services").delete().eq("id", id);
  if (error) {
    log.error({ error }, "Failed to delete service");
    return apiError("DB_ERROR", "Failed to delete service", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "service.deleted",
      entityType: "service",
      entityId: id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "service.deleted",
      entityType: "service",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ serviceId: id }, "Service deleted");
  return apiSuccess({ id });
}
