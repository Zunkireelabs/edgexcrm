import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError, apiValidationError } from "@/lib/api/response";
import { validate, isIn, optionalMaxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { assertDocumentVisible } from "@/lib/documents/access";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { DOCUMENT_TYPES, VERIFICATION_STATUSES } from "@/lib/documents/constants";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/v1/documents/:id — metadata (+ extraction if present; always null until a later phase)
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICANT_DOCUMENTS)) return apiForbidden();

  const db = await scopedClient(auth);
  const resolved = await assertDocumentVisible(db, auth, id);
  if (!resolved) return apiNotFound("Document");
  const { document } = resolved;

  const { data: extraction } = await db
    .from("applicant_document_extractions")
    .select("*")
    .eq("document_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return apiSuccess({ ...document, extraction: extraction ?? null });
}

// PATCH /api/v1/documents/:id — rename / re-type / description / verification_status
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/documents/${id}` });

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
    name: [optionalMaxLength(255)],
    document_type: body.document_type !== undefined ? [isIn([...DOCUMENT_TYPES])] : [],
    description: [optionalMaxLength(5000)],
    verification_status: body.verification_status !== undefined ? [isIn([...VERIFICATION_STATUSES])] : [],
  });
  if (!valid) return apiValidationError(errors);

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.document_type !== undefined) patch.document_type = String(body.document_type);
  if (body.description !== undefined) patch.description = body.description === null ? null : String(body.description);
  if (body.verification_status !== undefined) patch.verification_status = String(body.verification_status);

  if (Object.keys(patch).length === 0) {
    return apiValidationError({ body: ["No updatable fields provided"] });
  }

  const { data: updated, error } = await db.from("applicant_documents").update(patch).eq("id", id).select().single();
  if (error || !updated) {
    log.error({ error }, "Failed to update applicant document");
    return apiError("DB_ERROR", "Failed to update document", 500);
  }

  let action: string | null = null;
  if (patch.verification_status === "verified") action = "document.verified";
  else if (patch.verification_status === "rejected") action = "document.rejected";
  else if (patch.name !== undefined || patch.document_type !== undefined || patch.description !== undefined) action = "document.renamed";

  if (action) {
    await Promise.all([
      createAuditLog({
        tenantId: auth.tenantId,
        userId: auth.userId,
        action,
        entityType: "applicant_document",
        entityId: document.id,
        requestId,
      }),
      emitEvent({
        tenantId: auth.tenantId,
        type: action,
        entityType: "applicant_document",
        entityId: document.id,
        requestId,
      }),
    ]);
  }

  log.info({ documentId: document.id, action }, "Applicant document updated");
  return apiSuccess(updated);
}

// DELETE /api/v1/documents/:id — soft delete. Restricted to a tenant admin or the original uploader.
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/documents/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICANT_DOCUMENTS)) return apiForbidden();

  const db = await scopedClient(auth);
  const resolved = await assertDocumentVisible(db, auth, id);
  if (!resolved) return apiNotFound("Document");
  const { document } = resolved;

  if (!requireAdmin(auth) && document.uploaded_by !== auth.userId) {
    return apiForbidden("Only a tenant admin or the original uploader may delete this document");
  }

  const { error } = await db.from("applicant_documents").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) {
    log.error({ error }, "Failed to soft-delete applicant document");
    return apiError("DB_ERROR", "Failed to delete document", 500);
  }

  await db.from("document_usage_events").insert({
    event_type: "delete",
    resource_type: "applicant_document",
    resource_id: document.id,
    actor_user_id: auth.userId,
  });

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "document.deleted",
      entityType: "applicant_document",
      entityId: document.id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "document.deleted",
      entityType: "applicant_document",
      entityId: document.id,
      requestId,
    }),
  ]);

  log.info({ documentId: document.id }, "Applicant document soft-deleted");
  return apiSuccess({ id: document.id, deleted: true });
}
