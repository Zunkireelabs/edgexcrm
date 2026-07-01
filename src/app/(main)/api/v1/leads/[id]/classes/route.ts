import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireLeadBranchAccess } from "@/lib/api/auth";
import { getLeadMembership } from "@/lib/leads/branch-membership";
import { shouldRestrictToSelf, canEnrollStudents } from "@/lib/api/permissions";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
  apiConflict,
} from "@/lib/api/response";
import { validate, required } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/v1/leads/:id/classes
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CLASSES)) return apiForbidden();

  const supabase = await createServiceClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("id, assigned_to, branch_id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (!lead) return apiNotFound("Lead");

  const leadRow = lead as { id: string; assigned_to: string | null; branch_id: string | null };
  const membership = await getLeadMembership(supabase, auth.tenantId, id);
  if (
    shouldRestrictToSelf(auth.permissions) &&
    !(
      membership.some((m: { assigned_to: string | null }) => m.assigned_to === auth.userId) ||
      leadRow.assigned_to === auth.userId
    )
  ) {
    return apiNotFound("Lead");
  }
  if (!requireLeadBranchAccess(auth, leadRow, membership)) return apiNotFound("Lead");

  const db = await scopedClient(auth);
  const { data, error } = await db
    .from("class_enrollments")
    .select("*, classes!class_enrollments_class_id_fkey(id,name,default_fee)")
    .eq("lead_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) return apiError("DB_ERROR", "Failed to fetch enrollments", 500);
  return apiSuccess(data ?? []);
}

// POST /api/v1/leads/:id/classes — lead is already Qualified+; no auto-move
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/leads/${id}/classes` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CLASSES)) return apiForbidden();
  if (!canEnrollStudents(auth.permissions, auth.positionSlug)) return apiForbidden();

  const supabase = await createServiceClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("id, assigned_to, branch_id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (!lead) return apiNotFound("Lead");
  const leadRow = lead as { id: string; assigned_to: string | null; branch_id: string | null };

  const membership = await getLeadMembership(supabase, auth.tenantId, id);
  if (
    shouldRestrictToSelf(auth.permissions) &&
    !(
      leadRow.assigned_to === auth.userId ||
      membership.some((m: { assigned_to: string | null }) => m.assigned_to === auth.userId)
    )
  ) {
    return apiNotFound("Lead");
  }
  if (!requireLeadBranchAccess(auth, leadRow, membership)) return apiNotFound("Lead");

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    class_id: [required("class_id")],
  });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);

  // Verify class belongs to tenant and is active
  const { data: classRow } = await db
    .from("classes")
    .select("id, name, default_fee, is_active")
    .eq("id", String(body.class_id))
    .maybeSingle();
  if (!classRow) return apiNotFound("Class");
  const cls = classRow as unknown as { id: string; name: string; default_fee: number | null; is_active: boolean };
  if (!cls.is_active) return apiError("CLASS_INACTIVE", "This class is not active", 400);

  const feePaid = body.fee_paid === undefined ? false : Boolean(body.fee_paid);
  let feeAmount: number | null = null;
  if (body.fee_amount !== undefined && body.fee_amount !== null) {
    feeAmount = Number(body.fee_amount);
    if (isNaN(feeAmount) || feeAmount < 0) return apiValidationError({ fee_amount: ["fee_amount must be a non-negative number"] });
  }
  const notes = body.notes ? String(body.notes) : null;

  const { data: created, error } = await db
    .from("class_enrollments")
    .insert({
      lead_id: leadRow.id,
      class_id: cls.id,
      fee_paid: feePaid,
      fee_amount: feeAmount,
      notes,
    })
    .select("*, classes!class_enrollments_class_id_fkey(id,name,default_fee)")
    .single();

  if (error) {
    if (error.code === "23505") {
      return apiConflict("This student is already enrolled in this class.");
    }
    log.error({ error }, "Failed to create enrollment");
    return apiError("DB_ERROR", "Failed to create enrollment", 500);
  }

  const createdRow = created as unknown as { id: string };
  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "class.enrolled",
      entityType: "class_enrollment",
      entityId: createdRow.id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "class.enrolled",
      entityType: "class_enrollment",
      entityId: createdRow.id,
      requestId,
    }),
  ]);

  log.info({ enrollmentId: createdRow.id }, "Enrollment created via lead panel");
  return apiSuccess(created, 201);
}
