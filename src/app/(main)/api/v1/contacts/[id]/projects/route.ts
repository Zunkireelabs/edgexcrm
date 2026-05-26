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

interface Props {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id: contactId } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: `/api/v1/contacts/${contactId}/projects`,
  });

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

  const validation: Record<string, ReturnType<typeof required>[]> = {
    project_id: [required("project_id"), isUUID()],
  };
  if (body.role !== undefined) {
    (validation as Record<string, unknown[]>).role = [isIn(ROLES)];
  }
  const { valid, errors } = validate(body, validation);
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);

  // Verify contact belongs to tenant (scoped client auto-applies tenant filter)
  const { data: contact } = await db
    .from("contacts")
    .select("id, account_id")
    .eq("id", contactId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!contact) return apiNotFound("Contact");

  const projectId = String(body.project_id);

  // Verify project belongs to tenant
  const { data: project } = await db
    .from("projects")
    .select("id, account_id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return apiNotFound("Project");

  const c = contact as unknown as { id: string; account_id: string };
  const p = project as unknown as { id: string; account_id: string };

  // Cross-account link: warn but allow (contractor reality)
  if (c.account_id !== p.account_id) {
    log.warn(
      { contactId, projectId, contactAccount: c.account_id, projectAccount: p.account_id },
      "Cross-account project-contact link — allowed"
    );
  }

  const role = body.role ? String(body.role) : null;

  const { data: inserted, error } = await db
    .raw()
    .from("project_contacts")
    .insert({ project_id: projectId, contact_id: contactId, role })
    .select("role, projects!project_contacts_project_id_fkey(id, name, account_id, accounts!projects_account_id_fkey(id, name))")
    .single();

  if (error) {
    if (error.code === "23505") {
      return apiError(
        "PRIMARY_TAKEN",
        "This project already has a primary contact. Demote them first or pick a different role.",
        409
      );
    }
    log.error({ error }, "Failed to insert project_contact");
    return apiError("DB_ERROR", "Failed to link contact to project", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "project_contact.linked",
      entityType: "project_contact",
      entityId: `${projectId}:${contactId}`,
      changes: { link: { old: null, new: { project_id: projectId, contact_id: contactId, role } } },
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "project_contact.linked",
      entityType: "project_contact",
      entityId: `${projectId}:${contactId}`,
      requestId,
    }),
  ]);

  log.info({ contactId, projectId, role }, "Contact linked to project");
  return apiSuccess(inserted, 201);
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id: contactId } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "PATCH",
    path: `/api/v1/contacts/${contactId}/projects`,
  });

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
    project_id: [required("project_id"), isUUID()],
  });
  if (!valid) return apiValidationError(errors);

  if (
    body.role !== undefined &&
    body.role !== null &&
    !ROLES.includes(String(body.role))
  ) {
    return apiError("VALIDATION_ERROR", `role must be one of: ${ROLES.join(", ")} or null`, 400);
  }

  const projectId = String(body.project_id);
  const db = await scopedClient(auth);

  // Verify contact belongs to tenant
  const { data: contact } = await db
    .from("contacts")
    .select("id")
    .eq("id", contactId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!contact) return apiNotFound("Contact");

  // Verify project belongs to tenant
  const { data: project } = await db
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return apiNotFound("Project");

  const { data: existing } = await db
    .raw()
    .from("project_contacts")
    .select("project_id, contact_id, role")
    .eq("project_id", projectId)
    .eq("contact_id", contactId)
    .maybeSingle();
  if (!existing) return apiNotFound("Project contact link");

  const newRole = body.role !== undefined ? (body.role ? String(body.role) : null) : (existing as { role: string | null }).role;

  const { data: updated, error } = await db
    .raw()
    .from("project_contacts")
    .update({ role: newRole })
    .eq("project_id", projectId)
    .eq("contact_id", contactId)
    .select("role, projects!project_contacts_project_id_fkey(id, name, account_id, accounts!projects_account_id_fkey(id, name))")
    .single();

  if (error) {
    if (error.code === "23505") {
      return apiError(
        "PRIMARY_TAKEN",
        "This project already has a primary contact. Demote them first or pick a different role.",
        409
      );
    }
    log.error({ error }, "Failed to update project_contact role");
    return apiError("DB_ERROR", "Failed to update role", 500);
  }

  await createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "project_contact.role_changed",
    entityType: "project_contact",
    entityId: `${projectId}:${contactId}`,
    changes: { role: { old: (existing as { role: string | null }).role, new: newRole } },
    requestId,
  });

  log.info({ contactId, projectId, role: newRole }, "Project contact role updated");
  return apiSuccess(updated);
}

export async function DELETE(request: NextRequest, { params }: Props) {
  const { id: contactId } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "DELETE",
    path: `/api/v1/contacts/${contactId}/projects`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CRM_CONTACTS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("project_id");
  if (!projectId) {
    return apiError("VALIDATION_ERROR", "project_id query param is required", 400);
  }

  const db = await scopedClient(auth);

  // Verify contact belongs to tenant
  const { data: contact } = await db
    .from("contacts")
    .select("id")
    .eq("id", contactId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!contact) return apiNotFound("Contact");

  // Verify project belongs to tenant
  const { data: project } = await db
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return apiNotFound("Project");

  const { error } = await db
    .raw()
    .from("project_contacts")
    .delete()
    .eq("project_id", projectId)
    .eq("contact_id", contactId);

  if (error) {
    log.error({ error }, "Failed to delete project_contact");
    return apiError("DB_ERROR", "Failed to unlink contact from project", 500);
  }

  await createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "project_contact.unlinked",
    entityType: "project_contact",
    entityId: `${projectId}:${contactId}`,
    requestId,
  });

  log.info({ contactId, projectId }, "Contact unlinked from project");
  return apiSuccess({ contact_id: contactId, project_id: projectId });
}
