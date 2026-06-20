import { NextRequest } from "next/server";
import { authenticateRequest, requireLeadBranchAccess } from "@/lib/api/auth";
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
import { createServiceClient } from "@/lib/supabase/server";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { shouldRestrictToSelf, canManageApplications } from "@/lib/api/permissions";
import { getLeadMembership } from "@/lib/leads/branch-membership";

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data, error } = await db
    .from("applications")
    .select("*, leads!applications_lead_id_fkey(id,first_name,last_name,email), application_stages!applications_stage_id_fkey(id,name,slug,color,position,terminal_type)")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) return apiError("DB_ERROR", "Failed to fetch application", 500);
  if (!data) return apiNotFound("Application");
  return apiSuccess(data);
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/applications/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();
  if (!canManageApplications(auth.permissions)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  // Fix 4: preserve POST invariants — reject empty/null for required fields
  if (body.university_name !== undefined) {
    const trimmed = String(body.university_name ?? "").trim();
    if (!trimmed) return apiValidationError({ university_name: ["university_name is required"] });
    body.university_name = trimmed;
  }
  if (body.program_name !== undefined) {
    const trimmed = String(body.program_name ?? "").trim();
    if (!trimmed) return apiValidationError({ program_name: ["program_name is required"] });
    body.program_name = trimmed;
  }

  const supabase = await createServiceClient();
  const db = await scopedClient(auth);

  const { data: existing } = await db
    .from("applications")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!existing) return apiNotFound("Application");

  const existingRow = existing as unknown as Record<string, unknown>;

  // Parent-lead scope check: load the parent lead and verify actor can access it
  const { data: parentLead } = await supabase
    .from("leads")
    .select("id, assigned_to, branch_id")
    .eq("id", existingRow.lead_id as string)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!parentLead) return apiNotFound("Application");
  const parentLeadRow = parentLead as unknown as { id: string; assigned_to: string | null; branch_id: string | null };
  const membership = await getLeadMembership(supabase, auth.tenantId, parentLeadRow.id);
  if (
    shouldRestrictToSelf(auth.permissions) &&
    !(
      parentLeadRow.assigned_to === auth.userId ||
      membership.some((m: { assigned_to: string | null }) => m.assigned_to === auth.userId)
    )
  ) {
    return apiNotFound("Application");
  }
  if (!requireLeadBranchAccess(auth, parentLeadRow, membership)) return apiNotFound("Application");
  const patch: Record<string, unknown> = {};

  // Stage change: sync status slug from the new stage
  if (body.stage_id !== undefined && body.stage_id !== existingRow.stage_id) {
    const { data: stage } = await db
      .from("application_stages")
      .select("id, slug, terminal_type")
      .eq("id", String(body.stage_id))
      .maybeSingle();
    const stageRow = stage as { id: string; slug: string; terminal_type: string | null } | null;
    if (!stageRow) return apiError("NOT_FOUND", "Application stage not found", 404);
    patch.stage_id = body.stage_id;
    patch.status = stageRow.slug;
  }

  // Scalar fields
  const updatable = [
    "university_name",
    "program_name",
    "intake_term",
    "country",
    "assigned_to",
    "offer_type",
    "application_deadline",
    "application_fee_paid",
    "tuition_fee",
    "deposit_paid",
    "offer_letter_url",
    "notes",
  ];
  for (const field of updatable) {
    if (body[field] !== undefined) patch[field] = body[field] ?? null;
  }

  if (Object.keys(patch).length === 0) return apiSuccess(existingRow);

  const { data: updated, error } = await db
    .from("applications")
    .update(patch)
    .eq("id", id)
    .select("*, leads!applications_lead_id_fkey(id,first_name,last_name,email), application_stages!applications_stage_id_fkey(id,name,slug,color,position,terminal_type)")
    .single();

  if (error) {
    log.error({ error }, "Failed to update application");
    return apiError("DB_ERROR", "Failed to update application", 500);
  }

  const events: Promise<unknown>[] = [
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "application.updated",
      entityType: "application",
      entityId: id,
      changes: { patch: { old: existingRow, new: patch } },
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "application.updated",
      entityType: "application",
      entityId: id,
      requestId,
      payload: { changed_fields: Object.keys(patch), old: existingRow, new: patch },
    }),
  ];

  if (patch.stage_id !== undefined) {
    events.push(
      emitEvent({
        tenantId: auth.tenantId,
        type: "application.stage_changed",
        entityType: "application",
        entityId: id,
        requestId,
        payload: { old_stage_id: existingRow.stage_id, new_stage_id: patch.stage_id },
      })
    );
  }

  await Promise.all(events);
  log.info({ applicationId: id }, "Application updated");
  return apiSuccess(updated);
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/applications/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();
  if (!canManageApplications(auth.permissions)) return apiForbidden();

  const supabase = await createServiceClient();
  const db = await scopedClient(auth);

  const { data: existing } = await db
    .from("applications")
    .select("id, lead_id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!existing) return apiNotFound("Application");

  // Parent-lead scope check
  const existingApp = existing as unknown as { id: string; lead_id: string };
  const { data: parentLead } = await supabase
    .from("leads")
    .select("id, assigned_to, branch_id")
    .eq("id", existingApp.lead_id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!parentLead) return apiNotFound("Application");
  const parentLeadRow = parentLead as unknown as { id: string; assigned_to: string | null; branch_id: string | null };
  const membership = await getLeadMembership(supabase, auth.tenantId, parentLeadRow.id);
  if (
    shouldRestrictToSelf(auth.permissions) &&
    !(
      parentLeadRow.assigned_to === auth.userId ||
      membership.some((m: { assigned_to: string | null }) => m.assigned_to === auth.userId)
    )
  ) {
    return apiNotFound("Application");
  }
  if (!requireLeadBranchAccess(auth, parentLeadRow, membership)) return apiNotFound("Application");

  const { error } = await db
    .from("applications")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    log.error({ error }, "Failed to delete application");
    return apiError("DB_ERROR", "Failed to delete application", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "application.deleted",
      entityType: "application",
      entityId: id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "application.deleted",
      entityType: "application",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ applicationId: id }, "Application soft-deleted");
  return apiSuccess({ id });
}
