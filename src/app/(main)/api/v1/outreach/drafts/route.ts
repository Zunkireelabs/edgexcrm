import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

// GET /api/v1/outreach/drafts?due=today|all&assigned_to=<uuid>
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();

  const db = await scopedClient(auth);
  const { searchParams } = new URL(request.url);
  const due = searchParams.get("due");
  const assignedToParam = searchParams.get("assigned_to");

  // Inner-joined leads/enrollments so a soft-deleted lead or a paused/completed/
  // unenrolled enrollment drops the draft out of the worklist entirely.
  let query = db
    .from("sequence_step_drafts")
    .select(
      "*, leads!inner(first_name, last_name, email), sequence_enrollments!inner(sequence_id, status, email_sequences(name))"
    )
    .eq("status", "pending")
    .is("leads.deleted_at", null)
    .eq("sequence_enrollments.status", "active");

  // Owner/admin see all tenant drafts (optionally filtered by assigned_to).
  // Everyone else — including counselors — is forced to their own drafts.
  const isAdminTier = auth.role === "owner" || auth.role === "admin";
  if (!isAdminTier || shouldRestrictToSelf(auth.permissions)) {
    query = query.eq("assigned_to", auth.userId);
  } else if (assignedToParam) {
    query = query.eq("assigned_to", assignedToParam);
  }

  if (due === "today") {
    query = query.lte("due_at", new Date().toISOString());
  }

  const { data, error } = await query.order("due_at", { ascending: true });
  if (error) return apiError("DB_ERROR", "Failed to fetch drafts", 500);
  return apiSuccess(data ?? []);
}
