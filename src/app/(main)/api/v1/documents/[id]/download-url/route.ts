import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { assertDocumentVisible } from "@/lib/documents/access";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { getDocumentStorageProvider } from "@/lib/documents/storage/r2-provider";
import type { ApplicantDocumentVersionRow } from "@/lib/documents/types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const DOWNLOAD_URL_EXPIRY_SECONDS = 10 * 60; // 10 minutes — short window given document sensitivity

// GET /api/v1/documents/:id/download-url — short-lived signed URL, audit-logged
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "GET", path: `/api/v1/documents/${id}/download-url` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICANT_DOCUMENTS)) return apiForbidden();

  const db = await scopedClient(auth);
  const resolved = await assertDocumentVisible(db, auth, id);
  if (!resolved) return apiNotFound("Document");
  const { document } = resolved;

  if (!document.current_version_id) return apiNotFound("Document version");

  const { data: versionData } = await db
    .from("applicant_document_versions")
    .select("*")
    .eq("id", document.current_version_id)
    .maybeSingle();
  const version = (versionData as unknown as ApplicantDocumentVersionRow | null) ?? null;
  if (!version) return apiNotFound("Document version");

  let url: string;
  try {
    url = await getDocumentStorageProvider().createSignedDownloadUrl(version.storage_key, DOWNLOAD_URL_EXPIRY_SECONDS);
  } catch (storageError) {
    log.error({ error: storageError }, "Failed to create signed download URL");
    return apiError("STORAGE_ERROR", "Failed to create download URL", 500);
  }

  await db.from("document_usage_events").insert({
    event_type: "download",
    resource_type: "applicant_document",
    resource_id: document.id,
    actor_user_id: auth.userId,
  });

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "document.downloaded",
      entityType: "applicant_document",
      entityId: document.id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "document.downloaded",
      entityType: "applicant_document",
      entityId: document.id,
      requestId,
    }),
  ]);

  log.info({ documentId: document.id }, "Applicant document download URL issued");
  return apiSuccess({ url, expires_in: DOWNLOAD_URL_EXPIRY_SECONDS });
}
