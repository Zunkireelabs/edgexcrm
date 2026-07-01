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
import { shouldRestrictToSelf, canEnrollStudents } from "@/lib/api/permissions";
import { getLeadMembership } from "@/lib/leads/branch-membership";

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CLASSES)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data, error } = await db
    .from("class_enrollments")
    .select("*, classes!class_enrollments_class_id_fkey(id,name,default_fee)")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) return apiError("DB_ERROR", "Failed to fetch enrollment", 500);
  if (!data) return apiNotFound("Enrollment");

  // Scope check
  const row = data as unknown as { lead_id: string };
  const supabase = await createServiceClient();
  const { data: parentLead } = await supabase
    .from("leads")
    .select("id, assigned_to, branch_id")
    .eq("id", row.lead_id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!parentLead) return apiNotFound("Enrollment");

  const parentLeadRow = parentLead as { id: string; assigned_to: string | null; branch_id: string | null };
  const membership = await getLeadMembership(supabase, auth.tenantId, parentLeadRow.id);
  if (
    shouldRestrictToSelf(auth.permissions) &&
    !(
      parentLeadRow.assigned_to === auth.userId ||
      membership.some((m: { assigned_to: string | null }) => m.assigned_to === auth.userId)
    )
  ) {
    return apiNotFound("Enrollment");
  }
  if (!requireLeadBranchAccess(auth, parentLeadRow, membership)) return apiNotFound("Enrollment");

  return apiSuccess(data);
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/class-enrollments/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CLASSES)) return apiForbidden();
  if (!canEnrollStudents(auth.permissions, auth.positionSlug)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const supabase = await createServiceClient();
  const db = await scopedClient(auth);

  const { data: existing } = await db
    .from("class_enrollments")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!existing) return apiNotFound("Enrollment");

  const existingRow = existing as unknown as Record<string, unknown>;

  // Parent-lead scope check
  const { data: parentLead } = await supabase
    .from("leads")
    .select("id, assigned_to, branch_id")
    .eq("id", existingRow.lead_id as string)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!parentLead) return apiNotFound("Enrollment");
  const parentLeadRow = parentLead as { id: string; assigned_to: string | null; branch_id: string | null };
  const membership = await getLeadMembership(supabase, auth.tenantId, parentLeadRow.id);
  if (
    shouldRestrictToSelf(auth.permissions) &&
    !(
      parentLeadRow.assigned_to === auth.userId ||
      membership.some((m: { assigned_to: string | null }) => m.assigned_to === auth.userId)
    )
  ) {
    return apiNotFound("Enrollment");
  }
  if (!requireLeadBranchAccess(auth, parentLeadRow, membership)) return apiNotFound("Enrollment");

  const patch: Record<string, unknown> = {};
  if (body.fee_paid !== undefined) patch.fee_paid = Boolean(body.fee_paid);
  if (body.fee_amount !== undefined) {
    if (body.fee_amount === null) {
      patch.fee_amount = null;
    } else {
      const fee = Number(body.fee_amount);
      if (isNaN(fee) || fee < 0) return apiValidationError({ fee_amount: ["fee_amount must be a non-negative number"] });
      patch.fee_amount = fee;
    }
  }
  if (body.notes !== undefined) patch.notes = body.notes === null ? null : String(body.notes);

  if (Object.keys(patch).length === 0) return apiSuccess(existingRow);

  const { data: updated, error } = await db
    .from("class_enrollments")
    .update(patch)
    .eq("id", id)
    .select("*, classes!class_enrollments_class_id_fkey(id,name,default_fee)")
    .single();

  if (error) {
    log.error({ error }, "Failed to update enrollment");
    return apiError("DB_ERROR", "Failed to update enrollment", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "class_enrollment.updated",
      entityType: "class_enrollment",
      entityId: id,
      changes: { patch: { old: existingRow, new: patch } },
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "class_enrollment.updated",
      entityType: "class_enrollment",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ enrollmentId: id }, "Enrollment updated");
  return apiSuccess(updated);
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: `/api/v1/class-enrollments/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CLASSES)) return apiForbidden();
  if (!canEnrollStudents(auth.permissions, auth.positionSlug)) return apiForbidden();

  const supabase = await createServiceClient();
  const db = await scopedClient(auth);

  const { data: existing } = await db
    .from("class_enrollments")
    .select("id, lead_id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!existing) return apiNotFound("Enrollment");

  const existingRow = existing as unknown as { id: string; lead_id: string };

  // Parent-lead scope check
  const { data: parentLead } = await supabase
    .from("leads")
    .select("id, assigned_to, branch_id")
    .eq("id", existingRow.lead_id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!parentLead) return apiNotFound("Enrollment");
  const parentLeadRow = parentLead as { id: string; assigned_to: string | null; branch_id: string | null };
  const membership = await getLeadMembership(supabase, auth.tenantId, parentLeadRow.id);
  if (
    shouldRestrictToSelf(auth.permissions) &&
    !(
      parentLeadRow.assigned_to === auth.userId ||
      membership.some((m: { assigned_to: string | null }) => m.assigned_to === auth.userId)
    )
  ) {
    return apiNotFound("Enrollment");
  }
  if (!requireLeadBranchAccess(auth, parentLeadRow, membership)) return apiNotFound("Enrollment");

  // Soft delete (un-enroll)
  const { error } = await db
    .from("class_enrollments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    log.error({ error }, "Failed to un-enroll");
    return apiError("DB_ERROR", "Failed to un-enroll", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "class_enrollment.deleted",
      entityType: "class_enrollment",
      entityId: id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "class_enrollment.deleted",
      entityType: "class_enrollment",
      entityId: id,
      requestId,
    }),
  ]);

  log.info({ enrollmentId: id }, "Enrollment soft-deleted");
  return apiSuccess({ id });
}
