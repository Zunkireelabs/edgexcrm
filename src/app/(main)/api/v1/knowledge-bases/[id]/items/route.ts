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
import {
  validate,
  required,
  maxLength,
  isUUID,
  isIn,
  isPositiveInt,
} from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { KB_MAX_FILE_BYTES, KB_ACCEPTED_TYPES } from "@/lib/knowledge-base/constants";
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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);
  const { data: kb } = await db.from("knowledge_bases").select("id").eq("id", id).single();
  if (!kb) return apiNotFound("Knowledge base");

  const { data: items, error } = await db
    .from("knowledge_base_items")
    .select("*")
    .eq("knowledge_base_id", id)
    .order("created_at", { ascending: false });

  if (error) return apiError("DB_ERROR", "Failed to fetch items", 500);
  return apiSuccess(items ?? []);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: `/api/v1/knowledge-bases/${id}/items`,
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
  const { data: kb } = await db.from("knowledge_bases").select("id").eq("id", id).single();
  if (!kb) return apiNotFound("Knowledge base");

  const ingestionEnabled = await isIngestionEnabledForTenant(auth.tenantId);
  const type = body.type;
  let insertRow: Record<string, unknown>;

  if (type === "link") {
    const { valid, errors } = validate(body, {
      title: [required("title"), maxLength(255)],
      url: [required("url"), isHttpUrl()],
    });
    if (!valid) return apiValidationError(errors);
    insertRow = {
      type: "link",
      knowledge_base_id: id,
      title: String(body.title).trim(),
      url: String(body.url).trim(),
      status: ingestionEnabled ? "pending" : "ready",
      created_by: auth.userId,
    };
  } else if (type === "note") {
    const { valid, errors } = validate(body, {
      title: [required("title"), maxLength(255)],
      content: [required("content"), maxLength(50000)],
    });
    if (!valid) return apiValidationError(errors);
    insertRow = {
      type: "note",
      knowledge_base_id: id,
      title: String(body.title).trim(),
      content: String(body.content),
      status: ingestionEnabled ? "pending" : "ready",
      created_by: auth.userId,
    };
  } else if (type === "file") {
    const { valid, errors } = validate(body, {
      item_id: [required("item_id"), isUUID()],
      title: [required("title")],
      file_name: [required("file_name")],
      mime_type: [required("mime_type"), isIn([...KB_ACCEPTED_TYPES])],
      size_bytes: [required("size_bytes"), isPositiveInt()],
      storage_path: [required("storage_path")],
    });
    if (!valid) return apiValidationError(errors);

    const sizeBytes = Number(body.size_bytes);
    if (sizeBytes > KB_MAX_FILE_BYTES) {
      return apiValidationError({ size_bytes: [`File exceeds maximum size of ${KB_MAX_FILE_BYTES} bytes`] });
    }

    const itemId = String(body.item_id);

    // Idempotency: if item already exists, return it as success
    const { data: existing } = await db
      .raw()
      .from("knowledge_base_items")
      .select("*")
      .eq("id", itemId)
      .eq("tenant_id", auth.tenantId)
      .single();

    if (existing) {
      log.info({ itemId }, "File item already registered (idempotent)");
      return apiSuccess(existing, 201);
    }

    insertRow = {
      id: itemId,
      type: "file",
      knowledge_base_id: id,
      title: String(body.title).trim(),
      file_name: String(body.file_name),
      mime_type: String(body.mime_type),
      size_bytes: sizeBytes,
      storage_path: String(body.storage_path),
      status: ingestionEnabled ? "pending" : "ready",
      created_by: auth.userId,
    };
  } else {
    return apiValidationError({ type: ["Must be one of: file, link, note"] });
  }

  const { data: created, error } = await db
    .from("knowledge_base_items")
    .insert(insertRow)
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to create knowledge base item");
    return apiError("DB_ERROR", "Failed to create item", 500);
  }

  if (ingestionEnabled) {
    inngest
      .send({ name: "kb/item.ingest.requested", data: { tenantId: auth.tenantId, itemId: created.id } })
      .catch((err) => log.error({ err, itemId: created.id }, "Failed to send kb-ingest event (recoverable via backfill)"));
  }

  Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "knowledge_base_item.created",
      entityType: "knowledge_base_item",
      entityId: created.id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "knowledge_base_item.created",
      entityType: "knowledge_base_item",
      entityId: created.id,
      payload: { type: String(type) },
      requestId,
    }),
  ]);

  log.info({ itemId: created.id, type }, "Knowledge base item created");
  return apiSuccess(created, 201);
}
