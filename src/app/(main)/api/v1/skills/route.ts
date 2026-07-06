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
    .from("skills")
    .select("*")
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (error) return apiError("DB_ERROR", "Failed to fetch skills", 500);
  return apiSuccess(data ?? []);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/skills" });

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
    category: body.category !== undefined ? [maxLength(100)] : [],
  });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);
  const { data: created, error } = await db
    .from("skills")
    .insert({
      name: String(body.name).trim(),
      category: body.category ? String(body.category).trim() : null,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") return apiError("CONFLICT", "A skill with this name already exists", 409);
    log.error({ error }, "Failed to create skill");
    return apiError("DB_ERROR", "Failed to create skill", 500);
  }

  const createdRow = created as unknown as { id: string };
  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "skill.created",
      entityType: "skill",
      entityId: createdRow.id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "skill.created",
      entityType: "skill",
      entityId: createdRow.id,
      requestId,
    }),
  ]);

  log.info({ skillId: createdRow.id }, "Skill created");
  return apiSuccess(created, 201);
}
