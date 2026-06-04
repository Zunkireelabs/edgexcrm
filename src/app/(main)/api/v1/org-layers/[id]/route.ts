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
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createAuditLog, emitEvent } from "@/lib/api/audit";

interface Props {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/org-layers/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const db = await scopedClient(auth);

  const { data: existing } = await db
    .from("org_layers")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (!existing) return apiNotFound("Org layer");

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.description !== undefined) {
    patch.description = body.description ? String(body.description).trim() : null;
  }

  if (Object.keys(patch).length === 0) {
    return apiValidationError({ body: ["No valid fields to update"] });
  }

  patch.updated_at = new Date().toISOString();

  const { data: updated, error } = await db
    .from("org_layers")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to update org layer");
    return apiError("DB_ERROR", "Failed to update org layer", 500);
  }

  Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "org_layer.updated",
      entityType: "org_layer",
      entityId: id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "org_layer.updated",
      entityType: "org_layer",
      entityId: id,
      payload: { changes: Object.keys(patch) },
      requestId,
    }),
  ]);

  log.info({ layerId: id }, "Org layer updated");
  return apiSuccess(updated);
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/org-layers/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);

  const { data: existing } = await db
    .from("org_layers")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (!existing) return apiNotFound("Org layer");

  // ON DELETE SET NULL handles positions → Unassigned automatically
  const { error } = await db
    .from("org_layers")
    .delete()
    .eq("id", id);

  if (error) {
    log.error({ error }, "Failed to delete org layer");
    return apiError("DB_ERROR", "Failed to delete org layer", 500);
  }

  Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "org_layer.deleted",
      entityType: "org_layer",
      entityId: id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "org_layer.deleted",
      entityType: "org_layer",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ layerId: id }, "Org layer deleted");
  return apiSuccess({ id, deleted: true });
}
