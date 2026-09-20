import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { canViewLead } from "@/lib/ai/tools/universal/lib/lead-visibility";
import { canEnrollStudents } from "@/lib/api/class-attendance";
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

interface LeadForAccess {
  id: string;
  assigned_to: string | null;
  branch_id: string | null;
  pipeline_id: string;
  list_id: string | null;
}

// GET /api/v1/leads/:id/classes
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CLASSES)) return apiForbidden();

  const db = await scopedClient(auth);

  const { data: lead } = await db
    .from("leads")
    .select("id, assigned_to, branch_id, pipeline_id, list_id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!lead) return apiNotFound("Lead");

  // canViewLead is the same collaborator-aware visibility check the Lead
  // Detail page itself uses (src/lib/ai/tools/universal/lib/lead-visibility.ts)
  // — own-scope assignee/collaborator, team-scope branch membership,
  // cross-branch pool, or pipeline access. The previous hand-rolled check
  // here (shouldRestrictToSelf + requireLeadBranchAccess, lib/api/auth.ts)
  // never consulted lead_collaborators, so a collaborator who wasn't also
  // the assignee or lead_branches-mapped got a false 404 here even though
  // they could see everything else on the lead — this is the fix for that.
  const leadRow = lead as unknown as LeadForAccess;
  if (!(await canViewLead(db, auth, leadRow))) return apiNotFound("Lead");

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
  if (!(await canEnrollStudents(auth))) return apiForbidden();

  const db = await scopedClient(auth);

  const { data: lead } = await db
    .from("leads")
    .select("id, assigned_to, branch_id, pipeline_id, list_id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!lead) return apiNotFound("Lead");
  const leadRow = lead as unknown as LeadForAccess;
  // Same collaborator-aware check as GET above — see its comment for why.
  if (!(await canViewLead(db, auth, leadRow))) return apiNotFound("Lead");

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
  const enrollmentType = body.enrollment_type === "demo" ? "demo" : "actual";

  const { data: created, error } = await db
    .from("class_enrollments")
    .insert({
      lead_id: leadRow.id,
      class_id: cls.id,
      fee_paid: feePaid,
      fee_amount: feeAmount,
      notes,
      enrollment_type: enrollmentType,
    })
    .select("*, classes!class_enrollments_class_id_fkey(id,name,default_fee)")
    .single();

  if (error) {
    if (error.code === "23505") {
      return apiConflict(
        enrollmentType === "demo"
          ? "This student already has a demo enrollment in this class."
          : "This student is already enrolled in this class."
      );
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
