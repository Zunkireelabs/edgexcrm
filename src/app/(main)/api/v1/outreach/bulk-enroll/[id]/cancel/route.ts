import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiConflict } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { requestCancel } from "@/industries/_shared/features/outreach/lib/bulk-enroll";

type Props = { params: Promise<{ id: string }> };

// POST /api/v1/outreach/bulk-enroll/[id]/cancel — stop a queued / running run. Leads already enrolled stay
// enrolled (undo them with unenroll); the not-yet-processed ones are skipped as "cancelled".
export async function POST(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data } = await db.from("sequence_bulk_enrollments").select("id, created_by, status").eq("id", id).maybeSingle();
  const run = data as unknown as { created_by: string | null; status: string } | null;
  if (!run) return apiNotFound("Bulk enrollment");

  const isAdminTier = auth.role === "owner" || auth.role === "admin";
  if (!isAdminTier && run.created_by !== auth.userId) return apiNotFound("Bulk enrollment");

  if (!(await requestCancel(db, id))) return apiConflict(`This run is already ${run.status}`);
  return apiSuccess({ cancel_requested: true });
}
