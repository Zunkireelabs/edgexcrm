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
import { validate, maxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { getStorageProvider } from "@/lib/storage/provider";
import { isIngestionEnabledForTenant } from "@/lib/ai/flag";
import { inngest } from "@/lib/ai/ingestion/inngest";

const isHttpUrl = (): ((v: unknown) => string | null) => (v) => {
  if (!v || typeof v !== "string") return null;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? null : "Must be an http(s) URL";
  } catch {
    return "Invalid URL";
  }
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "PATCH",
    path: `/api/v1/knowledge-bases/${id}/items/${itemId}`,
  });

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
    .from("knowledge_base_items")
    .select("*")
    .eq("id", itemId)
    .single();

  if (fetchError || !existing) return apiNotFound("Knowledge base item");

  const existingRow = existing as unknown as Record<string, unknown>;
  const itemType = existingRow.type as string;

  // Validate per type
  const rules: Record<string, ((v: unknown) => string | null)[]> = {
    title: [maxLength(255)],
  };
  if (itemType === "note") rules.content = [maxLength(50000)];
  if (itemType === "link") rules.url = [isHttpUrl()];

  const { valid, errors } = validate(body, rules);
  if (!valid) return apiValidationError(errors);

  const updatePayload: Record<string, unknown> = {};
  if (body.title !== undefined) updatePayload.title = String(body.title).trim();
  if (itemType === "note" && body.content !== undefined) updatePayload.content = String(body.content);
  if (itemType === "link" && body.url !== undefined) updatePayload.url = String(body.url).trim();

  if (Object.keys(updatePayload).length === 0) {
    return apiValidationError({ body: ["No valid fields to update"] });
  }

  const ingestionEnabled = await isIngestionEnabledForTenant(auth.tenantId);
  const contentChanged =
    (itemType === "note" && body.content !== undefined) || (itemType === "link" && body.url !== undefined);
  if (ingestionEnabled && contentChanged) {
    updatePayload.status = "pending";
    updatePayload.processing_error = null;
  }

  updatePayload.updated_at = new Date().toISOString();

  const { data: updated, error } = await db
    .from("knowledge_base_items")
    .update(updatePayload)
    .eq("id", itemId)
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to update knowledge base item");
    return apiError("DB_ERROR", "Failed to update item", 500);
  }

  if (ingestionEnabled && contentChanged) {
    inngest
      .send({ name: "kb/item.ingest.requested", data: { tenantId: auth.tenantId, itemId } })
      .catch((err) => log.error({ err, itemId }, "Failed to send kb-ingest event (recoverable via backfill)"));
  }

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
      action: "knowledge_base_item.updated",
      entityType: "knowledge_base_item",
      entityId: itemId,
      changes,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "knowledge_base_item.updated",
      entityType: "knowledge_base_item",
      entityId: itemId,
      requestId,
    }),
  ]);

  log.info({ itemId, changes }, "Knowledge base item updated");
  return apiSuccess(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "DELETE",
    path: `/api/v1/knowledge-bases/${id}/items/${itemId}`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: existing } = await db
    .from("knowledge_base_items")
    .select("type, storage_path")
    .eq("id", itemId)
    .single();

  if (!existing) return apiNotFound("Knowledge base item");

  const row = existing as unknown as { type: string; storage_path?: string | null };
  if (row.type === "file" && row.storage_path) {
    getStorageProvider()
      .remove("knowledge-base-files", [row.storage_path])
      .catch((storageErr) => log.error({ error: storageErr }, "Storage cleanup failed (non-fatal)"));
  }

  const { error } = await db.from("knowledge_base_items").delete().eq("id", itemId);
  if (error) {
    log.error({ error }, "Failed to delete knowledge base item");
    return apiError("DB_ERROR", "Failed to delete item", 500);
  }

  Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "knowledge_base_item.deleted",
      entityType: "knowledge_base_item",
      entityId: itemId,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "knowledge_base_item.deleted",
      entityType: "knowledge_base_item",
      entityId: itemId,
      requestId,
    }),
  ]);

  log.info({ itemId }, "Knowledge base item deleted");
  return apiSuccess({ id: itemId, deleted: true });
}
