import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiError,
  apiValidationError,
  apiConflict,
} from "@/lib/api/response";
import { validate, required } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { canManageClasses } from "@/lib/api/permissions";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CLASSES)) return apiForbidden();

  const db = await scopedClient(auth);
  const { searchParams } = new URL(request.url);
  const showAll = searchParams.get("all") === "true";

  let query = db.from("classes").select("id, name, default_fee, is_active, created_at, updated_at");
  if (!showAll) query = query.eq("is_active", true);

  const { data: classes, error } = await query.order("name", { ascending: true });
  if (error) return apiError("DB_ERROR", "Failed to fetch classes", 500);

  // Attach active enrollment count per class
  const { data: counts, error: countErr } = await db
    .from("class_enrollments")
    .select("class_id")
    .is("deleted_at", null);

  if (countErr) return apiError("DB_ERROR", "Failed to fetch enrollment counts", 500);

  const countMap: Record<string, number> = {};
  for (const row of counts ?? []) {
    const r = row as unknown as { class_id: string };
    countMap[r.class_id] = (countMap[r.class_id] ?? 0) + 1;
  }

  const result = (classes ?? []).map((c) => {
    const row = c as unknown as { id: string; name: string; default_fee: number | null; is_active: boolean; created_at: string; updated_at: string };
    return {
      ...row,
      enrollmentCount: countMap[row.id] ?? 0,
    };
  });

  return apiSuccess(result);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/classes" });

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

  const { valid, errors } = validate(body, {
    name: [required("name")],
  });
  if (!valid) return apiValidationError(errors);

  const name = String(body.name).trim();
  if (!name) return apiValidationError({ name: ["name is required"] });

  let defaultFee: number | null = null;
  if (body.default_fee !== undefined && body.default_fee !== null) {
    const fee = Number(body.default_fee);
    if (isNaN(fee) || fee < 0) return apiValidationError({ default_fee: ["default_fee must be a non-negative number"] });
    defaultFee = fee;
  }

  const isActive = body.is_active === undefined ? true : Boolean(body.is_active);

  const db = await scopedClient(auth);
  const { data: created, error } = await db
    .from("classes")
    .insert({ name, default_fee: defaultFee, is_active: isActive })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return apiConflict("A class with that name already exists.");
    }
    log.error({ error }, "Failed to create class");
    return apiError("DB_ERROR", "Failed to create class", 500);
  }

  const createdRow = created as unknown as { id: string };
  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "class.created",
      entityType: "class",
      entityId: createdRow.id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "class.created",
      entityType: "class",
      entityId: createdRow.id,
      requestId,
    }),
  ]);

  log.info({ classId: createdRow.id }, "Class created");
  return apiSuccess(created, 201);
}
