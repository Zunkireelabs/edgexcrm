import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiError,
  apiNotFound,
  apiValidationError,
} from "@/lib/api/response";
import { validate, maxLength, optionalMaxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { getStorageProvider } from "@/lib/storage/provider";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);
  const { data: kb, error: kbError } = await db
    .from("knowledge_bases")
    .select("*")
    .eq("id", id)
    .single();

  if (kbError || !kb) return apiNotFound("Knowledge base");

  const { data: items, error: itemsError } = await db
    .from("knowledge_base_items")
    .select("*")
    .eq("knowledge_base_id", id)
    .order("created_at", { ascending: false });

  if (itemsError) return apiError("DB_ERROR", "Failed to fetch items", 500);

  const itemList = (items ?? []) as unknown as Array<{ size_bytes?: number | null; [key: string]: unknown }>;
  const item_count = itemList.length;
  const total_size_bytes = itemList.reduce((acc, item) => acc + Number(item.size_bytes ?? 0), 0);

  return apiSuccess({ ...(kb as unknown as Record<string, unknown>), items: itemList, item_count, total_size_bytes });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/knowledge-bases/${id}` });

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
  const { data: existing, error: fetchError } = await db
    .from("knowledge_bases")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchError || !existing) return apiNotFound("Knowledge base");

  const { valid, errors } = validate(body, {
    name: [maxLength(255)],
    description: [optionalMaxLength(2000)],
  });
  if (!valid) return apiValidationError(errors);

  const updatePayload: Record<string, unknown> = {};
  if (body.name !== undefined) updatePayload.name = String(body.name).trim();
  if (body.description !== undefined) {
    updatePayload.description = body.description ? String(body.description).trim() : null;
  }

  if (Object.keys(updatePayload).length === 0) {
    return apiValidationError({ body: ["No valid fields to update"] });
  }

  updatePayload.updated_at = new Date().toISOString();

  const { data: updated, error } = await db
    .from("knowledge_bases")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to update knowledge base");
    return apiError("DB_ERROR", "Failed to update knowledge base", 500);
  }

  const existingRow = existing as unknown as Record<string, unknown>;
  const updatedRow = updated as unknown as Record<string, unknown>;
  const changes: Record<string, { old: unknown; new: unknown }> = {};
  for (const field of Object.keys(updatePayload)) {
    if (field === "updated_at") continue;
    if (JSON.stringify(existingRow[field]) !== JSON.stringify(updatedRow[field])) {
      changes[field] = { old: existingRow[field], new: updatedRow[field] };
    }
  }

  Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "knowledge_base.updated",
      entityType: "knowledge_base",
      entityId: id,
      changes,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "knowledge_base.updated",
      entityType: "knowledge_base",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ kbId: id, changes }, "Knowledge base updated");
  return apiSuccess(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/knowledge-bases/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: existing } = await db
    .from("knowledge_bases")
    .select("id")
    .eq("id", id)
    .single();

  if (!existing) return apiNotFound("Knowledge base");

  // Collect file paths before cascade delete
  const { data: fileItems } = await db
    .from("knowledge_base_items")
    .select("storage_path")
    .eq("knowledge_base_id", id)
    .eq("type", "file");

  const paths = ((fileItems ?? []) as unknown as Array<{ storage_path?: string | null }>)
    .map((item) => item.storage_path)
    .filter((p): p is string => Boolean(p));

  if (paths.length > 0) {
    getStorageProvider()
      .remove("knowledge-base-files", paths)
      .catch((storageErr) => log.error({ error: storageErr }, "Storage cleanup failed (non-fatal)"));
  }

  const { error } = await db.from("knowledge_bases").delete().eq("id", id);
  if (error) {
    log.error({ error }, "Failed to delete knowledge base");
    return apiError("DB_ERROR", "Failed to delete knowledge base", 500);
  }

  Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "knowledge_base.deleted",
      entityType: "knowledge_base",
      entityId: id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "knowledge_base.deleted",
      entityType: "knowledge_base",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ kbId: id }, "Knowledge base deleted");
  return apiSuccess({ id, deleted: true });
}
