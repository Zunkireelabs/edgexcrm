import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError, apiValidationError } from "@/lib/api/response";
import { validate, required, isPositiveInt, maxLength } from "@/lib/api/validation";
import { isSha256Checksum } from "@/lib/documents/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { assertDocumentVisible } from "@/lib/documents/access";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { resolveDocumentMimeType } from "@/lib/documents/constants";
import { loadMaxDocumentSizeBytes } from "@/lib/documents/settings";
import { buildDocumentStorageKey } from "@/lib/documents/storage-key";
import { getDocumentStorageProvider } from "@/lib/documents/storage/r2-provider";
import type { ApplicantDocumentVersionRow } from "@/lib/documents/types";

interface RouteContext {
  params: Promise<{ id: string; versionId: string }>;
}

// POST /api/v1/documents/:id/versions/:versionId/complete
// The ONLY place a new applicant_document_versions row gets created, and the
// only place current_version_id gets re-pointed. Verifies via
// R2Provider.exists() that the file is genuinely in R2 before writing
// anything or touching the document's current_version_id — see
// POST /documents/:id/versions's header comment for why this matters more
// here than on the initial upload (a bad re-point breaks a previously
// working document, not just creates a new broken one).
// Idempotent: a version row already existing with this id (a retried call
// after a real success) returns the current document rather than erroring.
export async function POST(request: NextRequest, context: RouteContext) {
  const { id, versionId } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/documents/${id}/versions/${versionId}/complete` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICANT_DOCUMENTS)) return apiForbidden();

  const db = await scopedClient(auth);
  const resolved = await assertDocumentVisible(db, auth, id);
  if (!resolved) return apiNotFound("Document");
  const { document } = resolved;

  const { data: existingVersionData } = await db.from("applicant_document_versions").select("*").eq("id", versionId).maybeSingle();
  const existingVersion = (existingVersionData as unknown as ApplicantDocumentVersionRow | null) ?? null;
  if (existingVersion) {
    log.info({ documentId: id, versionId }, "Version complete call is idempotent — already confirmed");
    const { data: currentDoc } = await db.from("applicant_documents").select("*").eq("id", id).maybeSingle();
    return apiSuccess({ document: currentDoc ?? document, version: existingVersion });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const { valid, errors } = validate(body, {
    original_filename: [required("original_filename"), maxLength(500)],
    file_size: [required("file_size"), isPositiveInt()],
    checksum: [required("checksum"), isSha256Checksum()],
  });
  if (!valid) return apiValidationError(errors);

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

  const storageKey = buildDocumentStorageKey({
    tenantId: auth.tenantId,
    leadId: document.lead_id,
    documentId: document.id,
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
    log.warn({ storageKey }, "Version complete called but no file found in R2 — upload never landed. current_version_id left untouched.");
    return apiError(
      "UPLOAD_INCOMPLETE",
      "The file was not found in storage. The upload may have failed or been interrupted — please retry the upload.",
      409,
    );
  }

  const { data: maxVersionRow } = await db
    .from("applicant_document_versions")
    .select("version_number")
    .eq("document_id", id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersionNumber = ((maxVersionRow as { version_number: number } | null)?.version_number ?? 0) + 1;

  const { data: createdVersion, error: versionError } = await db
    .from("applicant_document_versions")
    .insert({
      id: versionId,
      document_id: document.id,
      version_number: nextVersionNumber,
      storage_key: storageKey,
      file_size: fileSize,
      checksum: String(body.checksum).toLowerCase(),
      mime_type: resolvedMimeType,
      created_by: auth.userId,
    })
    .select()
    .single();
  if (versionError || !createdVersion) {
    log.error({ error: versionError }, "Failed to create applicant document version row");
    return apiError("DB_ERROR", "Failed to create document version", 500);
  }

  const { data: updatedDocument, error: updateError } = await db
    .from("applicant_documents")
    .update({
      current_version_id: versionId,
      mime_type: resolvedMimeType,
      file_size: fileSize,
      original_filename: originalFilename,
      status: "uploaded",
    })
    .eq("id", document.id)
    .select()
    .single();
  if (updateError || !updatedDocument) {
    log.error({ error: updateError }, "Failed to re-point document at its new version");
    return apiError("DB_ERROR", "Failed to finalize document version", 500);
  }

  const { error: usageError } = await db.from("document_usage_events").insert({
    event_type: "upload",
    resource_type: "applicant_document_version",
    resource_id: versionId,
    actor_user_id: auth.userId,
  });
  if (usageError) log.error({ error: usageError }, "Failed to record document_usage_events upload row (non-blocking)");

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "document.version_created",
      entityType: "applicant_document",
      entityId: document.id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "document.version_created",
      entityType: "applicant_document",
      entityId: document.id,
      payload: { versionNumber: nextVersionNumber },
      requestId,
    }),
  ]);

  log.info({ documentId: document.id, versionId, versionNumber: nextVersionNumber }, "Applicant document new version confirmed and persisted");
  return apiSuccess({ document: updatedDocument, version: createdVersion }, 201);
}
