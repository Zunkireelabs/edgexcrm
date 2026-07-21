import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
  apiConflict,
} from "@/lib/api/response";
import { validate, required, isUUID } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { enrollLead, EnrollmentConflictError } from "@/industries/_shared/features/outreach/lib/engine";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();

  const db = await scopedClient(auth);
  const { searchParams } = new URL(request.url);
  const leadId = searchParams.get("lead_id");
  const status = searchParams.get("status");

  let query = db
    .from("sequence_enrollments")
    .select("*, email_sequences(name), leads(first_name, last_name)");
  if (leadId) query = query.eq("lead_id", leadId);
  if (status) query = query.eq("status", status);

  // Owner/admin see all tenant enrollments; everyone else is forced to their own
  // — same convention as the drafts worklist.
  const isAdminTier = auth.role === "owner" || auth.role === "admin";
  if (!isAdminTier || shouldRestrictToSelf(auth.permissions)) {
    query = query.eq("assigned_to", auth.userId);
  }

  const { data, error } = await query.order("started_at", { ascending: false });
  if (error) return apiError("DB_ERROR", "Failed to fetch enrollments", 500);
  return apiSuccess(data ?? []);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/outreach/enrollments" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    sequence_id: [required("sequence_id"), isUUID()],
    lead_id: [required("lead_id"), isUUID()],
  });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);

  const { data: lead } = await db
    .from("leads")
    .select("id, assigned_to")
    .eq("id", String(body.lead_id))
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) return apiNotFound("Lead");
  const leadRow = lead as unknown as { id: string; assigned_to: string | null };

  // Counselors (own-scope) may only enroll leads assigned to them — same
  // convention as the activities route's counselor scoping.
  if (shouldRestrictToSelf(auth.permissions) && leadRow.assigned_to !== auth.userId) {
    return apiNotFound("Lead");
  }

  const { data: sequence } = await db
    .from("email_sequences")
    .select("id, status")
    .eq("id", String(body.sequence_id))
    .maybeSingle();
  if (!sequence || (sequence as unknown as { status: string }).status !== "active") return apiNotFound("Sequence");

  const assignedTo = body.assigned_to ? String(body.assigned_to) : (leadRow.assigned_to ?? auth.userId);

  try {
    const enrollment = await enrollLead(db, auth, {
      sequenceId: String(body.sequence_id),
      leadId: leadRow.id,
      assignedTo,
      enrolledBy: auth.userId,
    });
    log.info({ enrollmentId: enrollment.id }, "Lead enrolled in sequence");
    return apiSuccess(enrollment, 201);
  } catch (err) {
    if (err instanceof EnrollmentConflictError) return apiConflict(err.message);
    log.error({ err }, "Failed to enroll lead");
    return apiError("DB_ERROR", "Failed to enroll lead", 500);
  }
}
