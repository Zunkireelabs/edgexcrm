import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { validate, maxLength, optionalMaxLength, isUUID, isIn } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CRM_CONTACTS)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: contact, error } = await db
    .from("contacts")
    .select("*, accounts(id, name), project_contacts(role, projects(id, name, account_id))")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) return apiError("DB_ERROR", "Failed to fetch contact", 500);
  if (!contact) return apiNotFound("Contact");
  return apiSuccess(contact);
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/contacts/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CRM_CONTACTS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  if (body.account_id !== undefined) {
    return apiError("VALIDATION_ERROR", "account_id cannot be changed in v1", 400);
  }

  const validationRules: Record<string, ReturnType<typeof maxLength>[]> = {
    first_name: [maxLength(255)],
    last_name: [maxLength(255)],
    email: [optionalMaxLength(255)],
    phone: [optionalMaxLength(50)],
    title: [optionalMaxLength(255)],
    notes: [optionalMaxLength(2000)],
  };
  if (body.status !== undefined) {
    (validationRules as Record<string, unknown[]>).status = [isIn(["active", "inactive"])];
  }
  if (body.assigned_to !== undefined && body.assigned_to !== null) {
    (validationRules as Record<string, unknown[]>).assigned_to = [isUUID()];
  }

  const { valid, errors } = validate(body, validationRules);
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);

  const { data: existing } = await db
    .from("contacts")
    .select("id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!existing) return apiNotFound("Contact");

  const patch: Record<string, unknown> = {};
  if (body.first_name !== undefined) patch.first_name = String(body.first_name).trim();
  if (body.last_name !== undefined) patch.last_name = String(body.last_name).trim();
  if (body.email !== undefined) patch.email = body.email ? String(body.email).trim() : null;
  if (body.phone !== undefined) patch.phone = body.phone ? String(body.phone).trim() : null;
  if (body.title !== undefined) patch.title = body.title ? String(body.title).trim() : null;
  if (body.status !== undefined) patch.status = body.status;
  if (body.assigned_to !== undefined) patch.assigned_to = body.assigned_to ?? null;
  if (body.notes !== undefined) patch.notes = body.notes ? String(body.notes).trim() : null;

  const { data: updated, error } = await db
    .from("contacts")
    .update(patch)
    .eq("id", id)
    .select("*, accounts(id, name)")
    .single();

  if (error) {
    log.error({ error }, "Failed to update contact");
    return apiError("DB_ERROR", "Failed to update contact", 500);
  }

  await createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "contact.updated",
    entityType: "contact",
    entityId: id,
    changes: { patch: { old: existing, new: patch } },
    requestId,
  });

  log.info({ contactId: id }, "Contact updated");
  return apiSuccess(updated);
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/contacts/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CRM_CONTACTS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);

  const { data: existing } = await db
    .from("contacts")
    .select("id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!existing) return apiNotFound("Contact");

  const { error: softDeleteError } = await db
    .from("contacts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (softDeleteError) {
    log.error({ error: softDeleteError }, "Failed to soft-delete contact");
    return apiError("DB_ERROR", "Failed to delete contact", 500);
  }

  // Clear dangling primary_contact_id references on accounts
  await db
    .from("accounts")
    .update({ primary_contact_id: null })
    .eq("primary_contact_id", id);

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "contact.deleted",
      entityType: "contact",
      entityId: id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "contact.deleted",
      entityType: "contact",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ contactId: id }, "Contact soft-deleted");
  return apiSuccess({ id });
}
