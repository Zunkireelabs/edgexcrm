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
  const { data, error } = await db.from("skills").select("*").eq("id", id).maybeSingle();
  if (error) return apiError("DB_ERROR", "Failed to fetch skill", 500);
  if (!data) return apiNotFound("Skill");
  return apiSuccess(data);
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/skills/${id}` });

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
    category: body.category !== undefined ? [maxLength(100)] : [],
  });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);
  const { data: existing } = await db.from("skills").select("id").eq("id", id).maybeSingle();
  if (!existing) return apiNotFound("Skill");

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.category !== undefined) patch.category = body.category ? String(body.category).trim() : null;

  if (Object.keys(patch).length === 0) return apiNotFound("Skill");

  const { data: updated, error } = await db
    .from("skills")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") return apiError("CONFLICT", "A skill with this name already exists", 409);
    log.error({ error }, "Failed to update skill");
    return apiError("DB_ERROR", "Failed to update skill", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "skill.updated",
      entityType: "skill",
      entityId: id,
      changes: { patch: { old: null, new: patch } },
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "skill.updated",
      entityType: "skill",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ skillId: id }, "Skill updated");
  return apiSuccess(updated);
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/skills/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!canManageHR(auth.permissions)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: existing } = await db.from("skills").select("id").eq("id", id).maybeSingle();
  if (!existing) return apiNotFound("Skill");

  const { error } = await db.from("skills").delete().eq("id", id);
  if (error) {
    log.error({ error }, "Failed to delete skill");
    return apiError("DB_ERROR", "Failed to delete skill", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "skill.deleted",
      entityType: "skill",
      entityId: id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "skill.deleted",
      entityType: "skill",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ skillId: id }, "Skill deleted");
  return apiSuccess({ id });
}
