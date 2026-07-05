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
import { validate, required, isUUID, isIn } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";

const ROLES = ["primary", "technical", "billing", "other"];
const ROLE_ORDER: Record<string, number> = {
  primary: 0,
  technical: 1,
  billing: 2,
  other: 3,
};

interface Props {
  params: Promise<{ id: string }>;
}

type RawContactRow = {
  role: string | null;
  contacts: {
    id: string;
    first_name: string;
    last_name: string;
    email: string | null;
    title: string | null;
    status: string;
  } | null;
};

function sortByRoleThenName(rows: RawContactRow[]): RawContactRow[] {
  return [...rows].sort((a, b) => {
    const aOrder = a.role !== null ? (ROLE_ORDER[a.role] ?? 4) : 4;
    const bOrder = b.role !== null ? (ROLE_ORDER[b.role] ?? 4) : 4;
    if (aOrder !== bOrder) return aOrder - bOrder;
    const aName = a.contacts?.last_name ?? "";
    const bName = b.contacts?.last_name ?? "";
    return aName.localeCompare(bName);
  });
}

function hasDealsAndContactsAccess(industryId: string | null): boolean {
  return (
    getFeatureAccess(industryId, FEATURES.DEALS) &&
    getFeatureAccess(industryId, FEATURES.CRM_CONTACTS)
  );
}

// deal_contacts has two unique constraints that both throw 23505:
// the composite PK (deal_id, contact_id) — "already linked" — and the
// deal_contacts_one_primary partial index — "primary taken". Disambiguate
// by constraint name in the error message so callers get the right 409.
function handleUniqueViolation(error: { code?: string; message?: string }) {
  if (error.message?.includes("deal_contacts_one_primary")) {
    return apiError(
      "PRIMARY_TAKEN",
      "This deal already has a primary contact. Demote them first or pick a different role.",
      409
    );
  }
  if (error.message?.includes("deal_contacts_pkey")) {
    return apiError("ALREADY_LINKED", "This contact is already linked to this deal.", 409);
  }
  return apiError("CONFLICT", "This link already exists or conflicts with another.", 409);
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id: dealId } = await params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!hasDealsAndContactsAccess(auth.industryId)) return apiForbidden();

  const db = await scopedClient(auth);

  // Verify deal belongs to tenant
  const { data: deal } = await db
    .from("deals")
    .select("id")
    .eq("id", dealId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!deal) return apiNotFound("Deal");

  const { data: rows, error } = await db
    .raw()
    .from("deal_contacts")
    .select(
      "role, contacts!deal_contacts_contact_id_fkey(id, first_name, last_name, email, title, status)"
    )
    .eq("deal_id", dealId);

  if (error) return apiError("DB_ERROR", "Failed to fetch deal contacts", 500);

  const sorted = sortByRoleThenName((rows ?? []) as unknown as RawContactRow[]);
  return apiSuccess(sorted);
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id: dealId } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: `/api/v1/deals/${dealId}/contacts`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!hasDealsAndContactsAccess(auth.industryId)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const validation: Record<string, ReturnType<typeof required>[]> = {
    contact_id: [required("contact_id"), isUUID()],
  };
  if (body.role !== undefined) {
    (validation as Record<string, unknown[]>).role = [isIn(ROLES)];
  }
  const { valid, errors } = validate(body, validation);
  if (!valid) return apiValidationError(errors);

  const contactId = String(body.contact_id);
  const db = await scopedClient(auth);

  // Verify deal belongs to tenant
  const { data: deal } = await db
    .from("deals")
    .select("id, account_id")
    .eq("id", dealId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!deal) return apiNotFound("Deal");

  // Verify contact belongs to tenant
  const { data: contact } = await db
    .from("contacts")
    .select("id, account_id")
    .eq("id", contactId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!contact) return apiNotFound("Contact");

  const d = deal as unknown as { id: string; account_id: string | null };
  const c = contact as unknown as { id: string; account_id: string };

  // Cross-account link: warn but allow
  if (d.account_id && d.account_id !== c.account_id) {
    log.warn(
      { dealId, contactId, dealAccount: d.account_id, contactAccount: c.account_id },
      "Cross-account deal-contact link — allowed"
    );
  }

  const role = body.role ? String(body.role) : null;

  const { data: inserted, error } = await db
    .raw()
    .from("deal_contacts")
    .insert({ deal_id: dealId, contact_id: contactId, role })
    .select(
      "role, contacts!deal_contacts_contact_id_fkey(id, first_name, last_name, email, title, status)"
    )
    .single();

  if (error) {
    if (error.code === "23505") return handleUniqueViolation(error);
    log.error({ error }, "Failed to insert deal_contact");
    return apiError("DB_ERROR", "Failed to link contact to deal", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "deal_contact.linked",
      entityType: "deal_contact",
      entityId: `${dealId}:${contactId}`,
      changes: { link: { old: null, new: { deal_id: dealId, contact_id: contactId, role } } },
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "deal_contact.linked",
      entityType: "deal_contact",
      entityId: `${dealId}:${contactId}`,
      requestId,
    }),
  ]);

  log.info({ dealId, contactId, role }, "Contact linked to deal");
  return apiSuccess(inserted, 201);
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id: dealId } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "PATCH",
    path: `/api/v1/deals/${dealId}/contacts`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!hasDealsAndContactsAccess(auth.industryId)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    contact_id: [required("contact_id"), isUUID()],
  });
  if (!valid) return apiValidationError(errors);

  if (
    body.role !== undefined &&
    body.role !== null &&
    !ROLES.includes(String(body.role))
  ) {
    return apiError("VALIDATION_ERROR", `role must be one of: ${ROLES.join(", ")} or null`, 400);
  }

  const contactId = String(body.contact_id);
  const db = await scopedClient(auth);

  // Verify deal belongs to tenant
  const { data: deal } = await db
    .from("deals")
    .select("id")
    .eq("id", dealId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!deal) return apiNotFound("Deal");

  // Verify contact belongs to tenant
  const { data: contact } = await db
    .from("contacts")
    .select("id")
    .eq("id", contactId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!contact) return apiNotFound("Contact");

  const { data: existing } = await db
    .raw()
    .from("deal_contacts")
    .select("deal_id, contact_id, role")
    .eq("deal_id", dealId)
    .eq("contact_id", contactId)
    .maybeSingle();
  if (!existing) return apiNotFound("Deal contact link");

  const newRole =
    body.role !== undefined
      ? body.role
        ? String(body.role)
        : null
      : (existing as { role: string | null }).role;

  const { data: updated, error } = await db
    .raw()
    .from("deal_contacts")
    .update({ role: newRole })
    .eq("deal_id", dealId)
    .eq("contact_id", contactId)
    .select(
      "role, contacts!deal_contacts_contact_id_fkey(id, first_name, last_name, email, title, status)"
    )
    .single();

  if (error) {
    if (error.code === "23505") return handleUniqueViolation(error);
    log.error({ error }, "Failed to update deal_contact role");
    return apiError("DB_ERROR", "Failed to update role", 500);
  }

  await createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "deal_contact.updated",
    entityType: "deal_contact",
    entityId: `${dealId}:${contactId}`,
    changes: { role: { old: (existing as { role: string | null }).role, new: newRole } },
    requestId,
  });

  log.info({ dealId, contactId, role: newRole }, "Deal contact role updated");
  return apiSuccess(updated);
}

export async function DELETE(request: NextRequest, { params }: Props) {
  const { id: dealId } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "DELETE",
    path: `/api/v1/deals/${dealId}/contacts`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!hasDealsAndContactsAccess(auth.industryId)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const { searchParams } = new URL(request.url);
  const contactId = searchParams.get("contact_id");
  if (!contactId) {
    return apiError("VALIDATION_ERROR", "contact_id query param is required", 400);
  }

  const db = await scopedClient(auth);

  // Verify deal belongs to tenant
  const { data: deal } = await db
    .from("deals")
    .select("id")
    .eq("id", dealId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!deal) return apiNotFound("Deal");

  // Verify contact belongs to tenant
  const { data: contact } = await db
    .from("contacts")
    .select("id")
    .eq("id", contactId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!contact) return apiNotFound("Contact");

  const { error } = await db
    .raw()
    .from("deal_contacts")
    .delete()
    .eq("deal_id", dealId)
    .eq("contact_id", contactId);

  if (error) {
    log.error({ error }, "Failed to delete deal_contact");
    return apiError("DB_ERROR", "Failed to unlink contact from deal", 500);
  }

  await createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "deal_contact.unlinked",
    entityType: "deal_contact",
    entityId: `${dealId}:${contactId}`,
    requestId,
  });

  log.info({ dealId, contactId }, "Contact unlinked from deal");
  return apiSuccess({ deal_id: dealId, contact_id: contactId });
}
