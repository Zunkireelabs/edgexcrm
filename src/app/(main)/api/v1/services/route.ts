import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { validate, required, maxLength, optionalMaxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";

const BILLING_TYPES = ["fixed", "hourly", "retainer"] as const;

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.SERVICES)) return apiForbidden();

  const db = await scopedClient(auth);
  const { searchParams } = new URL(request.url);
  const isActiveParam = searchParams.get("is_active");

  let query = db.from("services").select("*");
  if (isActiveParam !== null) {
    query = query.eq("is_active", isActiveParam === "true");
  }
  const { data: services, error } = await query.order("sort_order", { ascending: true }).order("name", { ascending: true });
  if (error) return apiError("DB_ERROR", "Failed to fetch services", 500);

  return apiSuccess(services ?? []);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/services" });

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
    name: [required("name"), maxLength(255)],
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
  const { data: created, error } = await db
    .from("services")
    .insert({
      name: String(body.name).trim(),
      description: body.description ? String(body.description).trim() : null,
      category: body.category ? String(body.category).trim() : null,
      billing_type: (body.billing_type as string) ?? "fixed",
      hours: body.hours !== undefined && body.hours !== null && body.hours !== "" ? Number(body.hours) : null,
      price: body.price !== undefined && body.price !== null && body.price !== "" ? Number(body.price) : null,
      sort_order: body.sort_order !== undefined ? Number(body.sort_order) : 0,
      is_active: body.is_active !== false,
    })
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to create service");
    return apiError("DB_ERROR", "Failed to create service", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "service.created",
      entityType: "service",
      entityId: created.id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "service.created",
      entityType: "service",
      entityId: created.id,
      requestId,
    }),
  ]);

  log.info({ serviceId: created.id }, "Service created");
  return apiSuccess(created, 201);
}
