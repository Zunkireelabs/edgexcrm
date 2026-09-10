import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { assertLeadVisible } from "@/lib/documents/access";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import type { ApplicantDocumentRow } from "@/lib/documents/types";

interface RouteContext {
  params: Promise<{ id: string; docId: string }>;
}

// POST /api/v1/leads/:id/documents/:docId/complete
// Client confirms the presigned PUT succeeded. The document+version rows
// already exist (created by upload-url) and status already stays 'uploaded' —
// this phase does not queue ingestion, so there is nothing to flip. This
// route's job is purely to record that the upload genuinely happened
// (audit log + usage ledger row), since upload-url only ever reserved the
// metadata before the client's PUT ran.
export async function POST(_request: NextRequest, context: RouteContext) {
  const { id, docId } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/leads/${id}/documents/${docId}/complete` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICANT_DOCUMENTS)) return apiForbidden();

  const db = await scopedClient(auth);
  const lead = await assertLeadVisible(db, auth, id);
  if (!lead) return apiNotFound("Lead");

  const { data } = await db.from("applicant_documents").select("*").eq("id", docId).eq("lead_id", id).is("deleted_at", null).maybeSingle();
  const document = (data as unknown as ApplicantDocumentRow | null) ?? null;
  if (!document) return apiNotFound("Document");

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

  log.info({ documentId: document.id }, "Applicant document upload confirmed");
  return apiSuccess(document);
}
