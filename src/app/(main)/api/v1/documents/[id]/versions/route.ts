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
  params: Promise<{ id: string }>;
}

// GET /api/v1/documents/:id/versions — version history, newest first
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICANT_DOCUMENTS)) return apiForbidden();

  const db = await scopedClient(auth);
  const resolved = await assertDocumentVisible(db, auth, id);
  if (!resolved) return apiNotFound("Document");

  const { data, error } = await db
    .from("applicant_document_versions")
    .select("*")
    .eq("document_id", id)
    .order("version_number", { ascending: false });
  if (error) return apiError("DB_ERROR", "Failed to fetch versions", 500);

  return apiSuccess((data ?? []) as unknown as ApplicantDocumentVersionRow[]);
}

// POST /api/v1/documents/:id/versions — new version (upload-url + complete variant,
// same two-step-in-one-call pattern as the initial upload-url route). Re-points
// current_version_id at the new version and refreshes the document's top-level
// mime_type/file_size/original_filename to match it.
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/documents/${id}/versions` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICANT_DOCUMENTS)) return apiForbidden();

  const db = await scopedClient(auth);
  const resolved = await assertDocumentVisible(db, auth, id);
  if (!resolved) return apiNotFound("Document");
  const { document } = resolved;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const { valid, errors } = validate(body, {
    original_filename: [required("original_filename"), maxLength(500)],
    // NOT required() — see the upload-url route's identical comment on the
    // empty-file.type gotcha; resolveDocumentMimeType's extension fallback
    // needs an empty string to reach it, not a "missing field" rejection.
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

  const { data: maxVersionRow } = await db
    .from("applicant_document_versions")
    .select("version_number")
    .eq("document_id", id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersionNumber = ((maxVersionRow as { version_number: number } | null)?.version_number ?? 0) + 1;

  const versionId = crypto.randomUUID();
  const storageKey = buildDocumentStorageKey({
    tenantId: auth.tenantId,
    leadId: document.lead_id,
    documentId: document.id,
    versionId,
    mimeType: resolvedMimeType,
  });

  let signed: { url: string; headers?: Record<string, string> };
  try {
    signed = await getDocumentStorageProvider().createSignedUploadUrl(storageKey, resolvedMimeType);
  } catch (storageError) {
    log.error({ error: storageError }, "Failed to create signed upload URL");
    return apiError("STORAGE_ERROR", "Failed to create upload URL", 500);
  }

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

  await db.from("document_usage_events").insert({
    event_type: "upload",
    resource_type: "applicant_document_version",
    resource_id: versionId,
    actor_user_id: auth.userId,
  });

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

  log.info({ documentId: document.id, versionId, versionNumber: nextVersionNumber }, "Applicant document new version uploaded");
  return apiSuccess(
    {
      document: updatedDocument,
      version: createdVersion,
      upload_url: signed.url,
      upload_headers: signed.headers,
      storage_key: storageKey,
    },
    201,
  );
}
