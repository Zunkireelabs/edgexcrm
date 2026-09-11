import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError, apiValidationError } from "@/lib/api/response";
import { validate, required, isIn, isPositiveInt, maxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { assertLeadVisible } from "@/lib/documents/access";
import { DOCUMENT_TYPES, resolveDocumentMimeType } from "@/lib/documents/constants";
import { loadMaxDocumentSizeBytes } from "@/lib/documents/settings";
import { buildDocumentStorageKey } from "@/lib/documents/storage-key";
import { getDocumentStorageProvider } from "@/lib/documents/storage/r2-provider";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/v1/leads/:id/documents/upload-url
// Issues a presigned R2 PUT URL only. Deliberately writes NOTHING to the
// database — no applicant_documents row, no applicant_document_versions row.
// A row is only ever created by POST /complete, and only after that route
// has independently verified the file is genuinely sitting in R2 (via
// R2Provider.exists()). This is the fix for a real bug: an earlier version
// of this route created the rows here, before the client had uploaded
// anything — if the client's PUT then failed or never happened, the
// database permanently claimed a document existed with nothing behind it.
// See docs/APPLICANT-DOCUMENTS-STATUS.md's incident note for the full story.
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/leads/${id}/documents/upload-url` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICANT_DOCUMENTS)) return apiForbidden();

  const db = await scopedClient(auth);
  const lead = await assertLeadVisible(db, auth, id);
  if (!lead) return apiNotFound("Lead");

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const { valid, errors } = validate(body, {
    document_type: [required("document_type"), isIn([...DOCUMENT_TYPES])],
    name: [required("name"), maxLength(255)],
    original_filename: [required("original_filename"), maxLength(500)],
    // NOT required() here: some browsers report an empty file.type for
    // .docx and other less-common types (same gotcha the knowledge-base
    // upload hit) — resolveDocumentMimeType falls back to the filename
    // extension below, so an empty string must reach that, not get
    // rejected as "missing" first.
    file_size: [required("file_size"), isPositiveInt()],
    // checksum is validated at /complete, not here — this route writes
    // nothing to the database, so there's nowhere to persist it yet.
  });
  if (!valid) return apiValidationError(errors);

  const originalFilename = String(body.original_filename);
  // Never trust the client's declared Content-Type/extension for anything
  // security-relevant — this only decides what gets stored/allowed, the
  // storage key itself is always server-generated (see buildDocumentStorageKey).
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

  const documentId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const storageKey = buildDocumentStorageKey({
    tenantId: auth.tenantId,
    leadId: id,
    documentId,
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

  log.info({ documentId, versionId, storageKey }, "Applicant document upload URL issued (no DB row yet — pending /complete)");
  return apiSuccess({
    document_id: documentId,
    version_id: versionId,
    upload_url: signed.url,
    upload_headers: signed.headers,
    storage_key: storageKey,
  });
}
