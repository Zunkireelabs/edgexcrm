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
import { validate, required, maxLength, optionalMaxLength, isUUID } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CRM_CONTACTS)) return apiForbidden();

  const db = await scopedClient(auth);
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("account_id");
  const statusParam = searchParams.get("status");
  const q = searchParams.get("q");
  const includeInactive = searchParams.get("include_inactive") === "1";

  let query = db
    .from("contacts")
    .select("*, accounts(id, name)")
    .is("deleted_at", null);

  if (accountId) {
    query = query.eq("account_id", accountId);
  }

  if (statusParam) {
    query = query.eq("status", statusParam);
  } else if (!includeInactive) {
    query = query.eq("status", "active");
  }

  if (q) {
    // Strip characters that have special meaning in PostgREST .or() parsing
    // (commas separate OR conditions; parens group; backslash escapes). Replace
    // with spaces so the rest of the search string remains usable.
    const safeQ = q.replace(/[,()\\]/g, " ").trim();
    if (safeQ) {
      query = query.or(
        `first_name.ilike.%${safeQ}%,last_name.ilike.%${safeQ}%,email.ilike.%${safeQ}%,title.ilike.%${safeQ}%`
      );
    }
  }

  const { data: contacts, error } = await query.order("last_name").order("first_name");
  if (error) return apiError("DB_ERROR", "Failed to fetch contacts", 500);
  return apiSuccess(contacts ?? []);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/contacts" });

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

  const { valid, errors } = validate(body, {
    first_name: [required("first_name"), maxLength(255)],
    last_name: [required("last_name"), maxLength(255)],
    account_id: [required("account_id"), isUUID()],
    email: [optionalMaxLength(255)],
    phone: [optionalMaxLength(50)],
    title: [optionalMaxLength(255)],
    notes: [optionalMaxLength(2000)],
  });
  if (!valid) return apiValidationError(errors);

  const email = body.email ? String(body.email).trim() : null;
  const phone = body.phone ? String(body.phone).trim() : null;
  if (!email && !phone) {
    return apiError("VALIDATION_ERROR", "At least one of email or phone is required", 400);
  }

  const db = await scopedClient(auth);

  const { data: account } = await db
    .from("accounts")
    .select("id")
    .eq("id", String(body.account_id))
    .maybeSingle();
  if (!account) return apiNotFound("Account");

  const { data: created, error } = await db
    .from("contacts")
    .insert({
      first_name: String(body.first_name).trim(),
      last_name: String(body.last_name).trim(),
      account_id: String(body.account_id),
      email,
      phone,
      title: body.title ? String(body.title).trim() : null,
      notes: body.notes ? String(body.notes).trim() : null,
      status: "active",
      assigned_to: null,
    })
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to create contact");
    return apiError("DB_ERROR", "Failed to create contact", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "contact.created",
      entityType: "contact",
      entityId: created.id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "contact.created",
      entityType: "contact",
      entityId: created.id,
      requestId,
    }),
  ]);

  log.info({ contactId: created.id }, "Contact created");
  return apiSuccess(created, 201);
}
