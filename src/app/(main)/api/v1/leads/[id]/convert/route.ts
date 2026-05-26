import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";

interface Props {
  params: Promise<{ id: string }>;
}

interface ConvertBody {
  account_id?: string;
  new_account?: { name: string };
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  title?: string;
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: `/api/v1/leads/${id}/convert`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CRM_CONTACTS)) return apiForbidden();

  let body: ConvertBody;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  // Exactly one of account_id or new_account must be present
  const hasAccountId = Boolean(body.account_id);
  const hasNewAccount = Boolean(body.new_account?.name);
  if (hasAccountId === hasNewAccount) {
    return apiValidationError({
      account: ["Provide exactly one of account_id or new_account"],
    });
  }

  const db = await scopedClient(auth);

  type LeadRow = {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    account_id: string | null;
    assigned_to: string | null;
    converted_at: string | null;
  };

  // Fetch lead with tenant filter auto-injected
  const { data: leadData } = await db
    .from("leads")
    .select("id, first_name, last_name, email, phone, account_id, assigned_to, converted_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!leadData) return apiNotFound("Lead");
  const leadRow = leadData as unknown as LeadRow;

  if (leadRow.converted_at) return apiError("INVALID_STATE", "Lead already converted", 409);

  // Counselor can only convert their own lead
  if (auth.role === "counselor" && leadRow.assigned_to !== auth.userId) {
    return apiForbidden();
  }

  // Resolve account
  let resolvedAccountId: string;
  if (body.account_id) {
    const { data: account } = await db
      .from("accounts")
      .select("id")
      .eq("id", body.account_id)
      .maybeSingle();
    if (!account) return apiNotFound("Account");
    resolvedAccountId = body.account_id;
  } else {
    const { data: newAccount, error: accountErr } = await db
      .from("accounts")
      .insert({ name: body.new_account!.name })
      .select("id")
      .single();
    if (accountErr || !newAccount) {
      log.error({ error: accountErr }, "Failed to create account");
      return apiError("DB_ERROR", "Failed to create account", 500);
    }
    resolvedAccountId = newAccount.id;
  }

  // Insert contact — assigned_to mirrors lead.assigned_to for counselor scoping continuity
  const { data: newContact, error: contactErr } = await db
    .from("contacts")
    .insert({
      account_id: resolvedAccountId,
      first_name: body.first_name ?? leadRow.first_name ?? "",
      last_name: body.last_name ?? leadRow.last_name ?? "",
      email: body.email ?? leadRow.email,
      phone: body.phone ?? leadRow.phone,
      title: body.title ?? null,
      status: "active",
      assigned_to: leadRow.assigned_to ?? auth.userId,
    })
    .select("*, accounts!contacts_account_id_fkey(id, name)")
    .single();

  if (contactErr || !newContact) {
    log.error({ error: contactErr }, "Failed to create contact");
    return apiError("DB_ERROR", "Failed to create contact", 500);
  }

  // Atomic update — TOCTOU defense: only update when converted_at IS NULL
  const { data: updated, error: updateErr } = await db
    .from("leads")
    .update({
      converted_at: new Date().toISOString(),
      converted_contact_id: newContact.id,
      account_id: leadRow.account_id ?? resolvedAccountId,
    })
    .eq("id", id)
    .is("converted_at", null)
    .select("id, converted_at, converted_contact_id, account_id")
    .maybeSingle();

  if (updateErr) {
    log.error({ error: updateErr }, "Failed to convert lead");
    return apiError("DB_ERROR", "Failed to convert lead", 500);
  }

  // Race lost — another request beat us. Delete orphan contact.
  if (!updated) {
    await db.from("contacts").delete().eq("id", newContact.id);
    return apiError("INVALID_STATE", "Lead already converted", 409);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "lead.converted",
      entityType: "lead",
      entityId: id,
      changes: { converted_contact_id: { old: null, new: newContact.id } },
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "lead.converted",
      entityType: "lead",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ leadId: id, contactId: newContact.id }, "Lead converted to contact");
  return apiSuccess({ contact: newContact, account_id: resolvedAccountId, lead_id: id });
}
