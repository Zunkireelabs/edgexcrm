import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError, apiValidationError } from "@/lib/api/response";
import { validate, required, isIn, isPositiveInt, maxLength, isUUID } from "@/lib/api/validation";
import { isSha256Checksum } from "@/lib/documents/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { assertLeadVisible } from "@/lib/documents/access";
import { DOCUMENT_TYPES, resolveDocumentMimeType } from "@/lib/documents/constants";
import { loadMaxDocumentSizeBytes } from "@/lib/documents/settings";
import { buildDocumentStorageKey } from "@/lib/documents/storage-key";
import { getDocumentStorageProvider } from "@/lib/documents/storage/r2-provider";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import type { ApplicantDocumentRow } from "@/lib/documents/types";

interface RouteContext {
  params: Promise<{ id: string; docId: string }>;
}

// POST /api/v1/leads/:id/documents/:docId/complete
// The ONLY place applicant_documents / applicant_document_versions rows get
// created. Re-validates the same fields upload-url validated (nothing was
// persisted there — see that route's header comment) and, critically,
// verifies via R2Provider.exists() that the file the client claims to have
// uploaded is genuinely sitting in the bucket BEFORE writing anything to the
// database. If the PUT never happened or failed, this returns an error and
// the database stays untouched — no ghost "uploaded" row with nothing behind
// it. Idempotent: calling this twice with the same docId after a real
// success returns the existing document rather than erroring.
export async function POST(request: NextRequest, context: RouteContext) {
  const { id, docId } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/leads/${id}/documents/${docId}/complete` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICANT_DOCUMENTS)) return apiForbidden();

  const db = await scopedClient(auth);
  const lead = await assertLeadVisible(db, auth, id);
  if (!lead) return apiNotFound("Lead");

  // Idempotency: a document with this id may already exist from a prior
  // successful call (client retried after a timeout, network blip on the
  // response, etc.) — return it rather than trying to re-create and
  // colliding on the primary key.
  const { data: existingData } = await db.from("applicant_documents").select("*").eq("id", docId).is("deleted_at", null).maybeSingle();
  const existing = (existingData as unknown as ApplicantDocumentRow | null) ?? null;
  if (existing) {
    log.info({ documentId: docId }, "Applicant document complete call is idempotent — already confirmed");
    return apiSuccess(existing);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const { valid, errors } = validate(body, {
    version_id: [required("version_id"), isUUID()],
    document_type: [required("document_type"), isIn([...DOCUMENT_TYPES])],
    name: [required("name"), maxLength(255)],
    original_filename: [required("original_filename"), maxLength(500)],
    file_size: [required("file_size"), isPositiveInt()],
    checksum: [required("checksum"), isSha256Checksum()],
  });
  if (!valid) return apiValidationError(errors);

  const versionId = String(body.version_id);
  const originalFilename = String(body.original_filename);
  const resolvedMimeType = resolveDocumentMimeType(typeof body.mime_type === "string" ? body.mime_type : "", originalFilename);
  if (!resolvedMimeType) {
    return apiValidationError({ mime_type: ["Unsupported file type. Accepted: PDF, DOCX, JPEG, PNG, WEBP."] });
  }

  const fileSize = Number(body.file_size);
  const maxBytes = await loadMaxDocumentSizeBytes(db);
  if (fileSize > maxBytes) {
    return apiError("FILE_TOO_LARGE", `File (${fileSize} bytes) exceeds the ${maxBytes}-byte cap for this tenant`, 422, {
      count: fileSize,
      max: maxBytes,
    });
  }

  // Storage key is deterministic from these inputs — must match exactly what
  // upload-url built, so a mismatched/tampered docId, versionId, or mime type
  // simply fails the existence check below rather than checking the wrong key.
  const storageKey = buildDocumentStorageKey({
    tenantId: auth.tenantId,
    leadId: id,
    documentId: docId,
    versionId,
    mimeType: resolvedMimeType,
  });

  let fileExists: boolean;
  try {
    fileExists = await getDocumentStorageProvider().exists(storageKey);
  } catch (storageError) {
    log.error({ error: storageError, storageKey }, "Failed to check upload existence in R2");
    return apiError("STORAGE_ERROR", "Failed to verify the upload — please retry", 500);
  }
  if (!fileExists) {
    log.warn({ storageKey }, "Applicant document complete called but no file found in R2 — upload never landed");
    return apiError(
      "UPLOAD_INCOMPLETE",
      "The file was not found in storage. The upload may have failed or been interrupted — please retry the upload.",
      409,
    );
  }

  const { data: created, error: docError } = await db
    .from("applicant_documents")
    .insert({
      id: docId,
      lead_id: id,
      document_type: String(body.document_type),
      name: String(body.name).trim(),
      original_filename: originalFilename,
      mime_type: resolvedMimeType,
      file_size: fileSize,
      status: "uploaded",
      description: body.description ? String(body.description) : null,
      uploaded_by: auth.userId,
    })
    .select()
    .single();
  if (docError || !created) {
    log.error({ error: docError }, "Failed to create applicant document row");
    return apiError("DB_ERROR", "Failed to create document", 500);
  }

  const { error: versionError } = await db.from("applicant_document_versions").insert({
    id: versionId,
    document_id: docId,
    version_number: 1,
    storage_key: storageKey,
    file_size: fileSize,
    checksum: String(body.checksum).toLowerCase(),
    mime_type: resolvedMimeType,
    created_by: auth.userId,
  });
  if (versionError) {
    log.error({ error: versionError }, "Failed to create applicant document version row");
    return apiError("DB_ERROR", "Failed to create document version", 500);
  }

  const { data: updated, error: updateError } = await db
    .from("applicant_documents")
    .update({ current_version_id: versionId })
    .eq("id", docId)
    .select()
    .single();
  if (updateError || !updated) {
    log.error({ error: updateError }, "Failed to point document at its first version");
    return apiError("DB_ERROR", "Failed to finalize document", 500);
  }

  const document = updated as unknown as ApplicantDocumentRow;

  const { error: usageError } = await db.from("document_usage_events").insert({
    event_type: "upload",
    resource_type: "applicant_document",
    resource_id: document.id,
    actor_user_id: auth.userId,
  });
  if (usageError) log.error({ error: usageError }, "Failed to record document_usage_events upload row (non-blocking)");

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "document.uploaded",
      entityType: "applicant_document",
      entityId: document.id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "document.uploaded",
      entityType: "applicant_document",
      entityId: document.id,
      payload: { leadId: id, documentType: document.document_type },
      requestId,
    }),
  ]);

  log.info({ documentId: document.id, storageKey }, "Applicant document upload confirmed and persisted");
  return apiSuccess(document, 201);
}
