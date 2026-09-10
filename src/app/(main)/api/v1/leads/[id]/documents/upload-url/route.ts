import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError, apiValidationError } from "@/lib/api/response";
import { validate, required, isIn, isPositiveInt, maxLength } from "@/lib/api/validation";
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

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/v1/leads/:id/documents/upload-url
// Issues a presigned R2 PUT URL and creates the document + version-1 rows
// (status: 'uploaded'). No Inngest ingestion event fires — that's a later
// phase's job. See docs/APPLICANT-DOCUMENTS-PHASE1-BRIEF.md §5.
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
    checksum: [required("checksum"), isSha256Checksum()],
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

  const { data: created, error: docError } = await db
    .from("applicant_documents")
    .insert({
      id: documentId,
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
    document_id: documentId,
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
    .eq("id", documentId)
    .select()
    .single();
  if (updateError || !updated) {
    log.error({ error: updateError }, "Failed to point document at its first version");
    return apiError("DB_ERROR", "Failed to finalize document", 500);
  }

  log.info({ documentId, versionId, storageKey }, "Applicant document upload URL issued");
  return apiSuccess(
    {
      document: updated,
      upload_url: signed.url,
      upload_headers: signed.headers,
      storage_key: storageKey,
      version_id: versionId,
    },
    201,
  );
}
