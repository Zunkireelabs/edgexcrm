import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

type Props = { params: Promise<{ id: string }> };

// GET /api/v1/outreach/bulk-enroll/[id] — progress + result of one run. Owner/admin see any run in the tenant;
// everyone else only the runs they started.
export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data } = await db
    .from("sequence_bulk_enrollments")
    .select(
      "id, sequence_id, created_by, source_mode, conflict_policy, status, total_count, enrolled_count, skipped_count, failed_count, cancel_requested, error, created_at, started_at, finished_at, email_sequences(name)"
    )
    .eq("id", id)
    .maybeSingle();
  const run = data as unknown as { created_by: string | null } | null;
  if (!run) return apiNotFound("Bulk enrollment");

  const isAdminTier = auth.role === "owner" || auth.role === "admin";
  if (!isAdminTier && run.created_by !== auth.userId) return apiNotFound("Bulk enrollment");

  return apiSuccess(data);
}
