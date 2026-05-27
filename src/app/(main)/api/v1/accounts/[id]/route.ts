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
import { validate, maxLength, optionalMaxLength, isUUID } from "@/lib/api/validation";
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
  if (!getFeatureAccess(auth.industryId, FEATURES.ACCOUNTS)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: account, error } = await db
    .from("accounts")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return apiError("DB_ERROR", "Failed to fetch account", 500);
  if (!account) return apiNotFound("Account");
  return apiSuccess(account);
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/accounts/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.ACCOUNTS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const validationRules: Record<string, ReturnType<typeof maxLength>[]> = {
    name: [maxLength(255)],
    primary_contact_email: [optionalMaxLength(255)],
    notes: [optionalMaxLength(2000)],
  };
  if (body.primary_contact_id !== undefined && body.primary_contact_id !== null) {
    (validationRules as Record<string, unknown[]>).primary_contact_id = [isUUID()];
  }
  const { valid, errors } = validate(body, validationRules);
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);

  // Verify it exists and belongs to this tenant
  const { data: existing } = await db
    .from("accounts")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Account");

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.primary_contact_email !== undefined)
    patch.primary_contact_email = body.primary_contact_email
      ? String(body.primary_contact_email).trim()
      : null;
  if (body.notes !== undefined) patch.notes = body.notes ? String(body.notes).trim() : null;
  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);
  if (body.primary_contact_id !== undefined) {
    if (body.primary_contact_id !== null) {
      // Validate the contact belongs to this account and tenant
      const { data: contactCheck } = await db
        .from("contacts")
        .select("id")
        .eq("id", String(body.primary_contact_id))
        .eq("account_id", id)
        .is("deleted_at", null)
        .maybeSingle();
      if (!contactCheck) return apiNotFound("Contact");
    }
    patch.primary_contact_id = body.primary_contact_id ?? null;
  }

  const { data: updated, error } = await db
    .from("accounts")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to update account");
    return apiError("DB_ERROR", "Failed to update account", 500);
  }

  await createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "account.updated",
    entityType: "account",
    entityId: id,
    changes: { patch: { old: existing, new: patch } },
    requestId,
  });

  log.info({ accountId: id }, "Account updated");
  return apiSuccess(updated);
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/accounts/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.ACCOUNTS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: existing } = await db
    .from("accounts")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Account");

  const { error } = await db.from("accounts").delete().eq("id", id);
  if (error) {
    log.error({ error }, "Failed to delete account");
    return apiError("DB_ERROR", "Failed to delete account", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "account.deleted",
      entityType: "account",
      entityId: id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "account.deleted",
      entityType: "account",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ accountId: id }, "Account deleted");
  return apiSuccess({ id });
}
