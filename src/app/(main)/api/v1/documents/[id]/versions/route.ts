import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError, apiValidationError } from "@/lib/api/response";
import { validate, required, isPositiveInt, maxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { assertDocumentVisible } from "@/lib/documents/access";
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

// POST /api/v1/documents/:id/versions — issues a presigned R2 PUT URL for a
// new version. Deliberately writes NOTHING to the database — no version row,
// no re-pointing of current_version_id. That only happens in
// POST /documents/:id/versions/:versionId/complete, after that route has
// verified the file genuinely exists in R2.
//
// This split matters more here than on the initial upload: pointing
// current_version_id at an unconfirmed key doesn't just create a ghost
// document — it would silently break access to a PREVIOUSLY WORKING
// document by repointing it at a file that was never actually written. See
// docs/APPLICANT-DOCUMENTS-STATUS.md's incident note.
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

  log.info({ documentId: document.id, versionId, storageKey }, "New document version upload URL issued (no DB row yet — pending /complete)");
  return apiSuccess({
    version_id: versionId,
    upload_url: signed.url,
    upload_headers: signed.headers,
    storage_key: storageKey,
  });
}
